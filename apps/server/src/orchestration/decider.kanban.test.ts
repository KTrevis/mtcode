import { CommandId, EventId, ProjectId } from "@t3tools/contracts";
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

it.layer(NodeServices.layer)("project Kanban", (it) => {
  it.effect("keeps cards on the project and rejects stale writes", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const projectId = ProjectId.make("kanban-project");
      const model = yield* projectEvent(createEmptyReadModel(now), {
        sequence: 1,
        eventId: EventId.make("kanban-created"),
        aggregateKind: "project",
        aggregateId: projectId,
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("kanban-create"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          projectId,
          title: "Kanban project",
          workspaceRoot: "/tmp/kanban-project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      const cards = [
        {
          id: "card-1",
          title: "Ship it",
          tagIds: ["bug", "frontend"],
          description: "![Screenshot](kanban-image:image-1)",
          column: "AI" as const,
          agentThreadId: "agent-thread-1" as never,
          images: [
            {
              id: "image-1",
              attachment: {
                type: "image" as const,
                id: "kanban-project-image",
                name: "screenshot.png",
                mimeType: "image/png",
                sizeBytes: 6,
              },
            },
          ],
        },
      ];
      const event = yield* decideOrchestrationCommand({
        readModel: model,
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("kanban-update"),
          projectId,
          kanbanCards: cards,
          kanbanTags: [
            { id: "bug", name: "Bug" },
            { id: "frontend", name: "Frontend" },
            { id: "release", name: "Release" },
          ],
          kanbanExpectedUpdatedAt: now,
        },
      });
      const updated = yield* projectEvent(model, Array.isArray(event) ? event[0]! : event);
      expect(updated.projects[0]?.kanbanCards).toEqual(cards);
      expect(updated.projects[0]?.kanbanTags).toHaveLength(3);
      const invalid = yield* Effect.result(
        decideOrchestrationCommand({
          readModel: updated,
          command: {
            type: "project.kanban-ticket.update",
            commandId: CommandId.make("invalid-tag"),
            projectId,
            ticketId: "card-1",
            tagIds: ["unknown"],
          },
        }),
      );
      expect(invalid._tag).toBe("Failure");

      const retaggedEvent = yield* decideOrchestrationCommand({
        readModel: updated,
        command: {
          type: "project.kanban-ticket.update",
          commandId: CommandId.make("kanban-retag"),
          projectId,
          ticketId: "card-1",
          tagIds: ["release"],
        },
      });
      const retagged = yield* projectEvent(
        updated,
        Array.isArray(retaggedEvent) ? retaggedEvent[0]! : retaggedEvent,
      );
      expect(retagged.projects[0]?.kanbanCards).toEqual([{ ...cards[0]!, tagIds: ["release"] }]);
      const clearedEvent = yield* decideOrchestrationCommand({
        readModel: retagged,
        command: {
          type: "project.kanban-ticket.update",
          commandId: CommandId.make("kanban-clear-tags"),
          projectId,
          ticketId: "card-1",
          tagIds: [],
        },
      });
      const cleared = yield* projectEvent(
        retagged,
        Array.isArray(clearedEvent) ? clearedEvent[0]! : clearedEvent,
      );
      expect(cleared.projects[0]?.kanbanCards).toEqual([{ ...cards[0]!, tagIds: [] }]);

      const dependencyCards = [
        { id: "base", title: "Base", column: "TODO" as const },
        { id: "child", title: "Child", column: "TODO" as const, dependsOn: ["base"] },
      ];
      const dependencyEvent = yield* decideOrchestrationCommand({
        readModel: updated,
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("dependencies"),
          projectId,
          kanbanCards: dependencyCards,
          kanbanExpectedUpdatedAt: updated.projects[0]!.updatedAt,
        },
      });
      const linked = yield* projectEvent(
        updated,
        Array.isArray(dependencyEvent) ? dependencyEvent[0]! : dependencyEvent,
      );
      expect(linked.projects[0]!.kanbanCards).toEqual(dependencyCards);
      for (const dependsOn of [["child"], ["missing"], ["base", "base"]]) {
        const invalid = yield* Effect.result(
          decideOrchestrationCommand({
            readModel: linked,
            command: {
              type: "project.kanban-ticket.update",
              commandId: CommandId.make("invalid-dependency"),
              projectId,
              ticketId: "child",
              dependsOn,
            },
          }),
        );
        expect(invalid._tag).toBe("Failure");
      }
      const cycle = yield* Effect.result(
        decideOrchestrationCommand({
          readModel: linked,
          command: {
            type: "project.kanban-ticket.update",
            commandId: CommandId.make("cycle"),
            projectId,
            ticketId: "base",
            dependsOn: ["child"],
          },
        }),
      );
      expect(cycle._tag).toBe("Failure");
      const blocked = yield* Effect.result(
        decideOrchestrationCommand({
          readModel: linked,
          command: {
            type: "project.kanban-ticket.move",
            commandId: CommandId.make("blocked"),
            projectId,
            ticketId: "child",
            column: "AI",
            agentThreadId: "agent" as never,
          },
        }),
      );
      expect(blocked._tag).toBe("Failure");
      const blockedBulk = yield* Effect.result(
        decideOrchestrationCommand({
          readModel: linked,
          command: {
            type: "project.meta.update",
            commandId: CommandId.make("blocked-bulk"),
            projectId,
            kanbanCards: dependencyCards.map((card) =>
              card.id === "child" ? { ...card, column: "AI" as const } : card,
            ),
            kanbanExpectedUpdatedAt: linked.projects[0]!.updatedAt,
          },
        }),
      );
      expect(blockedBulk._tag).toBe("Failure");
      const doneEvent = yield* decideOrchestrationCommand({
        readModel: linked,
        command: {
          type: "project.kanban-ticket.move",
          commandId: CommandId.make("done"),
          projectId,
          ticketId: "base",
          column: "Done",
        },
      });
      const done = yield* projectEvent(
        linked,
        Array.isArray(doneEvent) ? doneEvent[0]! : doneEvent,
      );
      const ready = yield* Effect.result(
        decideOrchestrationCommand({
          readModel: done,
          command: {
            type: "project.kanban-ticket.move",
            commandId: CommandId.make("ready"),
            projectId,
            ticketId: "child",
            column: "AI",
            agentThreadId: "agent" as never,
          },
        }),
      );
      expect(ready._tag).toBe("Success");
      const deletedEvent = yield* decideOrchestrationCommand({
        readModel: linked,
        command: {
          type: "project.kanban-ticket.delete",
          commandId: CommandId.make("delete-base"),
          projectId,
          ticketId: "base",
        },
      });
      const deleted = yield* projectEvent(
        linked,
        Array.isArray(deletedEvent) ? deletedEvent[0]! : deletedEvent,
      );
      expect(deleted.projects[0]!.kanbanCards).toEqual([{ ...dependencyCards[1], dependsOn: [] }]);

      const stale = yield* Effect.result(
        decideOrchestrationCommand({
          readModel: updated,
          command: {
            type: "project.meta.update",
            commandId: CommandId.make("kanban-stale"),
            projectId,
            kanbanCards: [],
            kanbanExpectedUpdatedAt: now,
          },
        }),
      );
      expect(stale._tag).toBe("Failure");

      const duplicateImage = yield* Effect.result(
        decideOrchestrationCommand({
          readModel: updated,
          command: {
            type: "project.meta.update",
            commandId: CommandId.make("kanban-duplicate-image"),
            projectId,
            kanbanCards: [{ ...cards[0]!, images: [cards[0]!.images[0]!, cards[0]!.images[0]!] }],
            kanbanExpectedUpdatedAt: updated.projects[0]!.updatedAt,
          },
        }),
      );
      expect(duplicateImage._tag).toBe("Failure");
    }),
  );
});

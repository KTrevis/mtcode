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
          kanbanExpectedUpdatedAt: now,
        },
      });
      const updated = yield* projectEvent(model, Array.isArray(event) ? event[0]! : event);
      expect(updated.projects[0]?.kanbanCards).toEqual(cards);

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

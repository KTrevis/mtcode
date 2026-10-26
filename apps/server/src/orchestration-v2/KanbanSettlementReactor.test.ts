import { expect, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ThreadId,
  type KanbanCard,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type OrchestrationProjectShell,
  type Project,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { completeLinkedTickets } from "./KanbanSettlementReactor.ts";

it.effect("settlement completes only unfinished tickets linked to the settled thread", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("worker");
    const projectId = ProjectId.make("project");
    const moved: Array<string> = [];
    const cards: Array<KanbanCard> = [
      { id: "linked", title: "Linked", column: "AI", agentThreadId: threadId },
      { id: "done", title: "Already done", column: "Done", agentThreadId: threadId },
      { id: "other", title: "Other worker", column: "AI", agentThreadId: ThreadId.make("other") },
      { id: "manual", title: "Manual", column: "TODO" },
    ];
    const project = { id: projectId, kanbanCards: cards } as unknown as OrchestrationProjectShell;
    const dependencies = Layer.mergeAll(
      Layer.mock(Orchestrator.OrchestratorV2)({
        getThreadShell: () =>
          Effect.succeed({
            id: threadId,
            projectId,
            settledAt: {},
          } as unknown as OrchestrationV2ThreadShell),
      }),
      Layer.mock(ProjectService.ProjectService)({
        getShell: () => Effect.succeedSome(project),
        mutateKanban: (command) =>
          Effect.sync(() => {
            moved.push(command.ticketId);
            return { sequence: 1, project: project as Project };
          }),
      }),
    );
    const event = {
      id: EventId.make("settled"),
      type: "thread.settled",
      threadId,
    } as unknown as OrchestrationV2DomainEvent;
    yield* completeLinkedTickets(event).pipe(Effect.provide(dependencies));
    expect(moved).toEqual(["linked"]);
    yield* completeLinkedTickets({
      ...event,
      type: "thread.unsettled",
    } as OrchestrationV2DomainEvent).pipe(Effect.provide(dependencies));
    expect(moved).toEqual(["linked"]);
  }),
);

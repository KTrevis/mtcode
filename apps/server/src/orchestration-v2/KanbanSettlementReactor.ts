import { CommandId, type OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";

export const completeLinkedTickets = Effect.fn("KanbanSettlement.completeLinkedTickets")(function* (
  event: OrchestrationV2DomainEvent,
) {
  if (event.type !== "thread.settled") return;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectService.ProjectService;
  const thread = yield* orchestrator.getThreadShell(event.threadId);
  if (thread === null || thread.settledAt === null) return;
  const project = yield* projects.getShell(thread.projectId);
  if (Option.isNone(project)) return;
  for (const ticket of project.value.kanbanCards ?? []) {
    if (ticket.agentThreadId !== thread.id || ticket.column === "Done") continue;
    yield* projects.mutateKanban({
      type: "project.kanban-ticket.move",
      commandId: CommandId.make(`kanban:settled:${event.id}:${ticket.id}`),
      projectId: thread.projectId,
      ticketId: ticket.id,
      column: "Done",
    });
  }
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* forkParked(
      orchestrator.streamDomainEvents.pipe(
        Stream.runForEach((event) =>
          completeLinkedTickets(event).pipe(Effect.ignoreCause({ log: true })),
        ),
      ),
    );
  }),
);

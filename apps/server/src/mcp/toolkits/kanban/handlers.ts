import { CommandId, type ProjectId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { requireMcpCapability } from "../../McpInvocationContext.ts";
import {
  KanbanTicketCreateError,
  KanbanTicketMutationError,
  KanbanTicketMoveError,
  KanbanToolkit,
} from "./tools.ts";

import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { startTicket } from "./startTicket.ts";

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  // ponytail: serialize MCP moves; use per-project locks if launch throughput matters.
  const moveLock = yield* Semaphore.make(1);
  const mutateTicket = Effect.fn("KanbanToolkit.mutateTicket")(function* (
    type: "project.kanban-ticket.update" | "project.kanban-ticket.delete",
    input: {
      projectId: ProjectId;
      ticketId: string;
      clientRequestId?: string | undefined;
      title?: string | undefined;
      description?: string | undefined;
    },
  ) {
    const scope = yield* requireMcpCapability("kanban");
    const requestId = input.clientRequestId ?? (yield* crypto.randomUUIDv4.pipe(Effect.orDie));
    const commandId = CommandId.make(
      `mcp:${type}:${[scope.providerSessionId, input.projectId, input.ticketId, requestId]
        .map((part) => `${part.length}:${part}`)
        .join(":")}`,
    );
    const { sequence } = yield* engine
      .dispatch({
        type,
        commandId,
        projectId: input.projectId,
        ticketId: input.ticketId,
        ...(type === "project.kanban-ticket.update"
          ? {
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.description !== undefined ? { description: input.description } : {}),
            }
          : {}),
      })
      .pipe(
        Effect.mapError((cause) => new KanbanTicketMutationError({ detail: cause.message, cause })),
      );
    return { projectId: input.projectId, ticketId: input.ticketId, commandId, sequence };
  });
  return KanbanToolkit.of({
    kanban_update_ticket: (input) => mutateTicket("project.kanban-ticket.update", input),
    kanban_delete_ticket: (input) => mutateTicket("project.kanban-ticket.delete", input),
    kanban_move_ticket: Effect.fn("KanbanToolkit.moveTicket")(function* (input) {
      const scope = yield* requireMcpCapability("kanban");
      const snapshots = yield* ProjectionSnapshotQuery;
      const caller =
        input.projectId === undefined
          ? yield* snapshots
              .getThreadShellById(scope.threadId)
              .pipe(
                Effect.mapError(
                  (cause) => new KanbanTicketMoveError({ detail: cause.message, cause }),
                ),
              )
          : Option.none();
      const projectId = input.projectId ?? Option.getOrNull(caller)?.projectId;
      if (!projectId) {
        return yield* new KanbanTicketMoveError({
          detail: "Pass the target projectId.",
          cause: null,
        });
      }
      const project = yield* snapshots
        .getProjectShellById(projectId)
        .pipe(
          Effect.mapError((cause) => new KanbanTicketMoveError({ detail: cause.message, cause })),
        );
      const card = Option.getOrNull(project)?.kanbanCards?.find((candidate) =>
        input.ticketId === undefined
          ? candidate.agentThreadId === scope.threadId
          : candidate.id === input.ticketId,
      );
      if (Option.isNone(project) || !card) {
        return yield* new KanbanTicketMoveError({
          detail: "Ticket does not exist in an active project.",
          cause: null,
        });
      }
      const enteringAI = input.column === "AI" && card.column !== "AI";
      const agentThreadId = enteringAI
        ? yield* startTicket(project.value, card)
        : card.agentThreadId;
      const commandId = CommandId.make(
        `mcp:kanban-move:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
      );
      const { sequence } = yield* engine
        .dispatch({
          type: "project.kanban-ticket.move",
          commandId,
          projectId,
          ticketId: card.id,
          column: input.column,
          ...(enteringAI ? { agentThreadId, expectedUpdatedAt: project.value.updatedAt } : {}),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new KanbanTicketMoveError({
                detail: enteringAI
                  ? `Agent started in thread ${agentThreadId}, but ticket could not move: ${cause.message}`
                  : cause.message,
                cause,
              }),
          ),
        );
      return {
        projectId,
        ticketId: card.id,
        column: input.column,
        commandId,
        sequence,
        ...(agentThreadId ? { agentThreadId } : {}),
      };
    }, moveLock.withPermits(1)),
    kanban_create_ticket: Effect.fn("KanbanToolkit.createTicket")(function* (input) {
      const scope = yield* requireMcpCapability("kanban");
      const requestId = input.clientRequestId ?? (yield* crypto.randomUUIDv4.pipe(Effect.orDie));
      const commandId = CommandId.make(
        `mcp:kanban-create:${[scope.providerSessionId, input.projectId, requestId]
          .map((part) => `${part.length}:${part}`)
          .join(":")}`,
      );
      const ticketId = commandId;
      const { sequence } = yield* engine
        .dispatch({
          type: "project.kanban-ticket.create",
          commandId,
          projectId: input.projectId,
          ticketId,
          title: input.title,
          ...(input.description !== undefined ? { description: input.description } : {}),
        })
        .pipe(
          Effect.mapError((cause) => new KanbanTicketCreateError({ detail: cause.message, cause })),
        );
      return { projectId: input.projectId, ticketId, commandId, sequence };
    }),
  });
});

export const KanbanToolkitHandlersLive = KanbanToolkit.toLayer(make);

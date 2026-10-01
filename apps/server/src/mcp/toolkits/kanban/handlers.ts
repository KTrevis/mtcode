import { CommandId, type ProjectId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { requireMcpCapability } from "../../McpInvocationContext.ts";
import { KanbanTicketCreateError, KanbanTicketMutationError, KanbanToolkit } from "./tools.ts";

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
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

import { CommandId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { requireMcpCapability } from "../../McpInvocationContext.ts";
import { KanbanTicketCreateError, KanbanToolkit } from "./tools.ts";

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  return KanbanToolkit.of({
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

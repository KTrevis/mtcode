import { CommandId, type ProjectId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import type { Toolkit } from "effect/ai";
import {
  KanbanTicketCreateError,
  KanbanTicketListError,
  KanbanTicketMutationError,
  KanbanTicketMoveError,
  KanbanToolkit,
} from "./tools.ts";

import { startTicket } from "./startTicket.ts";

type Params<K extends keyof typeof KanbanToolkit.tools> = Parameters<
  Toolkit.HandlersFrom<typeof KanbanToolkit.tools>[K]
>[0];

const make = Effect.gen(function* () {
  const engine = yield* ProjectService.ProjectService;
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
      tagIds?: readonly string[] | undefined;
      dependsOn?: readonly string[] | undefined;
    },
  ) {
    const { scope } = yield* readCaller();
    const requestId = input.clientRequestId ?? (yield* crypto.randomUUIDv4().pipe(Effect.orDie));
    const commandId = CommandId.make(
      `mcp:${type}:${[scope.requestNamespace, input.projectId, input.ticketId, requestId]
        .map((part) => `${part.length}:${part}`)
        .join(":")}`,
    );
    const { sequence } = yield* engine
      .mutateKanban({
        type,
        commandId,
        projectId: input.projectId,
        ticketId: input.ticketId,
        ...(type === "project.kanban-ticket.update"
          ? {
              ...(input.dependsOn !== undefined ? { dependsOn: input.dependsOn } : {}),
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.tagIds !== undefined ? { tagIds: input.tagIds } : {}),
              ...(input.description !== undefined ? { description: input.description } : {}),
            }
          : {}),
      })
      .pipe(
        Effect.mapError((cause) => new KanbanTicketMutationError({ detail: cause.message, cause })),
      );
    return { projectId: input.projectId, ticketId: input.ticketId, commandId, sequence };
  });
  return {
    kanban_list_tickets: Effect.fn("KanbanToolkit.listTickets")(function* (
      input: Params<"kanban_list_tickets">,
    ) {
      const { scope } = yield* readCaller();
      const projects = yield* ProjectService.ProjectService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const snapshots = {
        getProjectShellById: projects.getShell,
        getThreadShellById: (threadId: import("@t3tools/contracts").ThreadId | undefined) =>
          threadId === undefined
            ? Effect.succeedNone
            : threads.getThreadShell(threadId).pipe(Effect.map(Option.fromNullishOr)),
      };
      const projectId = yield* Effect.gen(function* () {
        if (input.projectId !== undefined) return input.projectId;
        const caller = yield* snapshots.getThreadShellById(scope.thread?.threadId);
        return Option.getOrNull(caller)?.projectId;
      }).pipe(
        Effect.mapError((cause) => new KanbanTicketListError({ detail: cause.message, cause })),
      );
      if (!projectId) {
        return yield* new KanbanTicketListError({
          detail: "Pass the target projectId.",
          cause: null,
        });
      }
      const project = yield* snapshots
        .getProjectShellById(projectId)
        .pipe(
          Effect.mapError((cause) => new KanbanTicketListError({ detail: cause.message, cause })),
        );
      if (Option.isNone(project)) {
        return yield* new KanbanTicketListError({
          detail: "Project does not exist or is deleted.",
          cause: null,
        });
      }
      return {
        projectId,
        tickets: project.value.kanbanCards ?? [],
        tags: project.value.kanbanTags ?? [],
      };
    }),
    kanban_update_ticket: (input: Params<"kanban_update_ticket">) =>
      mutateTicket("project.kanban-ticket.update", input),
    kanban_delete_ticket: (input: Params<"kanban_delete_ticket">) =>
      mutateTicket("project.kanban-ticket.delete", input),
    kanban_move_ticket: Effect.fn("KanbanToolkit.moveTicket")(function* (
      input: Params<"kanban_move_ticket">,
    ) {
      const { scope } = yield* readCaller();
      const projects = yield* ProjectService.ProjectService;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const snapshots = {
        getProjectShellById: projects.getShell,
        getThreadShellById: (threadId: import("@t3tools/contracts").ThreadId | undefined) =>
          threadId === undefined
            ? Effect.succeedNone
            : threads.getThreadShell(threadId).pipe(Effect.map(Option.fromNullishOr)),
      };
      const caller =
        input.projectId === undefined
          ? yield* snapshots
              .getThreadShellById(scope.thread?.threadId)
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
          ? candidate.agentThreadId === scope.thread?.threadId
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
        ? yield* startTicket(project.value, card, input.instructions)
        : card.agentThreadId;
      const commandId = CommandId.make(
        `mcp:kanban-move:${yield* crypto.randomUUIDv4().pipe(Effect.orDie)}`,
      );
      const { sequence } = yield* engine
        .mutateKanban({
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
    kanban_create_ticket: Effect.fn("KanbanToolkit.createTicket")(function* (
      input: Params<"kanban_create_ticket">,
    ) {
      const { scope } = yield* readCaller();
      const requestId = input.clientRequestId ?? (yield* crypto.randomUUIDv4().pipe(Effect.orDie));
      const commandId = CommandId.make(
        `mcp:kanban-create:${[scope.requestNamespace, input.projectId, requestId]
          .map((part) => `${part.length}:${part}`)
          .join(":")}`,
      );
      const ticketId = commandId;
      const { sequence } = yield* engine
        .mutateKanban({
          type: "project.kanban-ticket.create",
          commandId,
          projectId: input.projectId,
          ticketId,
          title: input.title,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.tagIds !== undefined ? { tagIds: input.tagIds } : {}),
        })
        .pipe(
          Effect.mapError((cause) => new KanbanTicketCreateError({ detail: cause.message, cause })),
        );
      return { projectId: input.projectId, ticketId, commandId, sequence };
    }),
  };
});

export const layer = McpToolAccess.toLayer(
  KanbanToolkit,
  Effect.map(make, (handlers) => ({
    kanban_list_tickets: McpToolAccess.reads(handlers.kanban_list_tickets),
    kanban_create_ticket: McpToolAccess.writesEnvironment(handlers.kanban_create_ticket),
    kanban_update_ticket: McpToolAccess.writesEnvironment(handlers.kanban_update_ticket),
    kanban_delete_ticket: McpToolAccess.writesEnvironment(handlers.kanban_delete_ticket),
    kanban_move_ticket: McpToolAccess.writesEnvironment(handlers.kanban_move_ticket),
  })),
);

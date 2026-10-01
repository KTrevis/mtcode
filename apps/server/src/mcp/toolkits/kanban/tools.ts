import {
  CommandId,
  KanbanCard,
  McpCapabilityUnavailableError,
  NonNegativeInt,
  ProjectId,
  TrimmedNonEmptyString,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import * as Socket from "effect/unstable/socket/Socket";
import { EnvironmentAuth } from "../../../auth/EnvironmentAuth.ts";
import { ServerConfig } from "../../../config.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { Tool, Toolkit } from "effect/unstable/ai";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";

export class KanbanTicketCreateError extends Schema.TaggedError<KanbanTicketCreateError>()(
  "KanbanTicketCreateError",
  { detail: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return this.detail;
  }
}

export const KanbanTicketCreateResult = Schema.Struct({
  projectId: ProjectId,
  ticketId: TrimmedNonEmptyString,
  commandId: CommandId,
  sequence: NonNegativeInt,
});

export class KanbanTicketListError extends Schema.TaggedError<KanbanTicketListError>()(
  "KanbanTicketListError",
  { detail: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return this.detail;
  }
}

const ListTicketsTool = Tool.make("kanban_list_tickets", {
  description:
    "Read all Kanban tickets in board order from an active project on this environment. Omit projectId to use the calling thread's project. Returns projectId and tickets with their IDs, titles, descriptions, columns, images, branches, and linked agent thread IDs when present. An empty board returns an empty tickets array. Does not move tickets or start agents.",
  parameters: Schema.Struct({ projectId: Schema.optional(ProjectId) }),
  success: Schema.Struct({ projectId: ProjectId, tickets: Schema.Array(KanbanCard) }),
  failure: Schema.Union([McpCapabilityUnavailableError, KanbanTicketListError]),
  dependencies: [McpInvocationContext, ProjectionSnapshotQuery],
})
  .annotate(Tool.Title, "List Kanban tickets")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const CreateTicketTool = Tool.make("kanban_create_ticket", {
  description:
    "Create a Kanban ticket in the specified project on this environment. Requires the project's exact projectId, a title (maximum 200 characters), and optionally a description (maximum 4000 characters). Appends to TODO without starting an agent. Boards support at most 200 tickets. Reuse clientRequestId for retries within this provider session to avoid duplicate tickets; retries return the original ticket ID and command receipt.",
  parameters: Schema.Struct({
    projectId: ProjectId,
    title: KanbanCard.fields.title,
    description: KanbanCard.fields.description,
    clientRequestId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  }),
  success: KanbanTicketCreateResult,
  failure: Schema.Union([McpCapabilityUnavailableError, KanbanTicketCreateError]),
  dependencies: [McpInvocationContext, OrchestrationEngineService],
})
  .annotate(Tool.Title, "Create Kanban ticket")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export class KanbanTicketMoveError extends Schema.TaggedError<KanbanTicketMoveError>()(
  "KanbanTicketMoveError",
  { detail: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return this.detail;
  }
}

export const KanbanTicketMoveResult = Schema.Struct({
  ...KanbanTicketCreateResult.fields,
  column: KanbanCard.fields.column,
  agentThreadId: Schema.optional(ThreadId),
});

const MoveTicketTool = Tool.make("kanban_move_ticket", {
  description:
    "Move an existing Kanban ticket in the specified project to TODO, AI, or Done. Entering AI starts a new agent thread in a required worktree with the project's default model and setup script, just like a user moving the ticket. Optional instructions (maximum 8000 characters) are included alongside the ticket in the new thread's first message, before the agent starts. In instructions, the tool replaces $ticketId with the ticket ID, $currThreadId with the calling coordinator's T3 thread ID (not the new worker ID), and $baseBranch with the worktree base ref (the ticket branch, or HEAD when unset). Replacement is a single pass; unknown placeholders stay literal. Ticket title and description are not substituted. Every new thread also receives these three values as coordination context, even without instructions. Instructions apply only when starting a new thread; moving a ticket already in AI does not restart it or send instructions. Omit projectId to use the calling thread's project and omit ticketId to move the ticket linked to the calling thread. Pass both IDs to move another ticket. Returns the linked agentThreadId when present.",
  parameters: Schema.Struct({
    projectId: Schema.optional(ProjectId),
    ticketId: Schema.optional(KanbanCard.fields.id),
    column: KanbanCard.fields.column,
    instructions: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(8_000))),
  }),
  success: KanbanTicketMoveResult,
  failure: Schema.Union([McpCapabilityUnavailableError, KanbanTicketMoveError]),
  dependencies: [
    McpInvocationContext,
    OrchestrationEngineService,
    ProjectionSnapshotQuery,
    ServerSettingsService,
    ProviderRegistry,
    ServerConfig,
    EnvironmentAuth,
    Socket.WebSocketConstructor,
    FileSystem.FileSystem,
    Crypto.Crypto,
  ],
})
  .annotate(Tool.Title, "Move Kanban ticket")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export class KanbanTicketMutationError extends Schema.TaggedError<KanbanTicketMutationError>()(
  "KanbanTicketMutationError",
  { detail: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return this.detail;
  }
}

const TicketMutationParameters = Schema.Struct({
  projectId: ProjectId,
  ticketId: TrimmedNonEmptyString,
  clientRequestId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
});

const UpdateTicketTool = Tool.make("kanban_update_ticket", {
  description:
    "Update a Kanban ticket's title and/or description in the specified project on this environment. Requires exact projectId and ticketId. Omitted fields stay unchanged; an empty description clears it. Title is limited to 200 characters and description to 4000. Preserves column, images, branch and agent thread. Reuse clientRequestId for retries within this provider session to return the original command receipt.",
  parameters: Schema.Struct({
    ...TicketMutationParameters.fields,
    title: Schema.optional(KanbanCard.fields.title),
    description: KanbanCard.fields.description,
  }),
  success: KanbanTicketCreateResult,
  failure: Schema.Union([McpCapabilityUnavailableError, KanbanTicketMutationError]),
  dependencies: [McpInvocationContext, OrchestrationEngineService],
})
  .annotate(Tool.Title, "Update Kanban ticket")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const DeleteTicketTool = Tool.make("kanban_delete_ticket", {
  description:
    "Delete a Kanban ticket from the specified project on this environment. Requires exact projectId and ticketId. Removes only the ticket; its linked agent thread is preserved and any running agent continues. Reuse clientRequestId for retries within this provider session to return the original command receipt even after deletion.",
  parameters: TicketMutationParameters,
  success: KanbanTicketCreateResult,
  failure: Schema.Union([McpCapabilityUnavailableError, KanbanTicketMutationError]),
  dependencies: [McpInvocationContext, OrchestrationEngineService],
})
  .annotate(Tool.Title, "Delete Kanban ticket")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const KanbanToolkit = Toolkit.make(
  ListTicketsTool,
  CreateTicketTool,
  UpdateTicketTool,
  DeleteTicketTool,
  MoveTicketTool,
);

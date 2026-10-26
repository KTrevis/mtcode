import {
  CommandId,
  KanbanCard,
  KanbanTag,
  OrchestratorMcpFailure,
  NonNegativeInt,
  ProjectId,
  TrimmedNonEmptyString,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import { Tool, Toolkit } from "effect/ai";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as DocumentText from "../../../provider/DocumentText.ts";
import * as ServerConfig from "../../../config.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

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
    "Read all Kanban tickets in board order from an active project on this environment. Omit projectId to use the calling thread's project. Returns projectId and tickets with their IDs, titles, descriptions, columns, tagIds, images, branches, and linked agent thread IDs when present. Also returns the project tag catalog as tags with stable IDs and names. An empty board returns an empty tickets array. Does not move tickets or start agents.",
  parameters: Schema.Struct({ projectId: Schema.optional(ProjectId) }),
  success: Schema.Struct({
    projectId: ProjectId,
    tickets: Schema.Array(KanbanCard),
    tags: Schema.Array(KanbanTag),
  }),
  failure: Schema.Union([OrchestratorMcpFailure, KanbanTicketListError]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ProjectService.ProjectService,
    ThreadManagement.ThreadManagementService,
  ],
})
  .annotate(Tool.Title, "List Kanban tickets")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const CreateTicketTool = Tool.make("kanban_create_ticket", {
  description:
    "Create a Kanban ticket in the specified project on this environment. Requires the project's exact projectId, a title (maximum 200 characters), and optionally a description (maximum 4000 characters) and tagIds (up to 10 IDs from the project tag catalog returned by kanban_list_tickets). Appends to TODO without starting an agent. Boards support at most 200 tickets. Reuse clientRequestId for retries within this provider session to avoid duplicate tickets; retries return the original ticket ID and command receipt.",
  parameters: Schema.Struct({
    projectId: ProjectId,
    title: KanbanCard.fields.title,
    description: KanbanCard.fields.description,
    tagIds: KanbanCard.fields.tagIds,
    clientRequestId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  }),
  success: KanbanTicketCreateResult,
  failure: Schema.Union([OrchestratorMcpFailure, KanbanTicketCreateError]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ProjectService.ProjectService,
    ThreadManagement.ThreadManagementService,
    Crypto.Crypto,
  ],
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
  failure: Schema.Union([OrchestratorMcpFailure, KanbanTicketMoveError]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ProjectService.ProjectService,
    ThreadManagement.ThreadManagementService,
    ThreadLaunch.ThreadLaunchService,
    DocumentText.DocumentText,
    ServerSettings.ServerSettingsService,
    ProviderRegistry.ProviderRegistry,
    ServerConfig.ServerConfig,
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
    "Update a Kanban ticket's title, description, tagIds or dependencies in the specified project on this environment. Requires exact projectId and ticketId. dependsOn is a list of ticket IDs in this project; an empty list clears dependencies. Cycles are rejected. Omitted fields stay unchanged; an empty description clears it and an empty tagIds array removes all tags. Title is limited to 200 characters and description to 4000. Preserves column, images, branch and agent thread. Reuse clientRequestId for retries within this provider session to return the original command receipt.",
  parameters: Schema.Struct({
    ...TicketMutationParameters.fields,
    title: Schema.optional(KanbanCard.fields.title),
    description: KanbanCard.fields.description,
    tagIds: KanbanCard.fields.tagIds,
    dependsOn: KanbanCard.fields.dependsOn,
  }),
  success: KanbanTicketCreateResult,
  failure: Schema.Union([OrchestratorMcpFailure, KanbanTicketMutationError]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ProjectService.ProjectService,
    ThreadManagement.ThreadManagementService,
    Crypto.Crypto,
  ],
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
  failure: Schema.Union([OrchestratorMcpFailure, KanbanTicketMutationError]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ProjectService.ProjectService,
    ThreadManagement.ThreadManagementService,
    Crypto.Crypto,
  ],
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

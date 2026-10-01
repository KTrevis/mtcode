import {
  CommandId,
  KanbanCard,
  McpCapabilityUnavailableError,
  NonNegativeInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
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

export const KanbanToolkit = Toolkit.make(CreateTicketTool, UpdateTicketTool, DeleteTicketTool);

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

export const KanbanToolkit = Toolkit.make(CreateTicketTool);

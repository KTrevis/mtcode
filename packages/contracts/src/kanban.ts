import * as Schema from "effect/Schema";
import {
  CommandId,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ChatImageAttachment } from "./chatAttachment.ts";

export const KanbanImage = Schema.Struct({
  // Markdown keeps this stable while the pending upload receives a durable attachment ID.
  id: TrimmedNonEmptyString,
  attachment: ChatImageAttachment,
});
export type KanbanImage = typeof KanbanImage.Type;

export const KanbanTag = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(40)),
});
export type KanbanTag = typeof KanbanTag.Type;
export const KanbanTags = Schema.Array(KanbanTag).check(Schema.isMaxLength(200));

export const KanbanCard = Schema.Struct({
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  description: Schema.optional(Schema.String.check(Schema.isMaxLength(4_000))),
  images: Schema.optional(Schema.Array(KanbanImage).check(Schema.isMaxLength(10))),
  tagIds: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(10))),
  dependsOn: Schema.optional(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(199))),
  agentThreadId: Schema.optional(ThreadId),
  column: Schema.Literals(["TODO", "AI", "Done"]),
});
export type KanbanCard = typeof KanbanCard.Type;
// ponytail: the board lives in project metadata; use a separate projection if larger boards are needed.
export const KanbanCards = Schema.Array(KanbanCard).check(Schema.isMaxLength(200));

const ProjectKanbanTicketCreateCommand = Schema.Struct({
  type: Schema.Literal("project.kanban-ticket.create"),
  commandId: CommandId,
  projectId: ProjectId,
  ticketId: TrimmedNonEmptyString,
  title: KanbanCard.fields.title,
  description: KanbanCard.fields.description,
  tagIds: KanbanCard.fields.tagIds,
});

const ProjectKanbanTicketMoveCommand = Schema.Struct({
  type: Schema.Literal("project.kanban-ticket.move"),
  commandId: CommandId,
  projectId: ProjectId,
  ticketId: KanbanCard.fields.id,
  column: KanbanCard.fields.column,
  agentThreadId: Schema.optional(ThreadId),
  expectedUpdatedAt: Schema.optional(IsoDateTime),
});

const ProjectKanbanTicketUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.kanban-ticket.update"),
  commandId: CommandId,
  projectId: ProjectId,
  ticketId: TrimmedNonEmptyString,
  title: Schema.optional(KanbanCard.fields.title),
  description: KanbanCard.fields.description,
  tagIds: KanbanCard.fields.tagIds,
  dependsOn: KanbanCard.fields.dependsOn,
});

const ProjectKanbanTicketDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.kanban-ticket.delete"),
  commandId: CommandId,
  projectId: ProjectId,
  ticketId: TrimmedNonEmptyString,
});

export const ProjectKanbanCommand = Schema.Union([
  ProjectKanbanTicketCreateCommand,
  ProjectKanbanTicketMoveCommand,
  ProjectKanbanTicketUpdateCommand,
  ProjectKanbanTicketDeleteCommand,
]);
export type ProjectKanbanCommand = typeof ProjectKanbanCommand.Type;

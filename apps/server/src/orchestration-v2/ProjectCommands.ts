import {
  kanbanDependencyError,
  unfinishedKanbanDependencies,
  removeKanbanCard,
} from "@t3tools/shared/kanban";
import {
  type KanbanCard,
  type KanbanTag,
  type ProjectKanbanCommand,
  type CommandId,
  type EventId,
  MAX_SCRIPT_ID_LENGTH,
  type ModelSelection,
  type ProjectIconOverride,
  ProjectId,
  type ProjectScript,
  SCRIPT_RUN_COMMAND_PATTERN,
  type ThreadEnvMode,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { UnsequencedProjectEvent } from "../persistence/OrchestrationEventStore.ts";
import type { ProjectRow } from "./ProjectStore.ts";

export interface ProjectCreateCommand {
  readonly type: "project.create";
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly scripts?: ReadonlyArray<ProjectScript>;
}

export interface ProjectMetaUpdateCommand {
  readonly type: "project.meta.update";
  readonly kanbanCards?: ReadonlyArray<KanbanCard>;
  readonly kanbanTags?: ReadonlyArray<KanbanTag>;
  readonly kanbanExpectedUpdatedAt?: string;
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
  readonly title?: string;
  readonly workspaceRoot?: string;
  readonly defaultModelSelection?: ModelSelection | null;
  readonly defaultThreadEnvMode?: ThreadEnvMode | null;
  readonly autoPull?: boolean;
  readonly faviconPath?: string | null;
  readonly projectIcon?: ProjectIconOverride | null;
  readonly scripts?: ReadonlyArray<ProjectScript>;
}

export interface ProjectDeleteCommand {
  readonly type: "project.delete";
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
}

export type ProjectCommand =
  | ProjectCreateCommand
  | ProjectMetaUpdateCommand
  | ProjectDeleteCommand
  | ProjectKanbanCommand;

export class ProjectCommandInvariantError extends Schema.TaggedError<ProjectCommandInvariantError>()(
  "ProjectCommandInvariantError",
  {
    commandType: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Project command invariant failed (${this.commandType}): ${this.detail}`;
  }
}

export class ProjectCommandMissingProjectError extends Schema.TaggedError<ProjectCommandMissingProjectError>()(
  "ProjectCommandMissingProjectError",
  {
    commandType: Schema.String,
    projectId: ProjectId,
  },
) {
  override get message(): string {
    return `Project '${this.projectId}' does not exist for command '${this.commandType}'.`;
  }
}

export class ProjectWorkspaceConflictError extends Schema.TaggedError<ProjectWorkspaceConflictError>()(
  "ProjectWorkspaceConflictError",
  {
    workspaceRoot: Schema.String,
    conflictingProjectId: ProjectId,
  },
) {
  override get message(): string {
    return `Active project '${this.conflictingProjectId}' already exists for workspace root '${this.workspaceRoot}'.`;
  }
}

export const ProjectCommandRejection = Schema.Union([
  ProjectCommandInvariantError,
  ProjectCommandMissingProjectError,
  ProjectWorkspaceConflictError,
]);
export type ProjectCommandRejection = typeof ProjectCommandRejection.Type;

const ProjectCommandRejectionJson = Schema.fromJsonString(ProjectCommandRejection);
export const encodeProjectCommandRejection = Schema.encodeSync(ProjectCommandRejectionJson);
export const decodeProjectCommandRejection = Schema.decodeUnknownOption(
  ProjectCommandRejectionJson,
);

export interface ProjectCommandState {
  readonly project: ProjectRow | undefined;
  readonly workspaceOwner: ProjectRow | undefined;
}

const monogramSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const isScriptRunCommand = Schema.is(SCRIPT_RUN_COMMAND_PATTERN);

/** Read state and commit the planned event under the project lock. */
export function planProjectCommand(input: {
  readonly command: ProjectCommand;
  readonly state: ProjectCommandState;
  readonly eventId: EventId;
  readonly now: DateTime.Utc;
}): Result.Result<UnsequencedProjectEvent, ProjectCommandRejection> {
  const { command, state } = input;
  const invariant = (detail: string) =>
    Result.fail(new ProjectCommandInvariantError({ commandType: command.type, detail }));
  const missingProject = () =>
    Result.fail(
      new ProjectCommandMissingProjectError({
        commandType: command.type,
        projectId: command.projectId,
      }),
    );
  const activeProject = state.project?.deletedAt === null ? state.project : undefined;
  const requireWorkspaceAvailable = (workspaceRoot: string) =>
    state.workspaceOwner === undefined || state.workspaceOwner.projectId === command.projectId
      ? undefined
      : new ProjectWorkspaceConflictError({
          workspaceRoot,
          conflictingProjectId: state.workspaceOwner.projectId,
        });
  const occurredAt = DateTime.formatIso(input.now);
  const base = {
    eventId: input.eventId,
    aggregateKind: "project" as const,
    aggregateId: command.projectId,
    occurredAt,
    commandId: command.commandId,
    causationEventId: null,
    correlationId: command.commandId,
    metadata: {},
  };

  const validTagIds = (ids: readonly string[] | undefined, tags: readonly KanbanTag[]) =>
    ids === undefined ||
    (new Set(ids).size === ids.length && ids.every((id) => tags.some((tag) => tag.id === id)));
  const updatedCards = (kanbanCards: readonly KanbanCard[]) =>
    Result.succeed({
      ...base,
      type: "project.meta-updated" as const,
      payload: { projectId: command.projectId, kanbanCards, updatedAt: occurredAt },
    });

  switch (command.type) {
    case "project.create": {
      if (state.project !== undefined) {
        return invariant(
          `Project '${command.projectId}' already exists and cannot be created twice.`,
        );
      }
      const conflict = requireWorkspaceAvailable(command.workspaceRoot);
      if (conflict !== undefined) return Result.fail(conflict);
      return Result.succeed({
        ...base,
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: null,
          faviconPath: null,
          projectIcon: null,
          scripts: command.scripts ?? [],
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
    }

    case "project.meta.update": {
      const project = activeProject;
      if (project === undefined) return missingProject();
      if (
        command.projectIcon?.kind === "monogram" &&
        Array.from(monogramSegmenter.segment(command.projectIcon.text)).length > 2
      ) {
        return invariant("Project monograms must contain at most two characters.");
      }
      if (command.scripts !== undefined) {
        // Allow editing or removing persisted invalid script ids, while rejecting new invalid ids.
        const existingIds = new Set(project.scripts.map((script) => script.id));
        for (const script of command.scripts) {
          if (!existingIds.has(script.id) && !isScriptRunCommand(`script.${script.id}.run`)) {
            return invariant(
              `Script IDs must be 1-${MAX_SCRIPT_ID_LENGTH} lowercase letters, digits or hyphens, starting with a letter or digit (got ${script.id.length} characters).`,
            );
          }
        }
      }
      const tags = command.kanbanTags ?? project.kanbanTags ?? [];
      if (
        new Set(tags.map((tag) => tag.id)).size !== tags.length ||
        new Set(tags.map((tag) => tag.name.toLowerCase())).size !== tags.length
      ) {
        return invariant("Kanban tag IDs and names must be unique.");
      }
      if (
        (command.kanbanCards ?? project.kanbanCards ?? []).some(
          (card) =>
            (card.tagIds ?? []).some((id) => !tags.some((tag) => tag.id === id)) ||
            new Set(card.tagIds ?? []).size !== (card.tagIds?.length ?? 0),
        )
      ) {
        return invariant("Tickets must reference existing tags without duplicates.");
      }
      if (
        command.kanbanCards !== undefined &&
        new Set(command.kanbanCards.map((card) => card.id)).size !== command.kanbanCards.length
      ) {
        return invariant("Kanban card IDs must be unique.");
      }
      if (command.kanbanCards !== undefined) {
        const error = kanbanDependencyError(command.kanbanCards);
        const blockedLaunch = command.kanbanCards.some(
          (card) =>
            card.column === "AI" &&
            project.kanbanCards?.find((previous) => previous.id === card.id)?.column !== "AI" &&
            unfinishedKanbanDependencies(card, command.kanbanCards!).length > 0,
        );
        if (error || blockedLaunch) {
          return invariant(error ?? "Complete ticket dependencies before starting an agent.");
        }
      }
      if (
        command.kanbanCards?.some(
          (card) =>
            new Set((card.images ?? []).map((image) => image.id)).size !==
            (card.images?.length ?? 0),
        )
      ) {
        return invariant("Kanban image IDs must be unique within a card.");
      }
      if (
        (command.kanbanCards !== undefined || command.kanbanTags !== undefined) &&
        command.kanbanExpectedUpdatedAt !== project.updatedAt
      ) {
        return invariant("Kanban changed since it was loaded. Refresh and try again.");
      }
      if (command.workspaceRoot !== undefined) {
        const conflict = requireWorkspaceAvailable(command.workspaceRoot);
        if (conflict !== undefined) return Result.fail(conflict);
      }
      return Result.succeed({
        ...base,
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title === undefined ? {} : { title: command.title }),
          ...(command.workspaceRoot === undefined ? {} : { workspaceRoot: command.workspaceRoot }),
          ...(command.defaultModelSelection === undefined
            ? {}
            : { defaultModelSelection: command.defaultModelSelection }),
          ...(command.defaultThreadEnvMode === undefined
            ? {}
            : { defaultThreadEnvMode: command.defaultThreadEnvMode }),
          ...(command.autoPull === undefined ? {} : { autoPull: command.autoPull }),
          ...(command.faviconPath === undefined ? {} : { faviconPath: command.faviconPath }),
          ...(command.projectIcon === undefined ? {} : { projectIcon: command.projectIcon }),
          ...(command.scripts === undefined ? {} : { scripts: command.scripts }),
          ...(command.kanbanCards === undefined ? {} : { kanbanCards: command.kanbanCards }),
          ...(command.kanbanTags === undefined ? {} : { kanbanTags: command.kanbanTags }),
          updatedAt: occurredAt,
        },
      });
    }

    case "project.kanban-ticket.create": {
      const project = activeProject;
      if (!project) return missingProject();
      if (!validTagIds(command.tagIds, project.kanbanTags ?? []))
        return invariant("Tickets must reference existing tags without duplicates.");
      const cards = project.kanbanCards ?? [];
      if (cards.length >= 200) return invariant("Kanban supports at most 200 tickets.");
      if (cards.some((card) => card.id === command.ticketId))
        return invariant("Ticket ID already exists.");
      return updatedCards([
        ...cards,
        {
          id: command.ticketId,
          title: command.title,
          ...(command.description === undefined ? {} : { description: command.description }),
          ...(command.tagIds === undefined ? {} : { tagIds: command.tagIds }),
          column: "TODO",
        },
      ]);
    }
    case "project.kanban-ticket.move": {
      const project = activeProject;
      if (!project) return missingProject();
      const cards = project.kanbanCards ?? [];
      const card = cards.find((candidate) => candidate.id === command.ticketId);
      if (!card) return invariant("Ticket does not exist in an active project.");
      if (
        command.expectedUpdatedAt !== undefined &&
        command.expectedUpdatedAt !== project.updatedAt
      )
        return invariant("Kanban changed since it was loaded. Refresh and try again.");
      if (command.column === "AI" && card.column !== "AI") {
        if (unfinishedKanbanDependencies(card, cards).length)
          return invariant("Complete ticket dependencies before starting an agent.");
        if (!command.agentThreadId)
          return invariant("Moving to AI requires starting an agent thread.");
      }
      const moved = {
        ...card,
        column: command.column,
        ...(command.agentThreadId ? { agentThreadId: command.agentThreadId } : {}),
      };
      return updatedCards(
        card.column === command.column
          ? cards.map((candidate) => (candidate.id === card.id ? moved : candidate))
          : [...cards.filter((candidate) => candidate.id !== card.id), moved],
      );
    }
    case "project.kanban-ticket.update":
    case "project.kanban-ticket.delete": {
      const project = activeProject;
      if (!project) return missingProject();
      const cards = project.kanbanCards ?? [];
      if (!cards.some((card) => card.id === command.ticketId))
        return invariant("Ticket ID does not exist in this project.");
      if (command.type === "project.kanban-ticket.delete")
        return updatedCards(removeKanbanCard(cards, command.ticketId));
      if (!validTagIds(command.tagIds, project.kanbanTags ?? []))
        return invariant("Tickets must reference existing tags without duplicates.");
      if (
        command.title === undefined &&
        command.description === undefined &&
        command.tagIds === undefined &&
        command.dependsOn === undefined
      )
        return invariant("Provide a title, description, tags or dependencies to update.");
      const updated = cards.map((card) =>
        card.id === command.ticketId
          ? {
              ...card,
              ...(command.title === undefined ? {} : { title: command.title }),
              ...(command.description === undefined ? {} : { description: command.description }),
              ...(command.tagIds === undefined ? {} : { tagIds: command.tagIds }),
              ...(command.dependsOn === undefined ? {} : { dependsOn: command.dependsOn }),
            }
          : card,
      );
      const error = kanbanDependencyError(updated);
      return error ? invariant(error) : updatedCards(updated);
    }

    case "project.delete": {
      if (activeProject === undefined) return missingProject();
      // Thread children are deleted by ProjectService before this event commits.
      return Result.succeed({
        ...base,
        type: "project.deleted",
        payload: { projectId: command.projectId, deletedAt: occurredAt },
      });
    }
  }
}

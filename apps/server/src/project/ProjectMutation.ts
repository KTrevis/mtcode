import { type ProjectMutation } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { type ProjectService } from "./ProjectService.ts";

type ProjectMutations = Pick<
  ProjectService["Service"],
  "create" | "delete" | "update" | "mutateKanban"
>;

export const projectMutationOperation = Effect.fn("projectMutationOperation")(function* (
  projects: ProjectMutations,
  mutation: ProjectMutation,
) {
  switch (mutation.type) {
    case "project.kanban-ticket.create":
    case "project.kanban-ticket.move":
    case "project.kanban-ticket.update":
    case "project.kanban-ticket.delete":
      return (yield* projects.mutateKanban(mutation)).project;
    case "project.create":
      return yield* projects.create({
        commandId: mutation.commandId,
        projectId: mutation.projectId,
        title: mutation.title,
        workspaceRoot: mutation.workspaceRoot,
        ...(mutation.createWorkspaceRootIfMissing === undefined
          ? {}
          : { createWorkspaceRootIfMissing: mutation.createWorkspaceRootIfMissing }),
        ...(mutation.defaultModelSelection === undefined
          ? {}
          : { defaultModelSelection: mutation.defaultModelSelection }),
        ...(mutation.scripts === undefined ? {} : { scripts: mutation.scripts }),
      });

    case "project.update":
      return yield* projects.update({
        commandId: mutation.commandId,
        projectId: mutation.projectId,
        ...(mutation.title === undefined ? {} : { title: mutation.title }),
        ...(mutation.workspaceRoot === undefined ? {} : { workspaceRoot: mutation.workspaceRoot }),
        ...(mutation.defaultModelSelection === undefined
          ? {}
          : { defaultModelSelection: mutation.defaultModelSelection }),
        ...(mutation.autoPull === undefined ? {} : { autoPull: mutation.autoPull }),
        ...(mutation.projectIcon === undefined ? {} : { projectIcon: mutation.projectIcon }),
        ...(mutation.faviconPath === undefined ? {} : { faviconPath: mutation.faviconPath }),
        ...(mutation.defaultThreadEnvMode === undefined
          ? {}
          : { defaultThreadEnvMode: mutation.defaultThreadEnvMode }),
        ...(mutation.scripts === undefined ? {} : { scripts: mutation.scripts }),
        ...(mutation.kanbanCards === undefined ? {} : { kanbanCards: mutation.kanbanCards }),
        ...(mutation.kanbanTags === undefined ? {} : { kanbanTags: mutation.kanbanTags }),
        ...(mutation.kanbanExpectedUpdatedAt === undefined
          ? {}
          : { kanbanExpectedUpdatedAt: mutation.kanbanExpectedUpdatedAt }),
      });

    case "project.delete":
      return yield* projects.delete({
        commandId: mutation.commandId,
        projectId: mutation.projectId,
        ...(mutation.force === undefined ? {} : { force: mutation.force }),
      });
  }
});

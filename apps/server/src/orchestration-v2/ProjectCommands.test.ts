import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type KanbanCard,
  type ProjectScript,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

import {
  planProjectCommand,
  type ProjectCommand,
  type ProjectCommandState,
} from "./ProjectCommands.ts";
import type { ProjectRow } from "./ProjectStore.ts";

const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
const projectId = ProjectId.make("project-scripts");

const row = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  projectId,
  title: "Scripts",
  workspaceRoot: "/tmp/scripts",
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

const script = (id: string): ProjectScript => ({
  id,
  name: "Install dependencies",
  command: "vp i",
  icon: "configure",
  runOnWorktreeCreate: false,
});

const plan = (command: ProjectCommand, state: Partial<ProjectCommandState> = {}) =>
  planProjectCommand({
    command,
    state: { project: undefined, workspaceOwner: undefined, ...state },
    eventId: EventId.make("event:planned"),
    now,
  });

const payloadOf = (result: ReturnType<typeof plan>) => {
  assert.isTrue(Result.isSuccess(result));
  return Result.getOrThrow(result).payload as Record<string, unknown>;
};

const failureOf = (result: ReturnType<typeof plan>) => {
  assert.isTrue(Result.isFailure(result));
  return Result.isFailure(result) ? result.failure : assert.fail("expected a rejection");
};

describe("planProjectCommand", () => {
  it("keeps legacy scripts editable and removable while rejecting new invalid ones", () => {
    const legacy = script("install-javascript-dependencies");
    const withLegacy = (scripts: ReadonlyArray<ProjectScript>) =>
      plan(
        {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-repair-script"),
          projectId,
          scripts,
        },
        { project: row({ scripts: [legacy] }) },
      );
    for (const scripts of [[{ ...legacy, command: "vp install" }, script("lint")], []]) {
      assert.deepEqual(payloadOf(withLegacy(scripts)).scripts, scripts);
    }
    assert.equal(
      failureOf(withLegacy([legacy, script("another.invalid.id")]))._tag,
      "ProjectCommandInvariantError",
    );
  });

  it("rejects a workspace root held by another active project", () => {
    const owner = row({
      projectId: ProjectId.make("project-existing"),
      workspaceRoot: "/tmp/project",
    });
    const create = failureOf(
      plan(
        {
          type: "project.create",
          commandId: CommandId.make("cmd-duplicate-root"),
          projectId: ProjectId.make("project-duplicate-root"),
          title: "Duplicate",
          workspaceRoot: "/tmp/project",
        },
        { workspaceOwner: owner },
      ),
    );
    assert.equal(create._tag, "ProjectWorkspaceConflictError");
    assert.equal(
      create.message,
      "Active project 'project-existing' already exists for workspace root '/tmp/project'.",
    );
    const move = failureOf(
      plan(
        {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-move-root"),
          projectId,
          workspaceRoot: "/tmp/project",
        },
        { project: row(), workspaceOwner: owner },
      ),
    );
    assert.equal(move._tag, "ProjectWorkspaceConflictError");
  });

  it("requires the project to exist, and to be absent on create", () => {
    const create: ProjectCommand = {
      type: "project.create",
      commandId: CommandId.make("cmd-create-twice"),
      projectId,
      title: "Twice",
      workspaceRoot: "/tmp/twice",
    };
    assert.include(failureOf(plan(create, { project: row() })).message, "cannot be created twice");
    const deleted = row({ deletedAt: "2026-01-01T00:00:00.000Z" });
    assert.include(
      failureOf(plan(create, { project: deleted })).message,
      "cannot be created twice",
    );
    for (const command of [
      { type: "project.meta.update", commandId: CommandId.make("cmd-missing"), projectId },
      { type: "project.delete", commandId: CommandId.make("cmd-missing"), projectId },
    ] as const) {
      for (const project of [undefined, deleted]) {
        assert.equal(
          failureOf(plan(command, { project }))._tag,
          "ProjectCommandMissingProjectError",
        );
      }
    }
  });
});

describe("Kanban project commands", () => {
  const commandId = CommandId.make("cmd-kanban");
  const cards: ReadonlyArray<KanbanCard> = [
    { id: "first", title: "Foundation", column: "TODO" },
    { id: "second", title: "Follow-up", column: "TODO", dependsOn: ["first"] },
  ];
  const project = row({ kanbanCards: cards, kanbanTags: [{ id: "tag", name: "Feature" }] });

  it("requires completed dependencies and an agent before entering AI", () => {
    const move = {
      type: "project.kanban-ticket.move",
      commandId,
      projectId,
      ticketId: "second",
      column: "AI",
    } as const;
    assert.include(
      failureOf(plan({ ...move, agentThreadId: ThreadId.make("agent") }, { project })).message,
      "dependencies",
    );
    const ready = {
      ...project,
      kanbanCards: cards.map((card) =>
        card.id === "first" ? { ...card, column: "Done" as const } : card,
      ),
    };
    assert.include(failureOf(plan(move, { project: ready })).message, "agent thread");
    assert.deepEqual(
      payloadOf(plan({ ...move, agentThreadId: ThreadId.make("agent") }, { project: ready }))
        .kanbanCards,
      [ready.kanbanCards[0], { ...cards[1], column: "AI", agentThreadId: "agent" }],
    );
  });

  it("rejects cycles, unknown tags and stale board updates", () => {
    assert.include(
      failureOf(
        plan(
          {
            type: "project.kanban-ticket.update",
            commandId,
            projectId,
            ticketId: "first",
            dependsOn: ["second"],
          },
          { project },
        ),
      ).message,
      "cycle",
    );
    assert.include(
      failureOf(
        plan(
          {
            type: "project.kanban-ticket.create",
            commandId,
            projectId,
            ticketId: "third",
            title: "New",
            tagIds: ["missing"],
          },
          { project },
        ),
      ).message,
      "tags",
    );
    assert.include(
      failureOf(
        plan(
          {
            type: "project.kanban-ticket.move",
            commandId,
            projectId,
            ticketId: "first",
            column: "Done",
            expectedUpdatedAt: "2025-01-01T00:00:00.000Z",
          },
          { project },
        ),
      ).message,
      "changed",
    );
  });

  it("removes deleted dependencies and retains unrelated card data", () => {
    assert.deepEqual(
      payloadOf(
        plan(
          { type: "project.kanban-ticket.delete", commandId, projectId, ticketId: "first" },
          { project },
        ),
      ).kanbanCards,
      [{ ...cards[1], dependsOn: [] }],
    );
    assert.deepEqual(
      payloadOf(
        plan(
          {
            type: "project.kanban-ticket.update",
            commandId,
            projectId,
            ticketId: "second",
            title: "Renamed",
          },
          { project },
        ),
      ).kanbanCards,
      [cards[0], { ...cards[1], title: "Renamed" }],
    );
  });
});

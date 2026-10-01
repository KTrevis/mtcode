import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpSchema, McpServer } from "effect/unstable/ai";

import { ServerConfig } from "../../../config.ts";
import { OrchestrationEngineLive } from "../../../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../../../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../../../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../../../orchestration/ThreadPlanProgress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolver } from "../../../project/RepositoryIdentityResolver.ts";
import { KanbanToolkitRegistrationLive } from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { KanbanTicketCreateResult } from "./tools.ts";

const decodeResult = Schema.decodeUnknownEffect(KanbanTicketCreateResult);
const threadId = ThreadId.make("calling-thread");
const targetProjectId = ProjectId.make("target-project");
const projectId = ProjectId.make("project");
const providerInstanceId = ProviderInstanceId.make("codex");
const invocation: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("test-environment"),
  threadId,
  providerSessionId: "test-session",
  providerInstanceId,
  capabilities: new Set(["kanban"]),
  issuedAt: 1,
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "kanban-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "kanban-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const EngineLayer = Layer.mergeAll(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
  ),
  OrchestrationProjectionSnapshotQueryLive,
).pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(SqlitePersistenceMemory),
);
const TestDependencies = Layer.mergeAll(McpServer.McpServer.layer, EngineLayer).pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-kanban-test-" })),
  Layer.provide(NodeServices.layer),
);
const TestLayer = KanbanToolkitRegistrationLive.pipe(
  Layer.provideMerge(TestDependencies),
  Layer.provide(Layer.succeed(RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) })),
  Layer.provide(NodeServices.layer),
);

const makeHarness = Effect.gen(function* () {
  const server = yield* McpServer.McpServer;
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const createdAt = "2026-09-16T00:00:00.000Z";
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("create-project"),
    projectId,
    title: "Project",
    workspaceRoot: "/tmp/mcp-kanban-test",
    createdAt,
  });
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("create-target-project"),
    projectId: targetProjectId,
    title: "Target project",
    workspaceRoot: "/tmp/mcp-kanban-target-test",
    createdAt,
  });
  const call = (args: Record<string, unknown>, scope = invocation, name = "kanban_create_ticket") =>
    server
      .callTool({ name, arguments: args })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
  const readProject = (id = targetProjectId) =>
    snapshots.getProjectShellById(id).pipe(Effect.map(Option.getOrThrow));
  const createTicket = Effect.fn("createKanbanTicket")(function* (
    args: Record<string, unknown>,
    scope = invocation,
  ) {
    const result = yield* call(args, scope);
    expect(result.isError).toBe(false);
    return yield* decodeResult(result.structuredContent);
  });
  return { server, engine, call, createTicket, readProject };
});

it.effect(
  "creates tickets in the explicit project, preserves existing cards, and deduplicates retries",
  () =>
    Effect.gen(function* () {
      const { server, engine, createTicket, readProject } = yield* makeHarness;
      const tool = server.tools.find(({ tool }) => tool.name === "kanban_create_ticket")?.tool;
      expect(tool?.inputSchema).toMatchObject({ type: "object", required: ["projectId", "title"] });
      expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      const input = {
        projectId: targetProjectId,
        title: "  First ticket  ",
        description: "Details",
        clientRequestId: "first",
      };
      const before = yield* engine.latestSequence;
      const [first, retry, second] = yield* Effect.all(
        [
          createTicket(input),
          createTicket(input),
          createTicket({ projectId: targetProjectId, title: "Second ticket" }),
        ],
        { concurrency: "unbounded" },
      );
      expect(first).toEqual(retry);
      expect(first.ticketId).not.toBe(second.ticketId);
      expect(yield* engine.readEvents(before).pipe(Stream.runCollect)).toHaveLength(2);
      expect((yield* readProject()).kanbanCards).toEqual([
        { id: first.ticketId, title: "First ticket", description: "Details", column: "TODO" },
        { id: second.ticketId, title: "Second ticket", column: "TODO" },
      ]);
      expect((yield* readProject(projectId)).kanbanCards ?? []).toEqual([]);
      const after = yield* engine.latestSequence;
      expect(yield* createTicket(input)).toEqual(first);
      expect(yield* engine.latestSequence).toBe(after);
    }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "rejects invalid inputs, missing capability, missing projects, and deleted projects",
  () =>
    Effect.gen(function* () {
      const { engine, call, readProject } = yield* makeHarness;
      const before = yield* engine.latestSequence;
      for (const args of [
        {},
        { title: "Missing project" },
        { projectId: targetProjectId, title: " " },
        { projectId: targetProjectId, title: "x".repeat(201) },
        { projectId: targetProjectId, title: "Valid", description: "x".repeat(4001) },
      ]) {
        expect((yield* call(args).pipe(Effect.flip))._tag).toBe("InvalidParams");
      }
      const input = { projectId: targetProjectId, title: "Denied" };
      const denied = yield* call(input, { ...invocation, capabilities: new Set() });
      expect(denied.isError).toBe(true);
      expect(denied.content).toEqual([
        { type: "text", text: "MCP credential does not grant the kanban capability." },
      ]);
      expect((yield* call({ ...input, projectId: "missing" })).isError).toBe(true);
      expect(yield* engine.latestSequence).toBe(before);
      expect((yield* readProject()).kanbanCards ?? []).toEqual([]);
      yield* engine.dispatch({
        type: "project.delete",
        projectId: targetProjectId,
        force: true,
        commandId: CommandId.make("delete-target"),
      });
      const deletedAt = yield* engine.latestSequence;
      expect((yield* call(input)).isError).toBe(true);
      expect(yield* engine.latestSequence).toBe(deletedAt);
    }).pipe(Effect.provide(TestLayer)),
);

it.effect("enforces the board limit without losing existing tickets", () =>
  Effect.gen(function* () {
    const { engine, call, createTicket, readProject } = yield* makeHarness;
    const cards = Array.from({ length: 199 }, (_, index) => ({
      id: `existing-${index}`,
      title: `Ticket ${index}`,
      column: "Done" as const,
    }));
    const project = yield* readProject();
    yield* engine.dispatch({
      type: "project.meta.update",
      commandId: CommandId.make("seed-board"),
      projectId: targetProjectId,
      kanbanCards: cards,
      kanbanExpectedUpdatedAt: project.updatedAt,
    });
    const input = { projectId: targetProjectId, title: "Last ticket", clientRequestId: "last" };
    const last = yield* createTicket(input);
    expect((yield* readProject()).kanbanCards?.slice(0, 199)).toEqual(cards);
    expect((yield* readProject()).kanbanCards).toHaveLength(200);
    expect(yield* createTicket(input)).toEqual(last);
    const before = yield* engine.latestSequence;
    const overflow = yield* call({ projectId: targetProjectId, title: "Overflow" });
    expect(overflow.isError).toBe(true);
    expect(overflow.content).toEqual([
      {
        type: "text",
        text: "Orchestration command invariant failed (project.kanban-ticket.create): Kanban supports at most 200 tickets.",
      },
    ]);
    expect(yield* engine.latestSequence).toBe(before);
    expect((yield* readProject()).kanbanCards).toHaveLength(200);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "updates and deletes tickets atomically, preserves metadata, and deduplicates retries",
  () =>
    Effect.gen(function* () {
      const { server, engine, call, createTicket, readProject } = yield* makeHarness;
      for (const name of ["kanban_update_ticket", "kanban_delete_ticket"]) {
        expect(server.tools.find(({ tool }) => tool.name === name)?.tool.annotations).toMatchObject(
          {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
          },
        );
      }
      const first = yield* createTicket({ projectId: targetProjectId, title: "First" });
      const second = yield* createTicket({ projectId: targetProjectId, title: "Second" });
      const project = yield* readProject();
      const cards = project.kanbanCards!.map((card) => ({
        ...card,
        branch: "feature",
        agentThreadId: threadId,
        column: "Done" as const,
        images: [],
      }));
      yield* engine.dispatch({
        type: "project.meta.update",
        commandId: CommandId.make("seed-metadata"),
        projectId: targetProjectId,
        kanbanCards: cards,
        kanbanExpectedUpdatedAt: project.updatedAt,
      });
      const update = {
        projectId: targetProjectId,
        ticketId: first.ticketId,
        title: "  Updated  ",
        clientRequestId: "update",
      };
      const before = yield* engine.latestSequence;
      const results = yield* Effect.all(
        [
          call(update, invocation, "kanban_update_ticket"),
          call(
            { projectId: targetProjectId, ticketId: first.ticketId, description: "Details" },
            invocation,
            "kanban_update_ticket",
          ),
          call(
            { projectId: targetProjectId, ticketId: second.ticketId, clientRequestId: "delete" },
            invocation,
            "kanban_delete_ticket",
          ),
        ],
        { concurrency: "unbounded" },
      );
      expect(results.every((result) => !result.isError)).toBe(true);
      expect(yield* engine.readEvents(before).pipe(Stream.runCollect)).toHaveLength(3);
      expect((yield* readProject()).kanbanCards).toEqual([
        { ...cards[0], title: "Updated", description: "Details" },
      ]);
      expect((yield* readProject(projectId)).kanbanCards ?? []).toEqual([]);
      const after = yield* engine.latestSequence;
      expect((yield* call(update, invocation, "kanban_update_ticket")).structuredContent).toEqual(
        results[0]!.structuredContent,
      );
      expect(
        (yield* call(
          { projectId: targetProjectId, ticketId: second.ticketId, clientRequestId: "delete" },
          invocation,
          "kanban_delete_ticket",
        )).structuredContent,
      ).toEqual(results[2]!.structuredContent);
      expect(yield* engine.latestSequence).toBe(after);
      expect(
        (yield* call(
          { projectId: targetProjectId, ticketId: first.ticketId, description: "" },
          invocation,
          "kanban_update_ticket",
        )).isError,
      ).toBe(false);
      expect((yield* readProject()).kanbanCards?.[0]?.description).toBe("");
    }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "rejects invalid mutations, missing tickets, missing capability, and deleted projects",
  () =>
    Effect.gen(function* () {
      const { engine, call, createTicket, readProject } = yield* makeHarness;
      const ticket = yield* createTicket({ projectId: targetProjectId, title: "Keep" });
      const input = { projectId: targetProjectId, ticketId: ticket.ticketId };
      const before = yield* engine.latestSequence;
      for (const args of [
        { projectId: targetProjectId, title: "Missing ID" },
        { ...input, title: " " },
        { ...input, title: "x".repeat(201) },
        { ...input, description: "x".repeat(4001) },
      ]) {
        expect((yield* call(args, invocation, "kanban_update_ticket").pipe(Effect.flip))._tag).toBe(
          "InvalidParams",
        );
      }
      expect((yield* call(input, invocation, "kanban_update_ticket")).isError).toBe(true);
      for (const name of ["kanban_update_ticket", "kanban_delete_ticket"]) {
        const args = { ...input, title: "Changed" };
        expect((yield* call({ ...args, ticketId: "missing" }, invocation, name)).isError).toBe(
          true,
        );
        expect((yield* call({ ...args, projectId }, invocation, name)).isError).toBe(true);
        expect((yield* call({ ...args, projectId: "missing" }, invocation, name)).isError).toBe(
          true,
        );
        expect((yield* call(args, { ...invocation, capabilities: new Set() }, name)).isError).toBe(
          true,
        );
        expect(
          (yield* call({ ...args, ticketId: " " }, invocation, name).pipe(Effect.flip))._tag,
        ).toBe("InvalidParams");
      }
      expect(yield* engine.latestSequence).toBe(before);
      expect((yield* readProject()).kanbanCards).toEqual([
        { id: ticket.ticketId, title: "Keep", column: "TODO" },
      ]);
      yield* engine.dispatch({
        type: "project.delete",
        projectId: targetProjectId,
        force: true,
        commandId: CommandId.make("delete-project"),
      });
      const after = yield* engine.latestSequence;
      for (const name of ["kanban_update_ticket", "kanban_delete_ticket"]) {
        expect((yield* call({ ...input, title: "Changed" }, invocation, name)).isError).toBe(true);
      }
      expect(yield* engine.latestSequence).toBe(after);
    }).pipe(Effect.provide(TestLayer)),
);

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  AuthSessionId,
  ClientOrchestrationCommand,
  OrchestrationCommand,
  ProviderDriverKind,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Socket from "effect/unstable/socket/Socket";
import { EnvironmentAuth } from "../../../auth/EnvironmentAuth.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { persistServerRuntimeState } from "../../../serverRuntimeState.ts";
import { layerTest as SettingsLayer } from "../../../serverSettings.ts";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
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
import { KanbanTicketCreateResult, KanbanTicketMoveResult } from "./tools.ts";

const decodeResult = Schema.decodeUnknownEffect(KanbanTicketCreateResult);
const encodeRpcResponse = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeMoveResult = Schema.decodeUnknownEffect(KanbanTicketMoveResult);
const decodeRpcRequest = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      _tag: Schema.String,
      id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      payload: Schema.optional(ClientOrchestrationCommand),
    }),
  ),
);
const decodeCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
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
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-kanban-test-" })),
  Layer.provide(NodeServices.layer),
);
const makeTestLayer = <E = never>(
  providerLayer = Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([]) }),
  socketLayer: Layer.Layer<Socket.WebSocketConstructor, E> = Socket.layerWebSocketConstructorGlobal,
  authLayer = Layer.mock(EnvironmentAuth)({}),
) =>
  KanbanToolkitRegistrationLive.pipe(
    Layer.provideMerge(TestDependencies),
    Layer.provide(
      Layer.succeed(RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) }),
    ),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(SettingsLayer()),
    Layer.provideMerge(providerLayer),
    Layer.provideMerge(authLayer),
    Layer.provideMerge(socketLayer),
  );

const TestLayer = makeTestLayer();

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
  const call = (args: Record<string, unknown>, scope = invocation) =>
    server
      .callTool({ name: "kanban_create_ticket", arguments: args })
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
  const move = (args: Record<string, unknown>, scope = invocation) =>
    server
      .callTool({ name: "kanban_move_ticket", arguments: args })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
  return { server, engine, call, createTicket, readProject, move };
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

it.effect("moves tickets without overwriting other cards and validates move requests", () =>
  Effect.gen(function* () {
    const { createTicket, readProject, move, engine } = yield* makeHarness;
    const first = yield* createTicket({ projectId: targetProjectId, title: "First" });
    const second = yield* createTicket({ projectId: targetProjectId, title: "Second" });
    const input = { projectId: targetProjectId, ticketId: first.ticketId, column: "Done" };
    const moved = yield* move(input);
    expect(moved.isError).toBe(false);
    expect(yield* decodeMoveResult(moved.structuredContent)).toMatchObject(input);
    expect((yield* readProject()).kanbanCards).toEqual([
      { id: second.ticketId, title: "Second", column: "TODO" },
      { id: first.ticketId, title: "First", column: "Done" },
    ]);
    expect((yield* move({ ...input, column: "TODO" })).isError).toBe(false);
    expect(
      (yield* engine
        .dispatch({
          type: "project.kanban-ticket.move",
          commandId: CommandId.make("missing-agent"),
          projectId: targetProjectId,
          ticketId: first.ticketId,
          column: "AI",
        })
        .pipe(Effect.flip)).message,
    ).toContain("requires starting an agent thread");
    expect(
      (yield* engine
        .dispatch({
          type: "project.kanban-ticket.move",
          commandId: CommandId.make("stale-move"),
          projectId: targetProjectId,
          ticketId: first.ticketId,
          column: "Done",
          expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
        })
        .pipe(Effect.flip)).message,
    ).toContain("Kanban changed");
    const before = yield* engine.latestSequence;
    expect((yield* move(input, { ...invocation, capabilities: new Set() })).isError).toBe(true);
    expect((yield* move({ ...input, ticketId: "missing" })).isError).toBe(true);
    expect((yield* move({ ...input, projectId })).isError).toBe(true);
    expect((yield* move({ ...input, column: "invalid" }).pipe(Effect.flip))._tag).toBe(
      "InvalidParams",
    );
    expect((yield* move({ ...input, column: "AI" })).isError).toBe(true);
    expect(yield* engine.latestSequence).toBe(before);
    yield* engine.dispatch({
      type: "project.delete",
      commandId: CommandId.make("delete-move-project"),
      projectId: targetProjectId,
      force: true,
    });
    expect((yield* move(input)).isError).toBe(true);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "entering AI launches through client bootstrap, preserves attachments, and supports restarting after leaving AI",
  () => {
    const images = [
      {
        id: "image",
        attachment: {
          type: "image" as const,
          id: "attachment",
          name: "shot.png",
          mimeType: "image/png",
          sizeBytes: 12,
        },
      },
    ];
    const launches: ClientOrchestrationCommand[] = [];
    let failLaunch = false;
    const socketLayer = Layer.effect(
      Socket.WebSocketConstructor,
      Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const requests = yield* Queue.unbounded<{
          data: string | Uint8Array;
          events: EventTarget;
        }>();
        yield* Effect.forever(
          Effect.gen(function* () {
            const { data, events } = yield* Queue.take(requests);

            const request = yield* decodeRpcRequest(
              typeof data === "string" ? data : new TextDecoder().decode(data),
            );
            if (request._tag !== "Request" || !request.payload) return;
            const command = request.payload;
            const exit = yield* Effect.gen(function* () {
              launches.push(command);
              if (failLaunch)
                return {
                  _tag: "Failure",
                  cause: [
                    {
                      _tag: "Fail",
                      error: { _tag: "OrchestrationDispatchCommandError", message: "failed" },
                    },
                  ],
                };
              expect(command.type).toBe("thread.turn.start");
              if (command.type !== "thread.turn.start" || !command.bootstrap?.createThread)
                return yield* Effect.die("Missing bootstrap");
              expect(command.bootstrap).toMatchObject({
                createThread: {
                  projectId: targetProjectId,
                  branch: "main",
                  title: "Launch",
                  runtimeMode: "full-access",
                },
                prepareWorktree: {
                  projectCwd: "/tmp/mcp-kanban-target-test",
                  baseBranch: "main",
                  requireWorktree: true,
                },
                runSetupScript: true,
              });
              expect(command.message).toMatchObject({
                text: expect.stringContaining("# Launch\n\nDetails"),
                attachments: images.map((image) => image.attachment),
              });
              yield* engine.dispatch({
                type: "thread.create",
                commandId: CommandId.make(`create-${command.threadId}`),
                threadId: command.threadId,
                ...command.bootstrap.createThread,
              });
              const { bootstrap: _bootstrap, ...turn } = command;
              const result = yield* engine.dispatch(yield* decodeCommand(turn));
              return { _tag: "Success", value: result };
            });
            events.dispatchEvent(
              new MessageEvent("message", {
                data: yield* encodeRpcResponse({ _tag: "Exit", requestId: request.id, exit }),
              }),
            );
          }).pipe(Effect.orDie),
        ).pipe(Effect.forkScoped);
        return (url: string): Socket.WebSocketLike => {
          expect(url).toBe("ws://127.0.0.1:1234/ws?wsTicket=test-ticket");
          const events = new EventTarget();
          return {
            readyState: 1,
            addEventListener: (type, listener, options) =>
              events.addEventListener(
                type,
                listener as Exclude<Parameters<EventTarget["addEventListener"]>[1], null>,
                options,
              ),
            removeEventListener: (type, listener) =>
              events.removeEventListener(
                type,
                listener as Exclude<Parameters<EventTarget["addEventListener"]>[1], null>,
              ),
            close: () => {},
            send: (data) => {
              Queue.offerUnsafe(requests, { data, events });
            },
          };
        };
      }),
    ).pipe(
      Layer.provide(TestDependencies),
      Layer.provide(
        Layer.succeed(RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) }),
      ),
    );
    const launchLayer = makeTestLayer(
      Layer.mock(ProviderRegistry)({
        getProviders: Effect.succeed([
          {
            instanceId: providerInstanceId,
            driver: ProviderDriverKind.make("codex"),
            version: "1.0.0",
            enabled: true,
            installed: true,
            status: "ready",
            auth: { status: "authenticated" },
            checkedAt: "2026-09-16T00:00:00.000Z",
            models: [],
            slashCommands: [],
            skills: [],
          },
        ]),
      }),
      socketLayer,
      Layer.mock(EnvironmentAuth)({
        issueSession: () =>
          DateTime.now.pipe(
            Effect.map((expiresAt) => ({
              sessionId: AuthSessionId.make("launch-session"),
              token: "test-token",
              method: "bearer-access-token" as const,
              scopes: ["orchestration:operate" as const],
              subject: "test",
              client: { deviceType: "bot" as const },
              expiresAt,
            })),
          ),
        revokeSession: () => Effect.succeed(true),
        issueWebSocketTicket: () =>
          DateTime.now.pipe(Effect.map((expiresAt) => ({ ticket: "test-ticket", expiresAt }))),
      }),
    );
    return Effect.gen(function* () {
      const { createTicket, readProject, move, engine } = yield* makeHarness;
      const config = yield* ServerConfig;
      yield* persistServerRuntimeState({
        path: config.serverRuntimeStatePath,
        state: {
          version: 1,
          pid: process.pid,
          port: 1234,
          origin: "http://127.0.0.1:1234",
          startedAt: "2026-09-16T00:00:00.000Z",
        },
      });
      const ticket = yield* createTicket({
        projectId: targetProjectId,
        title: "Launch",
        description: "Details",
      });
      const project = yield* readProject();
      yield* engine.dispatch({
        type: "project.meta.update",
        commandId: CommandId.make("attach-image"),
        projectId: targetProjectId,
        kanbanExpectedUpdatedAt: project.updatedAt,
        kanbanCards: [{ ...project.kanbanCards![0]!, branch: "main", images }],
      });
      const runMove = (column: string) =>
        move({ projectId: targetProjectId, ticketId: ticket.ticketId, column });
      const [first, concurrent] = yield* Effect.all([runMove("AI"), runMove("AI")], {
        concurrency: "unbounded",
      });
      expect(
        first.isError,
        first.content.map((item) => (item.type === "text" ? item.text : item.type)).join("\n"),
      ).toBe(false);
      expect(concurrent.isError).toBe(false);
      expect(launches).toHaveLength(1);
      const firstThread = (yield* readProject()).kanbanCards![0]!.agentThreadId;
      expect(firstThread).toBeDefined();
      expect(
        (yield* move({ column: "Done" }, { ...invocation, threadId: firstThread! })).isError,
      ).toBe(false);
      expect((yield* readProject()).kanbanCards![0]!.agentThreadId).toBe(firstThread);
      failLaunch = true;
      expect((yield* runMove("AI")).isError).toBe(true);
      expect((yield* readProject()).kanbanCards![0]!.column).toBe("Done");
      failLaunch = false;
      expect((yield* runMove("AI")).isError).toBe(false);
      expect((yield* readProject()).kanbanCards![0]!.agentThreadId).not.toBe(firstThread);
    }).pipe(Effect.provide(launchLayer));
  },
);

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as DocumentText from "../../../provider/DocumentText.ts";
import * as ServerConfig from "../../../config.ts";
import * as Registry from "../../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpContext from "../../McpInvocationContext.ts";
import { startTicket } from "./startTicket.ts";

it.effect("launches a ticket in a worktree with single-pass coordination instructions", () =>
  Effect.gen(function* () {
    const launched: Array<ThreadLaunch.ThreadLaunchInput> = [];
    const projectId = ProjectId.make("project");
    const coordinatorId = ThreadId.make("coordinator");
    const instanceId = ProviderInstanceId.make("codex");
    const modelSelection = { instanceId, model: "gpt-5" };
    const project = {
      id: projectId,
      workspaceRoot: "/project",
      kanbanCards: [],
    } as unknown as OrchestrationProjectShell;
    const dependencies = Layer.mergeAll(
      NodeCrypto.layer,
      NodeServices.layer,
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-kanban-launch-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
      DocumentText.layer.pipe(Layer.provide(NodeServices.layer)),
      ServerSettings.layerTest({ defaultModelSelection: modelSelection }),
      Layer.succeed(McpContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment"),
        capabilities: new Set(["orchestration" as const]),
        requestNamespace: "session",
        issuedAt: 0,
        thread: {
          threadId: coordinatorId,
          providerSessionId: "session",
          providerInstanceId: instanceId,
        },
        client: undefined,
      }),
      Layer.mock(Registry.ProviderRegistry)({
        getProviders: Effect.succeed([
          {
            instanceId,
            enabled: true,
            status: "ready",
            availability: "available",
            driver: "codex",
            models: [],
          } as unknown as ServerProvider,
        ]),
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () =>
          Effect.succeed({
            id: coordinatorId,
            deletedAt: null,
            runtimeMode: "full-access",
            interactionMode: "default",
          } as unknown as OrchestrationV2ThreadShell),
      }),
      Layer.mock(ThreadLaunch.ThreadLaunchService)({
        launch: (input) => {
          launched.push(input);
          return Effect.succeed({
            threadId: input.threadId!,
            resumed: false,
            projection: {} as ThreadLaunch.ThreadLaunchResult["projection"],
          });
        },
      }),
    );
    const blocked = yield* startTicket(
      { ...project, kanbanCards: [{ id: "dependency", title: "First", column: "TODO" }] },
      { id: "blocked", title: "Second", column: "TODO", dependsOn: ["dependency"] },
    ).pipe(Effect.flip, Effect.provide(dependencies));
    expect(blocked.message).toBe("Complete ticket dependencies before starting an agent.");
    expect(launched).toHaveLength(0);
    const threadId = yield* startTicket(
      project,
      {
        id: "ticket-$baseBranch",
        title: "Implement",
        column: "TODO",
        description: "Keep $ticketId literal",
        branch: "main",
      },
      "$ticketId $currThreadId $baseBranch $unknown",
    ).pipe(Effect.provide(dependencies));
    expect(launched).toHaveLength(1);
    expect(launched[0]?.threadId).toBe(threadId);
    expect(launched[0]?.workspaceStrategy).toEqual({ type: "worktree", baseRef: "main" });
    expect(launched[0]?.initialMessage?.text).toContain(
      "ticket-$baseBranch coordinator main $unknown",
    );
    expect(launched[0]?.initialMessage?.text).toContain("Keep $ticketId literal");
    expect(launched[0]?.initialMessage?.senderThreadId).toBe(coordinatorId);
  }),
);

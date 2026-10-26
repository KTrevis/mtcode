import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Projects from "../../../project/ProjectService.ts";
import * as DocumentText from "../../../provider/DocumentText.ts";
import * as ServerConfig from "../../../config.ts";
import * as McpContext from "../../McpInvocationContext.ts";
import * as ComputerTaskBroker from "../../ComputerTaskBroker.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import { __testing } from "./handlers.ts";

it.effect(
  "starts local computer work with source attribution and refuses unknown destinations",
  () =>
    Effect.gen(function* () {
      const launched: Array<ThreadLaunch.ThreadLaunchInput> = [];
      const environmentId = EnvironmentId.make("environment");
      const projectId = ProjectId.make("project");
      const sourceId = ThreadId.make("source");
      const instanceId = ProviderInstanceId.make("codex");
      const dependencies = Layer.mergeAll(
        NodeCrypto.layer,
        NodeServices.layer,
        ComputerTaskBroker.layer.pipe(Layer.provide(NodeCrypto.layer)),
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-computer-launch-" }).pipe(
          Layer.provide(NodeServices.layer),
        ),
        DocumentText.layer.pipe(Layer.provide(NodeServices.layer)),
        Layer.succeed(McpContext.McpInvocationContext, {
          environmentId,
          capabilities: new Set(["orchestration" as const]),
          requestNamespace: "session",
          issuedAt: 0,
          thread: {
            threadId: sourceId,
            providerSessionId: "session",
            providerInstanceId: instanceId,
          },
          client: undefined,
        }),
        Layer.succeed(ServerEnvironment.ServerEnvironment, {
          getEnvironmentId: Effect.succeed(environmentId),
          getDescriptor: Effect.succeed({
            environmentId,
            label: "Mac",
            platform: { os: "darwin" as const, arch: "arm64" as const },
            serverVersion: "1",
            capabilities: { repositoryIdentity: false },
          }),
        }),
        Layer.mock(Projects.ProjectService)({
          listShells: () =>
            Effect.succeed([
              {
                id: projectId,
                title: "Project",
                workspaceRoot: "/project",
              } as unknown as OrchestrationProjectShell,
            ]),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () =>
            Effect.succeed({
              id: sourceId,
              projectId,
              archivedAt: null,
              runtimeMode: "full-access",
              interactionMode: "default",
              modelSelection: { instanceId, model: "gpt-5" },
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
      const rejected = yield* __testing
        .computerSend({ computer: "toaster", message: "Build" })
        .pipe(Effect.flip, Effect.provide(dependencies));
      expect(rejected.code).toBe("computer_not_found");
      expect(launched).toHaveLength(0);
      const result = yield* __testing
        .computerSend({ computer: "this", message: "Build the installer." })
        .pipe(Effect.provide(dependencies));
      expect(launched).toHaveLength(1);
      expect(result.threadId).toBe(launched[0]?.threadId);
      expect(launched[0]?.workspaceStrategy).toEqual({ type: "root" });
      expect(launched[0]?.initialMessage?.text).toContain("Source thread: source");
      expect(launched[0]?.initialMessage?.text).toContain("Build the installer.");
    }),
);

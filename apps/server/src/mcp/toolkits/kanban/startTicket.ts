import {
  AuthOrchestrationOperateScope,
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  WsRpcGroup,
  ORCHESTRATION_WS_METHODS,
  MessageId,
  ThreadId,
  type KanbanCard,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadRuntimeMode } from "@t3tools/shared/serverSettings";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

import { EnvironmentAuth } from "../../../auth/EnvironmentAuth.ts";
import { ServerConfig } from "../../../config.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { readPersistedServerRuntimeState } from "../../../serverRuntimeState.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";
import { KanbanTicketMoveError } from "./tools.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";

const makeClient = RpcClient.make(WsRpcGroup);
const isKanbanTicketMoveError = Schema.is(KanbanTicketMoveError);

export const startTicket = Effect.fn("KanbanToolkit.startTicket")(
  function* (project: OrchestrationProjectShell, card: KanbanCard, instructions?: string) {
    const scope = yield* McpInvocationContext;
    const baseBranch = card.branch ?? "HEAD";
    const agentInstructions = instructions?.replace(
      /\$(ticketId|currThreadId|baseBranch)\b/g,
      (placeholder) =>
        placeholder === "$ticketId"
          ? card.id
          : placeholder === "$currThreadId"
            ? scope.threadId
            : baseBranch,
    );
    const settingsService = yield* ServerSettingsService;
    const registry = yield* ProviderRegistry;
    const settings = resolveProjectSettings(
      yield* settingsService.getSettings,
      project.id,
      project,
    ).settings;
    const providers = yield* registry.getProviders;
    const selectable = providers.filter(
      (provider) => provider.enabled && provider.availability !== "unavailable",
    );
    const selection = settings.defaultModelSelection;
    const provider =
      selectable.find((entry) => entry.instanceId === selection?.instanceId) ??
      selectable.find((entry) => entry.status === "ready") ??
      selectable.find((entry) => entry.status !== "error");
    if (!provider) {
      return yield* new KanbanTicketMoveError({
        detail: "Choose an available default model for this project first.",
        cause: null,
      });
    }
    const model =
      selection?.instanceId === provider.instanceId
        ? selection.model
        : (provider.models.find((model) => model.isDefault && !model.isCustom)?.slug ??
          provider.models.find((model) => !model.isCustom)?.slug ??
          provider.models[0]?.slug ??
          DEFAULT_MODEL_BY_PROVIDER[provider.driver]);
    if (!model) {
      return yield* new KanbanTicketMoveError({
        detail: "Choose an available default model for this project first.",
        cause: null,
      });
    }
    const modelSelection =
      selection?.instanceId === provider.instanceId
        ? selection
        : { instanceId: provider.instanceId, model };
    const config = yield* ServerConfig;
    const runtime = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    if (Option.isNone(runtime)) {
      return yield* new KanbanTicketMoveError({
        detail: "Server runtime address is unavailable.",
        cause: null,
      });
    }
    const auth = yield* EnvironmentAuth;
    const crypto = yield* Crypto.Crypto;
    const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);
    const threadId = ThreadId.make(yield* uuid);
    const runtimeMode = resolveNewThreadRuntimeMode(settings, modelSelection.instanceId);
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    // Use the same WebSocket dispatch as clients: it owns attachment claims,
    // required worktree bootstrap, setup, cancellation, and rollback.
    yield* Effect.scoped(
      Effect.gen(function* () {
        const session = yield* Effect.acquireRelease(
          auth.issueSession({
            scopes: [AuthOrchestrationOperateScope],
            label: "Kanban agent launch",
            ttl: Duration.hours(1),
          }),
          (issued) => auth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
        );
        const ticket = yield* auth.issueWebSocketTicket(session);
        const url = new URL("/ws", runtime.value.origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("wsTicket", ticket.ticket);
        const protocol = RpcClient.layerProtocolSocket().pipe(
          Layer.provide(Socket.layerWebSocket(url.toString())),
          Layer.provide(RpcSerialization.layerJson),
        );
        yield* Effect.gen(function* () {
          const client = yield* makeClient;
          yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
            type: "thread.turn.start",
            commandId: CommandId.make(yield* uuid),
            threadId,
            message: {
              messageId: MessageId.make(yield* uuid),
              role: "user",
              text: `Implement this Kanban ticket in the project.\n\n# ${card.title}\n\n${card.description?.trim() || "No description provided."}${card.images?.length ? "\n\nThe kanban-image references in the description correspond to the attached images, in the same order." : ""}\n\n## Coordination context\n\nTicket ID: ${card.id}\nCoordinator thread ID: ${scope.threadId}\nBase branch: ${baseBranch}${agentInstructions ? `\n\n## Agent instructions\n\n${agentInstructions}` : ""}`,
              attachments: (card.images ?? []).map((image) => image.attachment),
            },
            modelSelection,
            titleSeed: card.title,
            runtimeMode,
            interactionMode: "default",
            bootstrap: {
              createThread: {
                projectId: project.id,
                title: card.title,
                modelSelection,
                runtimeMode,
                interactionMode: "default",
                branch: card.branch ?? null,
                worktreePath: null,
                createdAt,
              },
              prepareWorktree: {
                projectCwd: project.workspaceRoot,
                baseBranch,
                branch: buildTemporaryWorktreeBranchName(() => threadId),
                requireWorktree: true,
              },
              runSetupScript: true,
            },
            createdAt,
          });
        }).pipe(Effect.provide(protocol));
      }),
    );
    return threadId;
  },
  Effect.mapError((cause) =>
    isKanbanTicketMoveError(cause)
      ? cause
      : new KanbanTicketMoveError({ detail: cause.message, cause }),
  ),
);

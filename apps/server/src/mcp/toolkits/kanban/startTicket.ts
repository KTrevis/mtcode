import { unfinishedKanbanDependencies } from "@t3tools/shared/kanban";
import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  MessageId,
  ThreadId,
  type KanbanCard,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadRuntimeMode } from "@t3tools/shared/serverSettings";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ProviderRegistry } from "../../../provider/ProviderRegistry.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";
import * as ThreadMessageIntake from "../../../orchestration-v2/ThreadMessageIntake.ts";
import { readCaller } from "../../threadAccess.ts";
import { resolveRuntimeMode, resolveInteractionMode } from "../../OrchestratorMcpService.ts";
import { KanbanTicketMoveError } from "./tools.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";

const isKanbanTicketMoveError = Schema.is(KanbanTicketMoveError);

export const startTicket = Effect.fn("KanbanToolkit.startTicket")(
  function* (project: OrchestrationProjectShell, card: KanbanCard, instructions?: string) {
    if (unfinishedKanbanDependencies(card, project.kanbanCards ?? []).length) {
      return yield* new KanbanTicketMoveError({
        detail: "Complete ticket dependencies before starting an agent.",
        cause: null,
      });
    }
    const scope = yield* McpInvocationContext;
    const settingsService = yield* ServerSettingsService;
    const registry = yield* ProviderRegistry;
    const settings = resolveProjectSettings(
      yield* settingsService.getSettings,
      project.id,
      project,
    ).settings;
    const baseBranch = card.branch ?? (settings.defaultThreadBranch || "HEAD");
    const agentInstructions = instructions?.replace(
      /\$(ticketId|currThreadId|baseBranch)\b/g,
      (placeholder) =>
        placeholder === "$ticketId"
          ? card.id
          : placeholder === "$currThreadId"
            ? (scope.thread?.threadId ?? "external client")
            : baseBranch,
    );
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
    const crypto = yield* Crypto.Crypto;
    const threadId = ThreadId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie));
    const runtimeMode = resolveNewThreadRuntimeMode(settings, modelSelection.instanceId);
    const { limits } = yield* readCaller();
    const allowedRuntimeMode = yield* resolveRuntimeMode(limits.runtimeMode, runtimeMode);
    const allowedInteractionMode = yield* resolveInteractionMode(limits.interactionMode, "default");
    yield* ThreadMessageIntake.launchThread({
      commandId: CommandId.make(threadId),
      threadId,
      projectId: project.id,
      title: card.title,
      modelSelection,
      runtimeMode: allowedRuntimeMode,
      interactionMode: allowedInteractionMode,
      workspaceStrategy: { type: "worktree", baseRef: baseBranch },
      initialMessage: {
        messageId: MessageId.make(threadId),
        ...(scope.thread ? { senderThreadId: scope.thread.threadId } : {}),
        text: `Implement this Kanban ticket in the project.\n\n# ${card.title}\n\n${card.description?.trim() || "No description provided."}${card.images?.length ? "\n\nThe kanban-image references in the description correspond to the attached images, in the same order." : ""}\n\n## Coordination context\n\nTicket ID: ${card.id}\nCoordinator thread ID: ${scope.thread?.threadId ?? "external client"}\nBase branch: ${baseBranch}${agentInstructions ? `\n\n## Agent instructions\n\n${agentInstructions}` : ""}`,
        attachments: (card.images ?? []).map((image) => image.attachment),
      },
      createdBy: "agent",
      creationSource: "mcp",
    });
    return threadId;
  },
  Effect.mapError((cause) =>
    isKanbanTicketMoveError(cause)
      ? cause
      : new KanbanTicketMoveError({ detail: cause.message, cause }),
  ),
);

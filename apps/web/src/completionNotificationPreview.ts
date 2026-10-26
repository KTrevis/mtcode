import type { MessageId, OrchestrationV2ConversationMessage, RunId } from "@t3tools/contracts";
import { formatAgentCompletionPreview } from "@t3tools/shared/agentAwareness";

export function completionNotificationPreview(input: {
  readonly messages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly assistantMessageId: MessageId | null;
  readonly runId: RunId | null;
}): string | null {
  const finalAssistantMessage =
    input.assistantMessageId === null
      ? null
      : (input.messages.find(
          (message) =>
            message.id === input.assistantMessageId &&
            message.role === "assistant" &&
            !message.streaming,
        ) ?? null);
  const latestTurnAssistantMessage =
    finalAssistantMessage ??
    (input.runId === null
      ? null
      : (input.messages.findLast(
          (message) =>
            message.runId === input.runId && message.role === "assistant" && !message.streaming,
        ) ?? null));
  const latestAssistantMessage =
    latestTurnAssistantMessage ??
    (input.assistantMessageId === null && input.runId === null
      ? (input.messages.findLast((message) => message.role === "assistant" && !message.streaming) ??
        null)
      : null);

  return formatAgentCompletionPreview(latestAssistantMessage?.text ?? "");
}

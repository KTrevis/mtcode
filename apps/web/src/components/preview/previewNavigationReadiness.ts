import { type PreviewAutomationRequest, type ScopedThreadRef } from "@t3tools/contracts";

import { isCurrentPreviewRuntimeTab } from "~/browser/previewRuntimeTabId";
import { readThreadPreviewState } from "~/previewStateStore";

import { previewBridge } from "./previewBridge";
import { PreviewAutomationTargetUnavailableError } from "./previewAutomationErrors";

export function assertPreviewRuntimeCurrent(
  threadRef: ScopedThreadRef,
  tabId: string,
  runtimeTabId: string,
  request: Pick<PreviewAutomationRequest, "operation" | "requestId">,
) {
  const state = readThreadPreviewState(threadRef);
  if (
    state.sessions[tabId] &&
    isCurrentPreviewRuntimeTab(threadRef, state.serverEpoch, tabId, runtimeTabId)
  ) {
    return state;
  }
  throw new PreviewAutomationTargetUnavailableError({
    requestId: request.requestId,
    operation: request.operation,
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    tabId,
    bridgeAvailable: Boolean(previewBridge),
  });
}

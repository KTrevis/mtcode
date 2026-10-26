import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { AppStateStatus } from "react-native";

// Acknowledge only visible, loaded completions while their environment and the app are active.

export function shouldAcknowledgeThreadVisit(input: {
  readonly appState: AppStateStatus;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly supported: boolean;
  readonly detailLoaded: boolean;
  readonly completedAt: string | null | undefined;
  readonly lastVisitedAt: string | null | undefined;
}): boolean {
  if (input.appState !== "active" || input.connectionState !== "connected" || !input.supported) {
    return false;
  }
  if (!input.detailLoaded || !input.completedAt) return false;
  const completedAtMs = Date.parse(input.completedAt);
  if (!Number.isFinite(completedAtMs)) return false;
  const lastVisitedAtMs = input.lastVisitedAt ? Date.parse(input.lastVisitedAt) : NaN;
  return !Number.isFinite(lastVisitedAtMs) || lastVisitedAtMs < completedAtMs;
}

/**
 * The watermark a visit stamps: the shell's updatedAt so later activity still
 * compares as unseen, floored at the completion being acknowledged.
 */
export function resolveVisitWatermark(input: {
  readonly updatedAt: string | null | undefined;
  readonly completedAt: string;
}): string {
  const updatedAtMs = Date.parse(input.updatedAt ?? "");
  const completedAtMs = Date.parse(input.completedAt);
  return Number.isFinite(updatedAtMs) && updatedAtMs > completedAtMs && input.updatedAt
    ? input.updatedAt
    : input.completedAt;
}

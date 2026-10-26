// Session-scoped record of the threads the user opened, most recent first.
import { create } from "zustand";

export const MAX_RECENT_THREAD_KEYS = 50;

/**
 * Moves an opened thread key to the front. Returns the SAME array when
 * nothing changed so subscribers keyed on identity skip redundant updates.
 */
export function withRecentThreadKey(
  current: ReadonlyArray<string>,
  opened: string,
): ReadonlyArray<string> {
  if (current[0] === opened) return current;
  return [opened, ...current.filter((key) => key !== opened)].slice(0, MAX_RECENT_THREAD_KEYS);
}

// How many threads the activity fallback offers.
export const RECENT_THREADS_FALLBACK_LIMIT = 10;

export interface RecentThreadActivity {
  threadKey: string;
  /** ISO timestamp of the thread's latest activity, compared as a string. */
  activityAt: string;
}

// Thread keys the switcher offers when it opens.
export function resolveRecentThreadSwitcherKeys(input: {
  liveHistory: ReadonlyArray<string>;
  liveThreads: ReadonlyArray<RecentThreadActivity>;
}): string[] {
  const keys = [...input.liveHistory];
  if (keys.length >= 2) return keys;
  const taken = new Set(keys);
  const fallback = input.liveThreads
    .filter((thread) => !taken.has(thread.threadKey))
    .toSorted(
      (left, right) =>
        right.activityAt.localeCompare(left.activityAt) ||
        left.threadKey.localeCompare(right.threadKey),
    );
  for (const thread of fallback) {
    if (keys.length >= RECENT_THREADS_FALLBACK_LIMIT) break;
    if (taken.has(thread.threadKey)) continue;
    taken.add(thread.threadKey);
    keys.push(thread.threadKey);
  }
  return keys;
}

interface RecentThreadsStore {
  /** Scoped thread keys in visit order, newest first. */
  recentThreadKeys: ReadonlyArray<string>;
  recordThreadVisit: (threadKey: string) => void;
}

export const useRecentThreadsStore = create<RecentThreadsStore>((set) => ({
  recentThreadKeys: [],
  recordThreadVisit: (threadKey) => {
    set((state) => {
      const next = withRecentThreadKey(state.recentThreadKeys, threadKey);
      return next === state.recentThreadKeys ? state : { recentThreadKeys: next };
    });
  },
}));

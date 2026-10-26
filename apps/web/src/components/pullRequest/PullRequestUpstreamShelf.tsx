import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { createModelSelection } from "@t3tools/shared/model";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { PullRequestListInput, PullRequestRanking } from "@t3tools/contracts";
import { resolvePullRequestRankingModelSelection } from "@t3tools/shared/serverSettings";
import { useState } from "react";
import { Atom } from "effect/reactivity";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance, resolveAppModelSelectionState } from "~/modelSelection";
import { primaryServerProvidersAtom } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import {
  pullRequestEnvironment,
  usePullRequestList,
  type EnvironmentQueryTarget,
} from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { PullRequestUpstreamCard } from "./PullRequestUpstreamCard";
import { PullRequestUpstreamReleaseBanner } from "./PullRequestUpstreamReleaseBanner";
import {
  buildImplementFeatureFromPullRequestHandoff,
  buildCherryPickPullRequestHandoff,
  buildMergeUpstreamReleaseHandoff,
  readableFailure,
} from "./pullRequestDetail.logic";
import {
  pullRequestEntryKey,
  sortPullRequestEntries,
  matchesPullRequestQuery,
  type EnvironmentPullRequestEntry,
} from "./pullRequestList.logic";

export function PullRequestUpstreamShelf(props: {
  readonly targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>;
  readonly query: string;
  readonly selected: {
    readonly environmentId: string | undefined;
    readonly repository: string;
    readonly number: number;
  } | null;
  readonly onSelect: (entry: EnvironmentPullRequestEntry) => void;
}) {
  const targets = props.targets.map((target) => ({
    ...target,
    input: { ...target.input, involvement: "all" as const, upstream: "only" as const, limit: 500 },
  }));
  const query = usePullRequestList(targets);
  const upstreamEntries = (query.data?.entries ?? []).filter((entry) =>
    matchesPullRequestQuery(entry, props.query),
  );
  const settings = usePrimarySettings();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const updateSettings = useUpdatePrimarySettings();
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings, null),
  );
  const rankingModel = resolvePullRequestRankingModelSelection(
    {
      ...settings,
      textGenerationModelSelection: resolveAppModelSelectionState(settings, providers),
    },
    providers,
  );
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    rankingModel.instanceId,
    rankingModel.model,
  );
  const canRank = useAtomValue(
    Atom.make((get) =>
      upstreamEntries.every((entry) =>
        get(pullRequestEnvironment.rank.permissionAtom(entry.environmentId)),
      ),
    ),
  );
  const rankCommand = useAtomCommand(pullRequestEnvironment.rank, { reportFailure: false });
  const [ranking, setRanking] = useState(false);
  const [rankings, setRankings] = useState<ReadonlyMap<string, PullRequestRanking>>(new Map());
  const rank = async () => {
    if (ranking) return;
    setRanking(true);
    try {
      const groups = new Map<string, EnvironmentPullRequestEntry[]>();
      for (const entry of upstreamEntries) {
        const key = `${entry.environmentId}:${entry.projectId}:${entry.repository}`;
        const rows = groups.get(key) ?? [];
        rows.push(entry);
        groups.set(key, rows);
      }
      const next = new Map<string, PullRequestRanking>();
      for (const entries of groups.values()) {
        const first = entries[0]!;
        for (let offset = 0; offset < entries.length; offset += 100) {
          const batch = entries.slice(offset, offset + 100);
          const result = await rankCommand({
            environmentId: first.environmentId,
            input: {
              projectId: first.projectId,
              repository: first.repository,
              modelSelection: rankingModel,
              candidates: batch.map((entry) => ({
                number: entry.number,
                title: entry.title,
                labels: entry.labels.map((label) => label.name),
              })),
            },
          });
          if (result._tag === "Failure") {
            toastManager.add({
              type: "error",
              title: "Could not rank upstream changes",
              description: readableFailure(
                squashAtomCommandFailure(result),
                "Try another ranking model in Settings.",
              ),
            });
            return;
          }
          for (const ranked of result.value.rankings) {
            const entry = batch.find((entry) => entry.number === ranked.number);
            if (entry) next.set(pullRequestEntryKey(entry), ranked);
          }
        }
      }
      setRankings(next);
    } finally {
      setRanking(false);
    }
  };
  const newThread = useNewThreadHandler();
  const [implementingKey, setImplementingKey] = useState<string | null>(null);
  const implementUpstream = async (entry: EnvironmentPullRequestEntry) => {
    if (implementingKey !== null) return;
    const key = pullRequestEntryKey(entry);
    setImplementingKey(key);
    try {
      const task = buildImplementFeatureFromPullRequestHandoff({
        number: entry.number,
        title: entry.title,
        url: entry.url,
        headBranch: entry.headBranch,
        baseBranch: entry.baseBranch,
        state: entry.state,
        isDraft: entry.isDraft,
      });
      const session = await newThread(scopeProjectRef(entry.environmentId, entry.projectId)).then(
        (result) => result,
        () => null,
      );
      if (session === null) {
        toastManager.add({
          type: "error",
          title: "Could not open a thread",
          description: "Try again from the project, or open a thread first.",
        });
        return;
      }
      const store = useComposerDraftStore.getState();
      store.setPrompt(session.draftId, task.prompt);
      store.setReviewComments(session.draftId, task.reviewComments);
      toastManager.add({
        type: "success",
        title: "Ready to implement",
        description: "The task is in the composer. read it over, then send.",
      });
    } finally {
      setImplementingKey(null);
    }
  };

  const cherryPickCommand = useAtomCommand(pullRequestEnvironment.cherryPick, {
    reportFailure: false,
  });
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const cherryPickUpstream = async (entry: EnvironmentPullRequestEntry) => {
    if (pickingKey !== null) return;
    const key = pullRequestEntryKey(entry);
    setPickingKey(key);
    const projectRef = scopeProjectRef(entry.environmentId, entry.projectId);

    const toastId = toastManager.add({
      type: "loading",
      title: `Cherry-picking #${entry.number}...`,
    });
    try {
      const opened = await newThread(projectRef).then(
        (result) => result,
        () => null,
      );
      if (opened === null) {
        toastManager.update(toastId, {
          type: "error",
          title: "Could not open a thread for the pick",
          description: "Try again from the project, or open a thread first.",
        });
        return;
      }
      const picked = await cherryPickCommand({
        environmentId: entry.environmentId,
        input: {
          projectId: entry.projectId,
          repository: entry.repository,
          number: entry.number,
          threadId: opened.threadId,
        },
      });
      if (picked._tag === "Failure") {
        toastManager.update(toastId, {
          type: "error",
          title: `Could not cherry-pick #${entry.number}`,

          description: readableFailure(
            squashAtomCommandFailure(picked),
            "The commits could not be fetched or applied. Open the pull request to see what it touches.",
          ),
        });
        return;
      }
      const result = picked.value;

      if (result.status === "empty" || result.branch === null || result.worktreePath === null) {
        toastManager.update(toastId, {
          type: "success",
          title: `Nothing to pick from #${entry.number}`,
          description: "Every commit on it is already in this project.",
        });
        return;
      }
      const task = buildCherryPickPullRequestHandoff({
        number: entry.number,
        title: entry.title,
        url: entry.url,
        headBranch: entry.headBranch,
        baseBranch: entry.baseBranch,
        state: entry.state,
        isDraft: entry.isDraft,
        status: result.status,
        branch: result.branch,
        commits: result.commits,
        conflictedPaths: result.conflictedPaths,
        conflictedPathCount: result.conflictedPathCount,
      });
      const pointed = await newThread(projectRef, {
        branch: result.branch,
        worktreePath: result.worktreePath,
        envMode: "worktree",
      }).then(
        (session) => session,
        () => null,
      );
      if (pointed === null) {
        toastManager.update(toastId, {
          type: "warning",
          title: "Picked, but the thread stayed where it was",
          description: `The commits are on \`${result.branch}\`. Point a thread at it from the branch picker.`,
        });
        return;
      }
      const store = useComposerDraftStore.getState();
      store.setPrompt(pointed.draftId, task.prompt);
      store.setReviewComments(pointed.draftId, task.reviewComments);
      toastManager.update(
        toastId,
        result.status === "applied"
          ? {
              type: "success",
              title: `Picked onto ${result.branch}`,
              description:
                "It applied cleanly. The task is in the composer. read it over, then send.",
            }
          : {
              type: "warning",
              title: `Picked onto ${result.branch}, with conflicts`,
              description: `${result.conflictedPathCount === 1 ? "1 file conflicts" : `${result.conflictedPathCount.toLocaleString()} files conflict`}. The task is in the composer. read it over, then send.`,
            },
      );
    } finally {
      setPickingKey(null);
    }
  };

  const releaseTarget = upstreamEntries[0] ?? null;
  const { data: upstreamReleaseData } = useEnvironmentQuery(
    releaseTarget === null
      ? null
      : pullRequestEnvironment.upstreamRelease({
          environmentId: releaseTarget.environmentId,
          input: { projectId: releaseTarget.projectId },
        }),
  );
  const upstreamRelease = upstreamReleaseData?.release ?? null;

  const mergeReleaseCommand = useAtomCommand(pullRequestEnvironment.mergeUpstreamRelease, {
    reportFailure: false,
  });
  const [takingRelease, setTakingRelease] = useState(false);
  const takeUpstreamRelease = async () => {
    if (takingRelease || releaseTarget === null || upstreamRelease === null) return;
    setTakingRelease(true);
    const projectRef = scopeProjectRef(releaseTarget.environmentId, releaseTarget.projectId);
    const toastId = toastManager.add({
      type: "loading",
      title: `Taking ${upstreamRelease.tagName}...`,
    });
    try {
      const opened = await newThread(projectRef).then(
        (result) => result,
        () => null,
      );
      if (opened === null) {
        toastManager.update(toastId, {
          type: "error",
          title: "Could not open a thread for the merge",
          description: "Try again from the project, or open a thread first.",
        });
        return;
      }
      const taken = await mergeReleaseCommand({
        environmentId: releaseTarget.environmentId,
        input: {
          projectId: releaseTarget.projectId,
          tagName: upstreamRelease.tagName,
          threadId: opened.threadId,
        },
      });
      if (taken._tag === "Failure") {
        toastManager.update(toastId, {
          type: "error",
          title: `Could not take ${upstreamRelease.tagName}`,
          description: readableFailure(
            squashAtomCommandFailure(taken),
            "The release could not be fetched or merged.",
          ),
        });
        return;
      }
      const result = taken.value;
      if (
        result.status === "up-to-date" ||
        result.branch === null ||
        result.worktreePath === null
      ) {
        toastManager.update(toastId, {
          type: "success",
          title: `Already on ${result.tagName}`,
          description: "This project's history already contains the release.",
        });
        return;
      }
      const task = buildMergeUpstreamReleaseHandoff({
        repository: upstreamRelease.repository,
        tagName: result.tagName,
        url: upstreamRelease.url,
        status: result.status,
        branch: result.branch,
        ...(result.behindBy === undefined ? {} : { behindBy: result.behindBy }),
        conflictedPaths: result.conflictedPaths,
        conflictedPathCount: result.conflictedPathCount,
      });
      const pointed = await newThread(projectRef, {
        branch: result.branch,
        worktreePath: result.worktreePath,
        envMode: "worktree",
      }).then(
        (session) => session,
        () => null,
      );
      if (pointed === null) {
        toastManager.update(toastId, {
          type: "warning",
          title: "Merged, but the thread stayed where it was",
          description: `The release is on \`${result.branch}\`. Point a thread at it from the branch picker.`,
        });
        return;
      }
      const store = useComposerDraftStore.getState();
      store.setPrompt(pointed.draftId, task.prompt);
      store.setReviewComments(pointed.draftId, task.reviewComments);
      toastManager.update(
        toastId,
        result.status === "merged"
          ? {
              type: "success",
              title: `Merged onto ${result.branch}`,
              description:
                "It merged cleanly. The task is in the composer. read it over, then send.",
            }
          : {
              type: "warning",
              title: `Merged onto ${result.branch}, with conflicts`,
              description: `${result.conflictedPathCount === 1 ? "1 file conflicts" : `${result.conflictedPathCount.toLocaleString()} files conflict`}. The task is in the composer. read it over, then send.`,
            },
      );
    } finally {
      setTakingRelease(false);
    }
  };

  if (upstreamEntries.length === 0 && upstreamRelease === null) return null;
  const scores = new Map([...rankings].map(([key, ranking]) => [key, ranking.score]));
  return (
    <section className="space-y-3 border-t border-border/60 pt-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Upstream</h2>
        <Button
          size="xs"
          variant="outline"
          disabled={!canRank || ranking || upstreamEntries.length === 0}
          onClick={() => void rank()}
        >
          {ranking ? "Ranking…" : "Rank usefulness"}
        </Button>
        <ProviderModelPicker
          environmentId={primaryEnvironmentId}
          activeInstanceId={rankingModel.instanceId}
          model={rankingModel.model}
          lockedProvider={null}
          instanceEntries={instanceEntries}
          modelOptionsByInstance={modelOptions}
          size="xs"
          triggerAriaLabel="Model that ranks upstream pull requests"
          onInstanceModelChange={(instanceId, model) =>
            updateSettings({
              pullRequestRankingModelSelection: createModelSelection(instanceId, model),
            })
          }
        />
      </div>
      {upstreamRelease ? (
        <PullRequestUpstreamReleaseBanner
          environmentId={releaseTarget!.environmentId}
          repository={upstreamRelease.repository}
          tagName={upstreamRelease.tagName}
          name={upstreamRelease.name}
          url={upstreamRelease.url}
          publishedAt={upstreamRelease.publishedAt}
          isPrerelease={upstreamRelease.isPrerelease}
          onTake={() => void takeUpstreamRelease()}
          taking={takingRelease}
        />
      ) : null}
      {query.error ? <p className="text-xs text-destructive">{query.error}</p> : null}
      <div className="grid grid-cols-1 gap-2 @xl:grid-cols-2 @3xl:grid-cols-3">
        {sortPullRequestEntries(upstreamEntries, scores.size ? "useful" : "updated", scores).map(
          (entry) => (
            <PullRequestUpstreamCard
              key={pullRequestEntryKey(entry)}
              entry={entry}
              reason={rankings.get(pullRequestEntryKey(entry))?.reason}
              onImplement={(row) => void implementUpstream(row)}
              onCherryPick={(row) => void cherryPickUpstream(row)}
              implementing={implementingKey === pullRequestEntryKey(entry)}
              picking={pickingKey === pullRequestEntryKey(entry)}
              selected={
                props.selected?.environmentId === entry.environmentId &&
                props.selected.repository === entry.repository &&
                props.selected.number === entry.number
              }
              onSelect={props.onSelect}
            />
          ),
        )}
      </div>
    </section>
  );
}

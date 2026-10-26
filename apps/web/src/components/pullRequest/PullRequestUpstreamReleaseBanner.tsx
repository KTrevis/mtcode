import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { PullRequestGlyph } from "./pullRequestIcons";
import { LoaderIcon } from "lucide-react";
import { memo } from "react";

import { formatRelativeTimeLabel } from "~/timestampFormat";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface PullRequestUpstreamReleaseBannerProps {
  readonly environmentId: EnvironmentId;
  readonly repository: string;
  readonly tagName: string;
  readonly name: string | undefined;
  readonly url: string;
  readonly publishedAt: string;
  readonly isPrerelease: boolean;
  readonly onTake: () => void;
  readonly taking: boolean;
}

function PullRequestUpstreamReleaseBannerImpl({
  environmentId,
  repository,
  tagName,
  name,
  url,
  publishedAt,
  isPrerelease,
  onTake,
  taking,
}: PullRequestUpstreamReleaseBannerProps) {
  const canTake = useAtomValue(
    pullRequestEnvironment.mergeUpstreamRelease.permissionAtom(environmentId),
  );
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2">
      <PullRequestGlyph.merged aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <Tooltip>
        <TooltipTrigger
          render={
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 shrink truncate text-sm font-medium hover:underline"
            >
              {tagName}
            </a>
          }
        />
        {/* The release's own title, which a tag name rarely repeats. */}
        <TooltipPopup>{name ?? tagName}</TooltipPopup>
      </Tooltip>
      {isPrerelease ? (
        <span className="shrink-0 rounded border border-border/60 px-1 text-3xs text-muted-foreground">
          nightly
        </span>
      ) : null}
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        {repository} · {formatRelativeTimeLabel(publishedAt)}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="xs"
              variant="outline"
              className="ml-auto shrink-0"
              disabled={taking || !canTake}
              onClick={onTake}
            >
              {taking ? (
                <>
                  <LoaderIcon aria-hidden className="size-3 animate-spin" />
                  Taking...
                </>
              ) : (
                "Take release"
              )}
            </Button>
          }
        />
        <TooltipPopup>
          Merges this release onto a branch of its own, in a worktree, with a thread standing in it.
          Nothing you are working in moves.
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

export const PullRequestUpstreamReleaseBanner = memo(PullRequestUpstreamReleaseBannerImpl);

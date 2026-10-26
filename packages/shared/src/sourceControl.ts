import type { SourceControlProviderInfo, SourceControlProviderKind } from "@t3tools/contracts";

export interface ChangeRequestPresentation {
  readonly icon: "github" | "gitlab" | "forgejo" | "azure-devops" | "bitbucket" | "change-request";
  readonly providerName: string;
  readonly shortName: string;
  readonly longName: string;
  readonly pluralLongName: string;
  readonly providerLongName: string;
  readonly checkoutCommandExample?: string;
  readonly urlExample: string;
}

export interface ChangeRequestTerminology {
  readonly shortLabel: string;
  readonly singular: string;
}

const CHANGE_REQUEST_URL_PATTERNS = [
  /https:\/\/[^\s<>()]+\/[^/\s<>()]+\/[^/\s<>()]+\/pull\/\d+(?:[/?#][^\s<>()]*)?/i,
  /https:\/\/[^\s<>()]+\/[^\s<>()]+\/-\/merge_requests\/\d+(?:[/?#][^\s<>()]*)?/i,
  /https:\/\/[^\s<>()]+\/[^\s<>()]+\/_git\/[^/\s<>()]+\/pullrequest\/\d+(?:[/?#][^\s<>()]*)?/i,
  /https:\/\/[^\s<>()]+\/[^/\s<>()]+\/[^/\s<>()]+\/pull-requests\/\d+(?:[/?#][^\s<>()]*)?/i,
] as const;

/** Detects a source-control change request URL embedded in agent-authored text. */
export function containsChangeRequestUrl(text: string): boolean {
  return CHANGE_REQUEST_URL_PATTERNS.some((pattern) => pattern.test(text));
}

const GITHUB_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "github",
  providerName: "GitHub",
  shortName: "PR",
  longName: "pull request",
  pluralLongName: "pull requests",
  providerLongName: "GitHub pull request",
  checkoutCommandExample: "gh pr checkout 123",
  urlExample: "https://github.com/owner/repo/pull/42",
};

const GITLAB_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "gitlab",
  providerName: "GitLab",
  shortName: "MR",
  longName: "merge request",
  pluralLongName: "merge requests",
  providerLongName: "GitLab merge request",
  checkoutCommandExample: "glab mr checkout 123",
  urlExample: "https://gitlab.com/group/project/-/merge_requests/42",
};

const FORGEJO_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "forgejo",
  providerName: "Forgejo",
  shortName: "PR",
  longName: "pull request",
  pluralLongName: "pull requests",
  providerLongName: "Forgejo pull request",
  checkoutCommandExample: "tea pr checkout 123",
  urlExample: "https://codeberg.org/owner/repo/pulls/42",
};

const AZURE_DEVOPS_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "azure-devops",
  providerName: "Azure DevOps",
  shortName: "PR",
  longName: "pull request",
  pluralLongName: "pull requests",
  providerLongName: "Azure DevOps pull request",
  checkoutCommandExample: "az repos pr checkout --id 123",
  urlExample: "https://dev.azure.com/org/project/_git/repo/pullrequest/42",
};

const BITBUCKET_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "bitbucket",
  providerName: "Bitbucket",
  shortName: "PR",
  longName: "pull request",
  pluralLongName: "pull requests",
  providerLongName: "Bitbucket pull request",
  urlExample: "https://bitbucket.org/workspace/repo/pull-requests/42",
};

const GENERIC_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "change-request",
  providerName: "source control",
  shortName: "change request",
  longName: "change request",
  pluralLongName: "change requests",
  providerLongName: "change request",
  urlExample: "#42",
};

export function resolveChangeRequestPresentation(
  provider: SourceControlProviderInfo | null | undefined,
): ChangeRequestPresentation {
  switch (provider?.kind) {
    case "github":
    case undefined:
      return GITHUB_CHANGE_REQUEST_PRESENTATION;
    case "gitlab":
      return GITLAB_CHANGE_REQUEST_PRESENTATION;
    case "forgejo":
      return FORGEJO_CHANGE_REQUEST_PRESENTATION;
    case "azure-devops":
      return AZURE_DEVOPS_CHANGE_REQUEST_PRESENTATION;
    case "bitbucket":
      return BITBUCKET_CHANGE_REQUEST_PRESENTATION;
    case "gitcafe":
      return {
        ...GITHUB_CHANGE_REQUEST_PRESENTATION,
        providerName: "GitCafe",
        providerLongName: "GitCafe pull request",
        checkoutCommandExample: "cafe pr checkout 123",
        urlExample: "https://git.cafe/owner/repo/pull/42",
      };
    default:
      return GENERIC_CHANGE_REQUEST_PRESENTATION;
  }
}

function resolveChangeRequestPresentationForKind(
  kind: SourceControlProviderKind,
): ChangeRequestPresentation {
  return resolveChangeRequestPresentation({ kind, name: "", baseUrl: "" });
}

export function getChangeRequestTerminologyForKind(
  kind: SourceControlProviderKind,
): ChangeRequestTerminology {
  const presentation = resolveChangeRequestPresentationForKind(kind);
  return {
    shortLabel: presentation.shortName,
    singular: presentation.longName,
  };
}

const SCP_SSH_REMOTE_PATTERN = /^[a-zA-Z0-9._-]+@([^:/]+):/;

export function isSshRemoteUrl(remoteUrl: string): boolean {
  const trimmed = remoteUrl.trim();
  return SCP_SSH_REMOTE_PATTERN.test(trimmed) || trimmed.toLowerCase().startsWith("ssh://");
}

import { SourceControlProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  containsChangeRequestUrl,
  getChangeRequestTerminologyForKind,
  isSshRemoteUrl,
  resolveChangeRequestPresentation,
} from "./sourceControl.ts";

describe("containsChangeRequestUrl", () => {
  it.each([
    "Opened https://github.com/pingdotgg/t3code/pull/42",
    "Opened https://gitlab.example.com/group/project/-/merge_requests/42.",
    "Opened https://dev.azure.com/acme/project/_git/t3code/pullrequest/42",
    "Opened https://bitbucket.org/pingdotgg/t3code/pull-requests/42",
  ])("accepts supported change request URLs in agent text", (text) => {
    expect(containsChangeRequestUrl(text)).toBe(true);
  });

  it.each([
    "I will open a pull request next.",
    "https://github.com/pingdotgg/t3code/issues/42",
    "https://example.com/pull/not-a-number",
  ])("rejects text without a supported change request URL", (text) => {
    expect(containsChangeRequestUrl(text)).toBe(false);
  });
});

describe("source control presentation", () => {
  it("uses merge request terminology for GitLab", () => {
    expect(getChangeRequestTerminologyForKind(SourceControlProviderKind.make("gitlab"))).toEqual({
      shortLabel: "MR",
      singular: "merge request",
    });
  });

  it("uses pull request terminology for GitHub-compatible providers", () => {
    expect(getChangeRequestTerminologyForKind(SourceControlProviderKind.make("github"))).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
    expect(
      getChangeRequestTerminologyForKind(SourceControlProviderKind.make("azure-devops")),
    ).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
    expect(getChangeRequestTerminologyForKind(SourceControlProviderKind.make("bitbucket"))).toEqual(
      {
        shortLabel: "PR",
        singular: "pull request",
      },
    );
    expect(getChangeRequestTerminologyForKind(SourceControlProviderKind.make("forgejo"))).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
  });

  it("falls back to generic change request copy for unknown providers", () => {
    expect(
      resolveChangeRequestPresentation({
        kind: SourceControlProviderKind.make("new-forge"),
        name: "forge",
        baseUrl: "",
      }),
    ).toEqual(
      expect.objectContaining({
        shortName: "change request",
        longName: "change request",
      }),
    );
  });
});

describe("isSshRemoteUrl", () => {
  it("recognises SCP-like SSH URLs with any SSH user prefix", () => {
    expect(isSshRemoteUrl("git@github.com:owner/repo.git")).toBe(true);
    expect(isSshRemoteUrl("gitlab@gitlab.example.com:group/project.git")).toBe(true);
    expect(isSshRemoteUrl("deploy@bitbucket.org:workspace/repo.git")).toBe(true);
  });

  it("recognises ssh:// URLs with any case", () => {
    expect(isSshRemoteUrl("ssh://git@gitlab.example.com/group/project.git")).toBe(true);
    expect(isSshRemoteUrl("ssh://git@gitlab.example.com:22/group/project.git")).toBe(true);
    expect(isSshRemoteUrl("SSH://git@gitlab.example.com/group/project.git")).toBe(true);
    expect(isSshRemoteUrl("SsH://git@gitlab.example.com/group/project.git")).toBe(true);
  });

  it("returns false for HTTPS, local paths, and SCP-like paths without a colon", () => {
    expect(isSshRemoteUrl("https://gitlab.example.com/group/project.git")).toBe(false);
    expect(isSshRemoteUrl("/home/user/repos/project")).toBe(false);
    expect(isSshRemoteUrl("")).toBe(false);
    expect(isSshRemoteUrl("deploy@github.com/project/repo")).toBe(false);
  });
});

it("uses GitCafe's own name and checkout command", () => {
  expect(
    resolveChangeRequestPresentation({
      kind: SourceControlProviderKind.make("gitcafe"),
      name: "GitCafe",
      baseUrl: "https://git.cafe",
    }),
  ).toMatchObject({ providerName: "GitCafe", checkoutCommandExample: "cafe pr checkout 123" });
});

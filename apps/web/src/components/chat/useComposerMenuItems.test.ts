import { EnvironmentId, ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react", () => ({ useState: (initialize: () => unknown) => [initialize()] }));
vi.mock("~/state/entities", () => ({ useThreadShells: () => [] }));
vi.mock("~/state/queries", () => ({
  useComposerPathSearch: () => ({ entries: [], isPending: false }),
  useDebouncedValue: (value: unknown) => value,
  useThreadSearch: () => {},
}));
vi.mock("~/state/pullRequests", () => ({
  pullRequestEnvironment: {},
  usePullRequestList: () => ({ data: null, error: null, isPending: false }),
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: false }),
}));

import { useComposerMenuItems } from "./useComposerMenuItems";

describe("composer command search", () => {
  it("finds Objective controls with plan mode disabled and no provider commands", () => {
    const { items } = useComposerMenuItems({
      composerTrigger: { kind: "slash-command", query: "goal", rangeStart: 0, rangeEnd: 5 },
      environmentId: EnvironmentId.make("environment"),
      gitCwd: null,
      activeThreadId: null,
      pullRequestProjectId: null,
      pullRequestRepository: null,
      threadPullRequests: [],
      planModeUiEnabled: false,
      compactSlashCommandAvailable: false,
      selectedProvider: ProviderDriverKind.make("codex"),
      selectedProviderSkills: [],
      selectedProviderSlashCommands: [],
      showSkillsInSlashMenu: true,
    });
    expect(items.map((item) => item.label)).toEqual([
      "/goal",
      "/goal clear",
      "/goal pause",
      "/goal resume",
    ]);
  });
});

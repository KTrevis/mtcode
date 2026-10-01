import { describe, expect, it, vi } from "vite-plus/test";
import type { RuntimeMode } from "@t3tools/contracts";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let targetSettings = {
    defaultThreadEnvMode: "local" as "local" | "worktree",
    newWorktreesStartFromOrigin: false,
    defaultModelSelection: null,
    defaultRuntimeMode: "full-access" as RuntimeMode,
  };
  let storedDraft: {
    readonly draftId: string;
    readonly environmentId: string;
    readonly promotedTo: null;
    readonly threadId: string;
  } | null = null;
  const context = {
    params: {} as Record<string, string>,
    activeThread: null as { environmentId: string; projectId: string } | null,
    draft: null as { environmentId: string; projectId: string } | null,
    projects: [{ environmentId: "environment-ssh", id: "project-remote" }],
  };
  const router = {
    state: {
      location: { href: "/" },
      matches: [{ params: {} }],
    },
    navigate: vi.fn(async (request: { readonly params: { readonly draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
    }),
  };
  const draftStore = {
    getComposerDraft: vi.fn(() => ({})),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn(() => context.draft),
    getDraftThread: vi.fn(() => context.draft),
    applyStickyState: vi.fn(),
    setDraftThreadContext: vi.fn(),
    setLogicalProjectDraftThreadId: vi.fn(),
    setModelSelection: vi.fn(),
  };

  return {
    context,
    completeProjectFileRead: (value: null) => completeProjectFileRead(value),
    draftStore,
    get projectFileRead() {
      return projectFileRead;
    },
    get targetSettings() {
      return targetSettings;
    },
    reset(
      nextStoredDraft: typeof storedDraft,
      workspaceDefaults = {
        envMode: "local" as "local" | "worktree",
        startFromOrigin: false,
      },
    ) {
      storedDraft = nextStoredDraft;
      targetSettings = {
        defaultThreadEnvMode: workspaceDefaults.envMode,
        newWorktreesStartFromOrigin: workspaceDefaults.startFromOrigin,
        defaultModelSelection: null,
        defaultRuntimeMode: "full-access",
      };
      router.state.location.href = "/";
      router.navigate.mockClear();
      draftStore.setDraftThreadContext.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    router,
  };
});

vi.mock("@effect/atom-react", () => ({
  // The hook reads three kinds of atoms: the primary settings it asserts on,
  // the per-environment server configs, and the environment catalog /
  // presentation map that `useEnvironments` walks (stubbed empty).
  useAtomValue: (atom: unknown) =>
    atom === "primary-settings"
      ? { newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin }
      : atom === "environment-configs"
        ? new Map([
            [
              "environment-primary",
              {
                settings: {
                  ...testState.targetSettings,
                  newWorktreesStartFromOrigin:
                    !testState.targetSettings.newWorktreesStartFromOrigin,
                },
              },
            ],
            ["environment-ssh", { settings: testState.targetSettings }],
          ])
        : { isReady: false, entries: () => [] },
}));
vi.mock("@t3tools/client-runtime/environment", () => ({
  scopedProjectKey: () => "remote-project",
  scopeProjectRef: (environmentId: string, projectId: string) => ({ environmentId, projectId }),
  scopeThreadRef: (environmentId: string, threadId: string) => ({ environmentId, threadId }),
}));
// client-runtime builds schemas out of contracts at import time, so the mock
// keeps the real module and overrides only the constant this test pins.
vi.mock("@t3tools/contracts", async (importActual) => ({
  ...(await importActual<typeof import("@t3tools/contracts")>()),
  DEFAULT_RUNTIME_MODE: "default",
}));
vi.mock("@t3tools/shared/projectSettings", () => ({
  // Environment settings pass through; the tests set project fields on the
  // project record, which the hook still honors until the server folds them.
  // With a file argument the env mode resolves like the real chain.
  resolveProjectSettings: (
    settings: Record<string, unknown>,
    _projectId: unknown,
    _project: unknown,
    projectFile?: { defaultThreadEnvMode?: "local" | "worktree" } | null,
  ) => ({
    settings:
      projectFile === undefined
        ? settings
        : {
            ...settings,
            defaultThreadEnvMode:
              settings.defaultThreadEnvMode ?? projectFile?.defaultThreadEnvMode ?? "local",
          },
    sources: { defaultModelSelection: "environment", defaultThreadEnvMode: "environment" },
    overrides: {},
  }),
}));
vi.mock("@t3tools/shared/serverSettings", () => ({
  resolveNewThreadRuntimeMode: (settings: { defaultRuntimeMode?: string }) =>
    settings.defaultRuntimeMode ?? "full-access",
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => testState.context.params,
  useRouter: () => testState.router,
}));
vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
}));
vi.mock("../components/Sidebar.logic", () => ({
  orderItemsByPreferredIds: (input: { items: unknown[] }) => input.items,
}));
vi.mock("../composerDraftStore", () => {
  const useComposerDraftStore = Object.assign(
    (select: (store: typeof testState.draftStore) => unknown) => select(testState.draftStore),
    {
      getState: () => testState.draftStore,
    },
  );
  return {
    composerDraftHasUserContent: () => false,
    markPromotedDraftThreadByRef: vi.fn(),
    useComposerDraftStore,
  };
});
// Keep the real module (the hook reaches for more of it over time) and pin only
// the answers these cases depend on.
vi.mock("../lib/chatThreadActions", async (importActual) => ({
  ...(await importActual<typeof import("../lib/chatThreadActions")>()),
  hasExplicitComposerModelSelection: () => false,
  resolveNewThreadModelSelectionOverride: () => null,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: () => testState.projectFileRead,
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => "draft-delayed",
  newThreadId: () => "thread-delayed",
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "remote-project",
  getProjectOrderKey: () => "remote-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => ({
  readProjects: () => [
    {
      id: "project-remote",
      environmentId: "environment-ssh",
      workspaceRoot: "/remote/project",
      defaultThreadEnvMode: null,
      defaultModelSelection: null,
    },
  ],
  readThreadShell: () => null,
  useProjects: () => testState.context.projects,
  useServerConfigs: () => new Map(),
  useThread: () => testState.context.activeThread,
}));
vi.mock("../providerInstances", () => ({ resolveDefaultProviderModelSelection: () => null }));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: "environment-configs",
  primaryServerSettingsAtom: "primary-settings",
  // `state/presentation` builds its atoms from this at import time.
  serverEnvironment: { configValueAtom: {} },
}));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

import { useHandleNewThread, useNewThreadHandler } from "./useHandleNewThread";

describe.each([
  ["new", null],
  [
    "reusable",
    {
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    },
  ],
])("useNewThreadHandler with a %s draft", (_, draft) => {
  it.each(["approval-required", "auto-accept-edits", "auto", "full-access"] as const)(
    "uses the target environment's %s permissions for new threads",
    async (runtimeMode) => {
      testState.reset(draft);
      testState.targetSettings.defaultRuntimeMode = runtimeMode;
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = useNewThreadHandler()(projectRef);
      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ runtimeMode }),
      );
    },
  );

  it("abandons a delayed draft open when the user navigates elsewhere", async () => {
    testState.reset(draft);
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.router.state.location.href = "/usage";
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it("re-resolves an implicit reusable draft's runtime mode", async () => {
    testState.reset({
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    });
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);

    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      { environmentId: "environment-ssh", projectId: "project-remote" },
      "draft-existing",
      expect.objectContaining({ runtimeMode: "full-access" }),
    );
  });
  it.each([true, false])(
    "uses the target environment's start-from-origin default of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = openThread(projectRef);

      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(opened).toEqual({
        draftId: draft?.draftId ?? "draft-delayed",
        threadId: draft?.threadId ?? "thread-delayed",
      });
      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
      if (draft) {
        expect(testState.draftStore.setDraftThreadContext).toHaveBeenCalledWith(
          draft.draftId,
          expect.objectContaining({ envMode: "worktree", startFromOrigin }),
        );
      }
    },
  );

  it.each([true, false])(
    "preserves an explicit start-from-origin choice of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin: !startFromOrigin });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;

      const opened = await openThread(projectRef, { envMode: "worktree", startFromOrigin });

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
    },
  );
});

describe("current project context", () => {
  it.each([
    {
      params: {},
      thread: { environmentId: "chat-host", projectId: "chat-project" },
      draft: null,
      expected: { environmentId: "chat-host", projectId: "chat-project" },
    },
    {
      params: { draftId: "draft" },
      thread: null,
      draft: { environmentId: "draft-host", projectId: "draft-project" },
      expected: { environmentId: "draft-host", projectId: "draft-project" },
    },
    {
      params: { environmentId: "environment-ssh", projectId: "project-remote" },
      thread: null,
      draft: null,
      expected: { environmentId: "environment-ssh", projectId: "project-remote" },
    },
    {
      params: { environmentId: "other-host", projectId: "project-remote" },
      thread: null,
      draft: null,
      expected: null,
    },
    { params: {}, thread: null, draft: null, expected: null },
  ])(
    "resolves the displayed project without falling back to another board: $params",
    ({ params, thread, draft, expected }) => {
      testState.context.params = params;
      testState.context.activeThread = thread;
      testState.context.draft = draft;
      try {
        const result = useHandleNewThread();
        expect(result.defaultProjectRef).toEqual({
          environmentId: "environment-ssh",
          projectId: "project-remote",
        });
        expect(result.currentProjectRef).toEqual(expected);
      } finally {
        testState.context.params = {};
        testState.context.activeThread = null;
        testState.context.draft = null;
      }
    },
  );
});

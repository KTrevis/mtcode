import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type ClientSettings,
  type PreviewAutomationResponse,
  type PreviewAutomationStreamEvent,
  type PreviewOpenInput,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { act, fakeTimers, render } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { __resetClientSettingsPersistenceForTests } from "~/hooks/useSettings";
import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  resetPreviewStateForTests,
  applyPreviewDesktopState,
} from "~/previewStateStore";
import { appAtomRegistry, AppAtomRegistryProvider } from "~/rpc/atomRegistry";

import { PreviewAutomationHosts } from "./PreviewAutomationHosts";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async (_tabId: string, _url: string, _options: unknown) => {}),
  status: vi.fn(async () => ({
    available: true,
    loading: false,
    visible: false,
    tabId: "runtime",
    url: "about:blank",
    title: "",
  })),
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn(),
  open: vi.fn(async (_target: { environmentId: EnvironmentId; input: PreviewOpenInput }) =>
    AsyncResult.success(snapshot),
  ),
  list: vi.fn(async () => AsyncResult.success(emptyList)),
  resize: vi.fn(),
  respond:
    vi.fn<
      (target: { environmentId: EnvironmentId; input: PreviewAutomationResponse }) => Promise<void>
    >(),
  focus: vi.fn<() => Promise<AtomCommandResult<void, Error>>>(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence: mocks }),
}));
vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/state/environments", () => ({
  usePrimaryEnvironment: () => ({ environmentId }),
  usePrimaryEnvironmentId: () => environmentId,
  useEnvironments: () => ({ environments: [{ environmentId }] }),
}));
vi.mock("~/state/preview", () => ({
  previewEnvironment: {
    automationRequests: () => requestsAtom,
    list: () => listAtom,
    open: mocks.open,
    resize: mocks.resize,
    respondToAutomation: mocks.respond,
    focusAutomationHost: mocks.focus,
  },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => command,
}));
vi.mock("~/state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => mocks.list,
}));
vi.mock("./previewBridge", () => ({
  previewBridge: { navigate: mocks.navigate, automation: { status: mocks.status } },
}));

const environmentId = EnvironmentId.make("automation-environment");
const threadId = ThreadId.make("automation-thread");
const threadRef = { environmentId, threadId };
const viewport = { _tag: "freeform", width: 1440, height: 900 } as const;
const savedSettings: ClientSettings = {
  ...DEFAULT_CLIENT_SETTINGS,
  browserDefaultViewport: viewport,
  browserDefaultProfileId: "work",
  browserProfiles: [{ id: "work", name: "Work", kind: "persistent" }],
};
const snapshot: PreviewSessionSnapshot = {
  threadId,
  tabId: "automation-tab",
  navStatus: { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  viewport,
  profileId: "work",
  updatedAt: "2026-09-05T00:00:00.000Z",
};
const emptyList = { sessions: [], serverEpoch: "test-server", revision: 0 };
const listAtom = Atom.make(AsyncResult.success(emptyList));
const requestsAtom = Atom.make<AsyncResult.AsyncResult<PreviewAutomationStreamEvent, Error>>(
  AsyncResult.initial(false),
);
const requestEvent: PreviewAutomationStreamEvent = {
  type: "request",
  connectionId: "automation-connection",
  request: {
    requestId: "open-request",
    threadId,
    operation: "open",
    input: { open: false, reuseExistingTab: false },
    timeoutMs: 15_000,
  },
};

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function setup() {
  await using stack = new AsyncDisposableStack();
  vi.clearAllMocks();
  mocks.getClientSettings.mockReset().mockResolvedValue(savedSettings);
  mocks.respond.mockReset();
  mocks.focus.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  __resetClientSettingsPersistenceForTests();
  resetPreviewStateForTests();
  useBrowserSurfaceStore.setState({ byTabId: {} });
  appAtomRegistry.set(requestsAtom, AsyncResult.initial(false));
  const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    writable: true,
    value: "visible",
  });
  stack.defer(() => {
    resetPreviewStateForTests();
    __resetClientSettingsPersistenceForTests();
    if (visibility) Object.defineProperty(document, "visibilityState", visibility);
    else Reflect.deleteProperty(document, "visibilityState");
  });
  stack.use(vi.spyOn(document, "hasFocus").mockReturnValue(false));
  stack.use(vi.spyOn(document, "querySelectorAll"));
  stack.use(
    await render(
      <AppAtomRegistryProvider>
        <PreviewAutomationHosts />
      </AppAtomRegistryProvider>,
    ),
  );
  return stack.move();
}

describe("PreviewAutomationHosts open", () => {
  it("waits for saved settings before opening a tab with the configured profile and viewport", async () => {
    await using _fixture = await setup();
    const readStarted = deferred<void>();
    const read = deferred<ClientSettings>();
    const response = deferred<PreviewAutomationResponse>();
    mocks.getClientSettings.mockImplementationOnce(() => {
      readStarted.resolve();
      return read.promise;
    });
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));

    await act(() => {
      appAtomRegistry.set(requestsAtom, AsyncResult.success(requestEvent));
    });
    await readStarted.promise;
    await vi.waitFor(() => {
      expect(mocks.open).not.toHaveBeenCalled();
    });

    await act(() => {
      read.resolve(savedSettings);
    });
    await response.promise;

    await vi.waitFor(() => {
      expect(mocks.open).toHaveBeenCalledExactlyOnceWith({
        environmentId,
        input: { threadId, viewport, profileId: "work" },
      });
    });
    await vi.waitFor(() => {
      expect(mocks.getClientSettings).toHaveBeenCalledOnce();
    });
    await expect(response.promise).resolves.toMatchObject({
      requestId: "open-request",
      ok: true,
      result: { available: false, tabId: snapshot.tabId },
    });
    await vi.waitFor(() => {
      expect(readThreadPreviewState(threadRef).snapshot).toEqual(snapshot);
    });
    await vi.waitFor(() => {
      expect(mocks.setClientSettings).not.toHaveBeenCalled();
    });
  });

  it("reports a settings read failure without opening a tab", async () => {
    await using _fixture = await setup();
    using _console = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getClientSettings.mockRejectedValueOnce(new Error("Settings read failed"));
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));

    await act(() => {
      appAtomRegistry.set(requestsAtom, AsyncResult.success(requestEvent));
    });
    await response.promise;

    await expect(response.promise).resolves.toMatchObject({
      requestId: "open-request",
      ok: false,
      error: { _tag: "PreviewAutomationExecutionError" },
    });
    await vi.waitFor(() => {
      expect(mocks.getClientSettings).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(mocks.open).not.toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(readThreadPreviewState(threadRef).snapshot).toBeNull();
    });
    await vi.waitFor(() => {
      expect(mocks.setClientSettings).not.toHaveBeenCalled();
    });
  });
});

describe("PreviewAutomationHosts ownership", () => {
  it("reports only local live tabs and removes ownership when their web contents close", async () => {
    await using _fixture = await setup();
    await act(() => {
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({ type: "connected", connectionId: "automation-connection" }),
      );
      applyPreviewServerSnapshot(threadRef, snapshot);
    });
    await vi.waitFor(() => {
      expect(mocks.focus).toHaveBeenLastCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ liveTabs: [] }) }),
      );
    });
    const overlay = {
      hasWebContents: true,
      canGoBack: false,
      canGoForward: false,
      loading: false,
      zoomFactor: 1,
      pictureInPicture: false,
      colorScheme: "system" as const,
      audioMuted: false,
      audible: false,
      controller: "none" as const,
      favicon: null,
    };
    await act(() => applyPreviewDesktopState(threadRef, snapshot.tabId, overlay));
    await vi.waitFor(() => {
      expect(mocks.focus).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            liveTabs: [{ threadId, tabId: snapshot.tabId, visible: false }],
          }),
        }),
      );
    });
    const reportCount = mocks.focus.mock.calls.length;
    await act(() =>
      applyPreviewDesktopState(threadRef, snapshot.tabId, { ...overlay, loading: true }),
    );
    await vi.waitFor(() => {
      expect(mocks.focus).toHaveBeenCalledTimes(reportCount);
    });
    const runtimeTabId = previewRuntimeTabId(threadRef, null, snapshot.tabId);
    const owner = Symbol();
    await act(() => {
      useBrowserSurfaceStore.getState().claim(runtimeTabId, owner, false);
      useBrowserSurfaceStore
        .getState()
        .present(runtimeTabId, owner, { x: 0, y: 0, width: 800, height: 600 }, true, 0, 1);
    });
    await vi.waitFor(() => {
      expect(mocks.focus).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            liveTabs: [{ threadId, tabId: snapshot.tabId, visible: true }],
          }),
        }),
      );
    });
    for (const visibilityState of ["hidden", "visible"]) {
      await act(() => {
        Object.assign(document, { visibilityState });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await vi.waitFor(() => {
        expect(mocks.focus).toHaveBeenLastCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({
              focused: false,
              liveTabs: [
                { threadId, tabId: snapshot.tabId, visible: visibilityState === "visible" },
              ],
            }),
          }),
        );
      });
    }
    await act(() => {
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({ type: "connected", connectionId: "reconnected" }),
      );
    });
    await vi.waitFor(() => {
      expect(mocks.focus).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            connectionId: "reconnected",
            liveTabs: [{ threadId, tabId: snapshot.tabId, visible: true }],
          }),
        }),
      );
    });
    await act(() =>
      applyPreviewDesktopState(threadRef, snapshot.tabId, { ...overlay, hasWebContents: false }),
    );
    await vi.waitFor(() => {
      expect(mocks.focus).toHaveBeenLastCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ liveTabs: [] }) }),
      );
    });
  });

  it.each([false, true])(
    "retries failed reports without clearing newer connection reports (reconnect: %s)",
    async (reconnect) => {
      await using _fixture = await setup();
      const report = deferred<Awaited<ReturnType<typeof mocks.focus>>>();
      mocks.focus.mockReturnValueOnce(report.promise);
      await act(() => {
        appAtomRegistry.set(
          requestsAtom,
          AsyncResult.success({ type: "connected", connectionId: "first" }),
        );
      });
      if (reconnect) {
        await act(() => {
          appAtomRegistry.set(
            requestsAtom,
            AsyncResult.success({ type: "connected", connectionId: "second" }),
          );
        });
      }
      await act(() => {
        report.resolve(AsyncResult.failure(Cause.fail(new Error("Focus report failed"))));
      });
      await report.promise;
      await vi.waitFor(() => {
        expect(mocks.focus).toHaveBeenCalledTimes(reconnect ? 2 : 1);
      });
      await act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await vi.waitFor(() => {
        expect(mocks.focus).toHaveBeenCalledTimes(2);
      });
      await vi.waitFor(() => {
        expect(mocks.focus).toHaveBeenLastCalledWith(
          expect.objectContaining({
            input: expect.objectContaining({ connectionId: reconnect ? "second" : "first" }),
          }),
        );
      });
    },
  );

  it("does not claim an available runtime from a server snapshot alone", async () => {
    await using _fixture = await setup();
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));
    await act(() => {
      applyPreviewServerSnapshot(threadRef, snapshot);
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({
          ...requestEvent,
          request: {
            ...requestEvent.request,
            operation: "status",
            tabId: snapshot.tabId,
            input: {},
          },
        }),
      );
    });
    await response.promise;
    await expect(response.promise).resolves.toMatchObject({
      ok: true,
      result: { available: false, tabId: snapshot.tabId },
    });
  });
});

describe("PreviewAutomationHosts deadlines", () => {
  it("responds before the broker timeout when settings stall and does not open later", async () => {
    await using _fixture = await setup();
    using _timers = fakeTimers();
    const read = deferred<ClientSettings>();
    mocks.getClientSettings.mockReturnValueOnce(read.promise);
    await act(() =>
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({
          ...requestEvent,
          request: { ...requestEvent.request, timeoutMs: 100 },
        }),
      ),
    );
    await act(() => vi.advanceTimersByTimeAsync(80));
    await vi.waitFor(() => {
      expect(mocks.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ok: false,
            error: expect.objectContaining({ _tag: "PreviewAutomationTimeoutError" }),
          }),
        }),
      );
    });
    await act(() => {
      read.resolve(savedSettings);
    });
    await read.promise;
    await vi.waitFor(() => {
      expect(mocks.open).not.toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(mocks.respond).toHaveBeenCalledOnce();
    });
  });

  it("returns a navigation timeout and handles status on the same host connection", async () => {
    await using _fixture = await setup();
    using _timers = fakeTimers();
    const runtimeTabId = previewRuntimeTabId(threadRef, null, snapshot.tabId);
    Object.assign(document, {
      querySelectorAll: () => [
        {
          getAttribute: () => runtimeTabId,
          closest: () => ({ getAttribute: () => "active" }),
          executeJavaScript: async () => ({ width: 1440, height: 900 }),
        },
      ],
    });
    mocks.navigate.mockImplementationOnce(() => new Promise<void>(() => {}));
    await act(() => {
      applyPreviewServerSnapshot(threadRef, snapshot);
      applyPreviewDesktopState(threadRef, snapshot.tabId, {
        hasWebContents: true,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        zoomFactor: 1,
        pictureInPicture: false,
        colorScheme: "system",
        audioMuted: false,
        audible: false,
        controller: "none",
        favicon: null,
      });
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({
          ...requestEvent,
          request: {
            ...requestEvent.request,
            requestId: "navigate-stalled",
            operation: "navigate",
            tabId: snapshot.tabId,
            timeoutMs: 100,
            input: { url: "https://example.com", readiness: "domContentLoaded" },
          },
        }),
      );
    });
    await act(() => vi.advanceTimersByTimeAsync(80));
    await vi.waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith(
        runtimeTabId,
        "https://example.com",
        expect.objectContaining({ readiness: "domContentLoaded" }),
      );
    });
    await vi.waitFor(() => {
      expect(mocks.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            connectionId: requestEvent.connectionId,
            requestId: "navigate-stalled",
            ok: false,
            error: expect.objectContaining({ _tag: "PreviewAutomationTimeoutError" }),
          }),
        }),
      );
    });
    await act(() =>
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({
          ...requestEvent,
          request: {
            ...requestEvent.request,
            requestId: "status-after-timeout",
            operation: "status",
            tabId: snapshot.tabId,
            input: {},
          },
        }),
      ),
    );
    await vi.waitFor(() => {
      expect(mocks.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            connectionId: requestEvent.connectionId,
            requestId: "status-after-timeout",
            ok: true,
            result: expect.objectContaining({ available: true }),
          }),
        }),
      );
    });
  });

  it("reports status without a viewport when guest JavaScript never settles", async () => {
    await using _fixture = await setup();
    using _timers = fakeTimers();
    const runtimeTabId = previewRuntimeTabId(threadRef, null, snapshot.tabId);
    const executeJavaScript = vi.fn(() => new Promise<unknown>(() => {}));
    const webview = {
      getAttribute: (name: string) => (name === "data-preview-tab" ? runtimeTabId : null),
      closest: () => ({ getAttribute: () => "active" }),
      executeJavaScript,
    };
    Object.assign(document, { querySelectorAll: () => [webview] });
    await act(() => {
      applyPreviewServerSnapshot(threadRef, snapshot);
      applyPreviewDesktopState(threadRef, snapshot.tabId, {
        hasWebContents: true,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        zoomFactor: 1,
        pictureInPicture: false,
        colorScheme: "system",
        audioMuted: false,
        audible: false,
        controller: "none",
        favicon: null,
      });
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({
          ...requestEvent,
          request: {
            ...requestEvent.request,
            operation: "status",
            tabId: snapshot.tabId,
            input: {},
          },
        }),
      );
    });
    await act(() => vi.advanceTimersByTimeAsync(250));
    await vi.waitFor(() => {
      expect(executeJavaScript).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(mocks.respond).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ok: true,
            result: expect.objectContaining({ available: true, tabId: snapshot.tabId }),
          }),
        }),
      );
    });
    await vi.waitFor(() => {
      expect(mocks.respond.mock.calls[0]?.[0].input.result).not.toHaveProperty("viewport");
    });
  });
});

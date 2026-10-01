// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";

const mocks = vi.hoisted(() => ({
  openCommandPalette: vi.fn(),
  startNewThreadFromContext: vi.fn(),
  undoLatestThreadAction: vi.fn(() => true),
  navigate: vi.fn(),
  currentProjectRef: { environmentId: "remote", projectId: "project" } as {
    environmentId: string;
    projectId: string;
  } | null,
  paletteOpen: false,
  terminalFocus: false,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => DEFAULT_RESOLVED_KEYBINDINGS }));
vi.mock("../state/server", () => ({ primaryServerKeybindingsAtom: {} }));
vi.mock("../commandPaletteBus", () => ({
  isCommandPaletteOpen: () => mocks.paletteOpen,
  openCommandPalette: mocks.openCommandPalette,
}));
vi.mock("../hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({
    currentProjectRef: mocks.currentProjectRef,
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: { environmentId: "remote", projectId: "project" },
    handleNewThread: vi.fn(),
    routeThreadRef: null,
  }),
}));
vi.mock("../lib/chatThreadActions", () => ({
  startNewThreadFromContext: mocks.startNewThreadFromContext,
}));
vi.mock("../hooks/showThreadUndoNotice", () => ({
  undoLatestThreadAction: mocks.undoLatestThreadAction,
}));
vi.mock("../lib/terminalFocus", () => ({ isTerminalFocused: () => mocks.terminalFocus }));
vi.mock("./ui/toast", () => ({ toastManager: {}, stackedThreadToast: vi.fn() }));

import { WorkspaceGlobalShortcuts } from "./WorkspaceGlobalShortcuts";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  mocks.currentProjectRef = { environmentId: "remote", projectId: "project" };
  mocks.paletteOpen = false;
  mocks.terminalFocus = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  // No chat view or thread route is mounted, as on Kanban and Settings.
  await act(async () =>
    root.render(
      <>
        <WorkspaceGlobalShortcuts />
        <input />
      </>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function press(key: string, options: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

it("opens new-thread selection without a chat, including from the Kanban search field", () => {
  const input = container.querySelector("input")!;
  input.focus();
  expect(press("n", {}, input).defaultPrevented).toBe(true);
  expect(mocks.openCommandPalette).toHaveBeenCalledWith({ open: "new-thread-in" });
  expect(press("O", { shiftKey: true }, input).defaultPrevented).toBe(true);
  expect(mocks.openCommandPalette).toHaveBeenCalledTimes(2);
  expect(press("N", { shiftKey: true }, input).defaultPrevented).toBe(true);
  expect(mocks.startNewThreadFromContext).toHaveBeenCalledWith(
    expect.objectContaining({
      defaultProjectRef: { environmentId: "remote", projectId: "project" },
    }),
  );
});

it("undoes thread actions outside chat while preserving text-field undo", () => {
  expect(press("z").defaultPrevented).toBe(true);
  expect(mocks.undoLatestThreadAction).toHaveBeenCalledTimes(1);
  const input = container.querySelector("input")!;
  input.focus();
  expect(press("z", {}, input).defaultPrevented).toBe(false);
  expect(mocks.undoLatestThreadAction).toHaveBeenCalledTimes(1);
});

it("leaves shortcuts to the palette, terminal, and keybinding recorder when they own input", () => {
  mocks.paletteOpen = true;
  expect(press("n").defaultPrevented).toBe(false);
  mocks.paletteOpen = false;
  mocks.terminalFocus = true;
  expect(press("n").defaultPrevented).toBe(false);
  mocks.terminalFocus = false;
  const input = container.querySelector("input")!;
  input.setAttribute("data-keybinding-capture", "");
  expect(press("n", {}, input).defaultPrevented).toBe(false);
  expect(mocks.openCommandPalette).not.toHaveBeenCalled();
});

it("opens the current remote project's Kanban without opening the palette", () => {
  expect(press("K", { shiftKey: true }).defaultPrevented).toBe(true);
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: "/kanban/$environmentId/$projectId",
    params: { environmentId: "remote", projectId: "project" },
  });
  expect(mocks.openCommandPalette).not.toHaveBeenCalled();
  press("K", { shiftKey: true, repeat: true });
  expect(mocks.navigate).toHaveBeenCalledTimes(1);
});

it("does not choose an unrelated project when no project is open", async () => {
  mocks.currentProjectRef = null;
  await act(async () => root.render(<WorkspaceGlobalShortcuts />));
  press("k", { shiftKey: true });
  expect(mocks.navigate).not.toHaveBeenCalled();
});

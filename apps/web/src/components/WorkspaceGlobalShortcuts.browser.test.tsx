import { act, render } from "../../test/render";
import { expect, it, vi } from "vite-plus/test";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";

const mocks = vi.hoisted(() => ({
  openCommandPalette: vi.fn(),
  startNewThreadFromContext: vi.fn(),
  undoLatestThreadAction: vi.fn(() => true),
  navigate: vi.fn(),
  startScratchThread: vi.fn(),
  scratchEnvironmentId: vi.fn((id: string) => id),
  currentProjectRef: { environmentId: "remote", projectId: "project" } as {
    environmentId: string;
    projectId: string;
  } | null,
  paletteOpen: false,
  terminalFocus: false,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => DEFAULT_RESOLVED_KEYBINDINGS,
}));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "primary" }));
vi.mock("../hooks/useScratchProject", () => ({
  useScratchProject: () => ({
    scratchEnvironmentId: mocks.scratchEnvironmentId,
    startScratchThread: mocks.startScratchThread,
  }),
}));
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
    defaultProjectRef: mocks.currentProjectRef,
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

vi.mock("../terminalUiStateStore", () => ({
  useTerminalUiStateStore: (selector: (state: { terminalUiStateByThreadKey: {} }) => unknown) =>
    selector({ terminalUiStateByThreadKey: {} }),
  selectThreadTerminalUiState: () => ({ terminalOpen: false }),
}));
vi.mock("../previewStateStore", () => ({ isPreviewSupportedInRuntime: () => false }));
vi.mock("../rightPanelStore", () => ({
  useRightPanelStore: (selector: (state: { byThreadKey: {} }) => unknown) =>
    selector({ byThreadKey: {} }),
  selectActiveRightPanel: () => null,
}));

import { WorkspaceGlobalShortcuts } from "./WorkspaceGlobalShortcuts";

function setup() {
  mocks.openCommandPalette.mockReset();
  mocks.startNewThreadFromContext.mockReset();
  mocks.undoLatestThreadAction.mockReset().mockReturnValue(true);
  mocks.navigate.mockReset();
  mocks.startScratchThread.mockReset();
  mocks.scratchEnvironmentId.mockReset().mockImplementation((id: string) => id);
  mocks.currentProjectRef = { environmentId: "remote", projectId: "project" };
  mocks.paletteOpen = false;
  mocks.terminalFocus = false;
}

function Harness() {
  return (
    <>
      <WorkspaceGlobalShortcuts />
      <input aria-label="Kanban search" />
    </>
  );
}

// Navigation is asserted through the mocked useNavigate, so this fixture needs no router.
const options = { router: false } as const;

async function press(key: string, options: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

it("opens new-thread selection without a chat, including from the Kanban search field", async () => {
  setup();
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  await using screen = await render(<Harness />, options);
  const input = screen.getByRole("textbox", { name: "Kanban search" }).element();
  input.focus();
  expect((await press("n", {}, input)).defaultPrevented).toBe(true);
  expect(mocks.openCommandPalette).toHaveBeenCalledWith({ open: "new-thread-in" });
  expect((await press("O", { shiftKey: true }, input)).defaultPrevented).toBe(true);
  expect(mocks.openCommandPalette).toHaveBeenCalledTimes(2);
  expect((await press("N", { shiftKey: true }, input)).defaultPrevented).toBe(true);
  expect(mocks.startNewThreadFromContext).toHaveBeenCalledWith(
    expect.objectContaining({
      defaultProjectRef: mocks.currentProjectRef,
    }),
  );
});

it("undoes thread actions outside chat while preserving text-field undo", async () => {
  setup();
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  await using screen = await render(<Harness />, options);
  expect((await press("z")).defaultPrevented).toBe(true);
  expect(mocks.undoLatestThreadAction).toHaveBeenCalledTimes(1);
  const input = screen.getByRole("textbox", { name: "Kanban search" }).element();
  input.focus();
  expect((await press("z", {}, input)).defaultPrevented).toBe(false);
  expect(mocks.undoLatestThreadAction).toHaveBeenCalledTimes(1);
});

it("leaves shortcuts to the palette, terminal, and keybinding recorder when they own input", async () => {
  setup();
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  await using screen = await render(<Harness />, options);
  mocks.paletteOpen = true;
  expect((await press("n")).defaultPrevented).toBe(false);
  mocks.paletteOpen = false;
  mocks.terminalFocus = true;
  expect((await press("n")).defaultPrevented).toBe(false);
  mocks.terminalFocus = false;
  const input = screen.getByRole("textbox", { name: "Kanban search" }).element();
  input.setAttribute("data-keybinding-capture", "");
  expect((await press("n", {}, input)).defaultPrevented).toBe(false);
  expect(mocks.openCommandPalette).not.toHaveBeenCalled();
});

it("opens the current remote project's Kanban without opening the palette", async () => {
  setup();
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  await using _screen = await render(<Harness />, options);
  expect((await press("K", { shiftKey: true })).defaultPrevented).toBe(true);
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: "/kanban/$environmentId/$projectId",
    params: { environmentId: "remote", projectId: "project" },
  });
  expect(mocks.openCommandPalette).not.toHaveBeenCalled();
  await press("K", { shiftKey: true, repeat: true });
  expect(mocks.navigate).toHaveBeenCalledTimes(1);
});

it("does not choose an unrelated project when no project is open", async () => {
  setup();
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  mocks.currentProjectRef = null;
  await using screen = await render(<Harness />, options);
  await screen.rerender(<Harness />);
  await press("k", { shiftKey: true });
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it("starts a thread without a project in the primary environment outside chat", async () => {
  setup();
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  await using _screen = await render(<Harness />, options);
  expect((await press("n", { altKey: true })).defaultPrevented).toBe(true);
  expect(mocks.startScratchThread).toHaveBeenCalledWith("primary");
  expect(mocks.openCommandPalette).not.toHaveBeenCalled();
});

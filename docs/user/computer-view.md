# Viewing a thread's computer

When a thread runs on _another_ machine that supports Computer Use, the chat header shows a
monitor button. It opens a live view of that computer's screen, like a lightweight remote desktop,
and `mod+alt+v` toggles it from the keyboard. Threads on the computer you are sitting at never show
it: its screen is the one already in front of you.

"Another machine" means any computer other than the one this MT Code window runs on: a paired
backend, a T3 Connect environment, an SSH host picked in **Run on**, or, when you use MT Code in a
browser pointed at a remote server, that server itself. A WSL backend on this computer counts as
this computer.

While the view is open:

- The screen refreshes a few times per second. Multi-display machines get a display picker in the
  view's header.
- Control is on by default: moving over the picture moves that machine's own cursor, and clicks,
  double-clicks, right-clicks, drags, scrolling and typing all land there the way they would if you
  were sitting at it. The pointer toggle switches to view-only, where only `Esc` (close) is handled
  locally.
- While controlling, keys go to the remote machine; use the toggle button or `mod+alt+v` to close.
- This is a real takeover, not the background input an agent uses: the remote pointer really moves
  and keystrokes go to whatever that machine has focused. Anyone sitting at it will see it happen.

The button only appears for other computers that have the desktop control helper, and the remote
machine must have Computer Use enabled in its Settings. An installed MT Code app ships the helper.
An SSH host runs a bare server with no app bundle, so it uses a copy that host already has: a
`~/computer-use` checkout build, the release `npx munim-computer-use` cached (0.4.1 or newer), or the
binary named by `MTCODE_DESKTOP_MCP_PATH`. On macOS the helper also needs the Screen
Recording permission. Everything travels over the same connection as the rest of the thread, so
remote and tunneled environments work unchanged.

#!/usr/bin/env bash
# Verify the MT Code fork's custom features are still WIRED, not just present.
#
# Why this exists: upstream merges into this fork have repeatedly kept a
# feature's modules, types, and tests while dropping the few lines that CALL
# them. Typecheck stays clean, unit tests stay green, and the feature is
# silently gone from the app (this happened to Goals, the usage "All" window,
# the composer /goal menu, the # thread-reference chip, and the web dictation
# mic). Each check below pins a feature's
# call-site — the line a merge is most likely to lose — not its module.
#
# Run it:
#   - after EVERY upstream merge, before pushing to fork/main
#   - personal-refresh-all.sh runs it before building; a failure aborts the
#     fleet refresh so a broken merge never ships to Mac/Blade/Dell
#
# When a check fails after a merge: the merge dropped that feature's wiring.
# Restore the call site (git log -S the pattern to find the last-good commit),
# do not delete the check. Only remove a check when Sheehan explicitly retires
# the feature.
set -uo pipefail

REPO="${T3_PERSONAL_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

fail=0

require() {
  # require <file> <grep-pattern> <feature description>
  local file="$1" pattern="$2" desc="$3"
  if [[ ! -f "$file" ]]; then
    echo "MISSING FILE: $file  ($desc)" >&2
    fail=1
    return
  fi
  if ! grep -q -- "$pattern" "$file"; then
    echo "DROPPED: '$pattern' not found in $file  ($desc)" >&2
    fail=1
  fi
}

# --- Usage "All" window (a7e8c621b) ---
require packages/shared/src/usageFormat.ts "ALL_USAGE_WINDOW_DAYS" "All-window sentinel in shared usage format"
require apps/web/src/components/usage/UsagePage.tsx 'label: "All"' "All option in web usage window picker"
require apps/mobile/src/features/usage/UsageRouteScreen.tsx 'label: "All"' "All option in mobile usage window picker"
require apps/server/src/usage/UsageService.ts "retentionCutoffMs" "All-window scan-cache retention in UsageService"

# --- Goals (86e27ef70, 579221de3, 07d149458) ---
require apps/server/src/orchestration-v2/ProjectionStore.ts 'activeProviderGoalForShell' "native provider goals projected into thread shells"
require apps/server/src/orchestration-v2/ProjectionStore.ts 'case "run.updated"' "queued run transitions projected into thread state"
require apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts 'goalCheckedTurns.delete' "native goal checks drive Claude continuation state"
require apps/server/src/orchestration-v2/Orchestrator.ts "const parsedGoalCommand = parseGoalCommand(command)" "/goal interception in V2 message dispatch"
require apps/web/src/components/CommandPalette.tsx "runGoalAction" "Objective actions in command palette"
require apps/web/src/components/sidebar/SidebarThreadRow.tsx 'aria-label="Active Objective"' "goal marker in sidebar"
require apps/web/src/components/chat/useComposerMenuItems.ts "buildBuiltInSlashCommandItems({ planModeUiEnabled })" "/goal items in composer slash menu"
require apps/web/src/components/chat/ChatComposer.tsx "ComposerGoalBadge" "goal badge rendered by composer"

# --- One-tap Continue as a Continuation Turn (upstream #11716, taken 2026-09-16) ---
# Continue starts a guarded manual continuation. The server owns its prompt
# and records a system notification instead of a user message.
require apps/web/src/components/chat/useComposerResume.ts "manualContinuationOfRunId: resumableRunId" "composer Resume dispatches the continuation of the interrupted run"
require apps/server/src/orchestration-v2/Orchestrator.ts 'command.manualContinuationOfRunId' "orchestrator validates one-tap continuations"
require apps/server/src/orchestration-v2/Orchestrator.ts 'summary: "Continued this turn"' "server authors continuation as a system notification"

# --- Cross-thread tools (a0d8862a1, ae1be5092, 146cd13a6) ---
require apps/server/src/mcp/McpHttpServer.ts 'layerOrchestratorToolkit,' "cross-thread orchestrator toolkit registered"
require apps/server/src/mcp/toolkits/orchestrator/handlers.ts 't3_thread_send: McpToolAccess.writesThreads(' "cross-thread send service registered in the orchestrator toolkit"
require apps/web/src/components/chat/useComposerMenuItems.ts "matchComposerThreadItems({" "thread-reference search in composer"
require apps/web/src/components/chat/ChatComposer.tsx "addComposerDraftThreadContexts(attachmentDraftTarget" "composer inserts selected thread-reference chips"
require apps/web/src/components/ComposerPromptEditorTiptap.tsx "    ComposerThreadExtension," "thread-reference chip editor extension registered"

# --- Voice dictation, web composer (5fe86fbb6, c239c12e0) ---
require apps/web/src/components/chat/ChatComposer.tsx "VoiceTranscriptionPanel" "dictation panel rendered by web composer"

# --- Computer-use permission/tool approvals (b671c08ef lineage) ---
require apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts 'providerRequestKindFromPermissions(payload.permissions)' "permissions approval requests mapped into runtime approvals"
require apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts 'handleServerRequest("item/permissions/requestApproval"' "Codex permissions approval handler registered"

# --- Resume-on-restart (65d715fb2) ---
require apps/server/src/serverRuntimeStartup.ts 'providerRuntimeRecovery.recover' "V2 provider recovery runs before the effect worker at boot"

# --- Computer-use agent cursor (b671c08ef) ---
# --- Computer Use ships munim-computer-use (fetched, not built) under MT's identity ---
require scripts/build-desktop-artifact.ts "stageMunimComputerUse" "desktop build stages the pinned munim-computer-use release"
require apps/server/src/desktopControl/desktopMcpLaunch.ts "mtcodeDesktopProfileEnv" "desktop MCP launched under the MT identity profile"
require apps/desktop/src/computerHistory/ComputerHistoryManager.ts "mtcodeDesktopProfileEnv" "Computer History daemon runs under the MT identity profile"
require apps/desktop/src/computerUse/nativeHost.ts "install-native-host" "MT Code registers its Chrome native host"

# --- Computer-use desktop MCP auto-injection into agent sessions (b671c08ef lineage, 2026-08-25) ---
# Every spawned session gets the bundled `mt-desktop` MCP server; user-defined
# servers with the same name win over injection.
require apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts 'command: session.desktopMcp.command' "desktop MCP injected into Claude sessions"
require apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts 'customDesktop && mcpSession' "user-config-wins guard on Claude desktop MCP injection"
require apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts 'command: mcpSession.desktopMcp.command' "desktop MCP injected into Codex sessions"
require apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts 'suppressDesktopMcp: customDesktopMcp' "user-config-wins guard on Codex desktop MCP injection"
require packages/provider-cursor/src/server/adapter.ts 'command: session.desktopMcp.command' "desktop MCP injected into Cursor sessions"
require packages/provider-acp/src/server/adapter.ts 'command: session.desktopMcp.command' "desktop MCP injected into shared ACP sessions"

# --- Computer-use thread view (9c23b7fa6, eb1bdd5e2) ---
require apps/server/src/ws.ts "computerViewStream" "computer view RPCs registered"
require apps/web/src/components/chat/ChatHeader.tsx "ComputerViewDialog" "computer view mounted in chat header"
# The monitor button shows whenever the thread's machine is not the client's
# (SSH hosts, paired backends, a browser on a remote server), not merely when
# the environment id differs from the primary. And an installed app must find
# the binary it ships: the server runs from inside app.asar / server.asar, so
# the packaged copy sits beside that archive (2026-09-29, Dell had no button).
require apps/web/src/components/chat/ChatHeader.tsx 'remoteOpenState.mode !== "local-exec"' "computer view gated on the thread's machine vs this client's"
require apps/server/src/desktopControl/desktopMcpBinary.ts "packagedDesktopMcpCandidates({" "server finds munim-computer-use beside the asar it runs from"

# --- Sidebar linked-PR badge (upstream #4755/#8160 wiring, restored 2026-09-02) ---
# Rows read the linked PR from the host and hold merged/closed state in the
# parent atom; a merge dropped this once and left the sidebar blind to links.
require apps/web/src/components/sidebar/SidebarThreadRow.tsx "useLinkedThreadPullRequest(" "sidebar rows read linked PR status"
# Upstream #10101 (223ff4490) moved PR linking to the server, deleting the
# client-side ThreadChangeRequestSnapshot atom this used to check. The badge
# itself is the fork feature, so the check now follows it to its new source.
require apps/web/src/components/sidebar/SidebarThreadRow.tsx "prStatusIndicator(pr, linkedPullRequestStatus?.sourceControlProvider)" "sidebar renders the linked-PR badge"

# --- Artwork + app icon pickers (44cf90dc0, 0efc0e293) ---
require apps/web/src/components/settings/AppearanceSettingsPanel.tsx "SidebarArtworkRow" "artwork picker in settings"
require apps/web/src/components/settings/AppearanceSettingsPanel.tsx "AppIconRow" "app icon picker in settings"

# --- Usage refresh rule (e7c556759) ---
require apps/web/src/state/usage.ts "refreshUsage({" "manual usage refresh uses the shared refresh service"
require packages/client-runtime/src/state/usage.ts "await executeAtomQuery(registry, query" "manual usage refresh waits for each environment response"

# --- Open-in-editor bundle discovery (833ef53b1) ---
require packages/contracts/src/editor.ts "VSCodium" "extended macAppName editor map"

# --- Branding (6beb464fb, f136dbff8) ---
require apps/server/src/appDisplayName.ts 'resolveAppDisplayName' "backend self-naming helper"
require apps/web/index.html "boot-shell-wordmark" "MT wordmark boot splash"

# --- PR upstream cards (27553c695) ---
require apps/web/src/components/pullRequest/PullRequestsPage.tsx "PullRequestUpstreamShelf" "upstream PR cards in pull-requests route"

# --- Connect providers: T3 relay baked + relay-capable default (2026-08-25) ---
require scripts/lib/connect-public-providers.ts "T3_CONNECT_PUBLIC_PROVIDER" "T3 Connect provider baked into every client build"
require apps/web/src/cloud/connectProviders.ts "relayCapable" "relay-capable provider preferred as default identity"

# --- munim new-thread env helpers (e51e0fc8e) ---
require apps/web/src/hooks/useHandleNewThread.ts "await readT3ProjectFile(project.environmentId, project.workspaceRoot)" "new-thread project-file defaults"

# --- File/PDF attachments (c32c7e223, restored 2026-08-29) ---
# A 2026-08-17 integrate left contracts on the old "pdf" attachment model while
# the server moved to upstream's generic "file" type, so the server bundle threw
# "PROVIDER_SEND_TURN_MAX_FILE_BYTES is not defined" on boot and crash-looped.
require packages/contracts/src/chatAttachment.ts 'ChatFileAttachment' "generic file attachment schema"
require packages/contracts/src/chatAttachment.ts 'ChatUnknownAttachment' "forward-compatible unknown attachment schema"
require apps/server/src/attachmentStore.ts 'case "file"' "file attachments get a stored path"
require packages/provider-cursor/src/server/adapter.ts 'providerMessageTextWithAttachmentPaths(' "non-image attachment paths sent to the Cursor SDK"
require apps/web/src/components/chat/TimelineUserMessageRow.tsx "filter(isImageAttachment)" "timeline image grid filters non-images"

# --- WS client analytics props (restored 2026-08-29) ---
# The merge dropped this argument from the makeWsRpcLayer call, so per-client
# telemetry never reached the RPC layer.
require apps/server/src/ws.ts "clientAnalyticsProps," "client analytics props passed into the ws rpc layer"

# --- Update changelog on every channel (5e8467899) ---
# Upstream gates the release-notes popover/tooltip to nightly; MT Code ships a
# single latest track with fullChangelog on, so the gate must stay removed.
require apps/web/src/components/sidebar/SidebarUpdatePill.tsx 'state !== null && state.releaseNotes.length > 0' "release-notes popover not gated to nightly"
require apps/web/src/components/sidebar/SidebarUpdateReleaseNotes.tsx 'if (state.releaseNotes.length === 0) {' "release-notes body not gated to nightly"

# --- Desktop auto-download / auto-install (personal fork) ---
# The 2026-09-01 sync silently broke auto-install when upstream turned
# installDownloadedUpdate into a function (the fork line yielded the function).
require apps/desktop/src/updates/DesktopUpdates.ts 'const fullChangelog = true;' "release notes fetched on every update channel"
require apps/desktop/src/updates/DesktopUpdates.ts 'yield\* downloadAvailableUpdate;' "auto-download when an update becomes available"
require apps/desktop/src/updates/DesktopUpdates.ts 'yield\* installDownloadedUpdate(info.version);' "auto-install pinned to the downloaded version"
# Remote-update flow must treat the fork's in-flight auto-install as prepared.
require apps/desktop/src/updates/DesktopRemoteUpdates.ts 'ready-to-install' "remote update publishes ready-to-install"
require scripts/build-desktop-artifact.ts "VC.Runtimes.x86.x64.Spectre" "Windows build preflight probes the real VS 2022 Spectre component id (upstream's VC.Tools.*.Spectre does not exist)"

# --- Fork wordmark ---
require apps/web/src/components/sidebar/SidebarChrome.tsx 'src={ktLogo}' "KT wordmark rendered in sidebar"

# --- Plugin marketplace (2026-09-16, a3455de80b / 06fffa29e3) ---
# Codex plugins are read through the app-server with lenient decoders; the
# CLI-only path silently dropped every Codex plugin once codex 0.154 emitted
# path-less remote records. The palette action is fork-only UI. Since
# 2026-09-29 the page is ChatGPT-style: Plugins / Apps / MCPs / Skills section
# tabs with counts, the harness demoted to a filter, and a Skills section that
# lists the environment's standalone skills.
require apps/server/src/plugins/CodexPluginMarketplace.ts "decodeCodexRuntimeCatalog" "Codex app-server catalog decoding in the plugin marketplace"
require apps/web/src/components/CommandPalette.tsx 'title: "Browse plugins"' "Browse plugins command-palette action"
require apps/web/src/components/settings/pluginMarketplace/PluginMarketplace.tsx 'aria-label="Plugin sections"' "Plugins / Apps / MCPs / Skills section tabs on the plugin marketplace page"
require apps/web/src/components/settings/pluginMarketplace/PluginMarketplace.tsx 'aria-label="Harness"' "harness filter on the plugin marketplace page"
require apps/web/src/components/settings/pluginMarketplace/PluginMarketplaceSkills.tsx "fetchEnvironmentSkillInventory" "standalone skills in the plugin marketplace Skills section"

# --- Usage limits for every driver (2026-09-16, 20308ea78b) ---
# Cursor and OpenCode publish subscription windows into upstream's Limits
# view; the fork-only AccountLimits strip/hover card was removed the same day.
require packages/provider-cursor/src/server/driver.ts 'readCursorUsageLimits(' "Cursor usage-limit probe wired into CursorProvider"
require packages/provider-opencode/src/server/driver.ts 'usageLimits: readOpenCodeGoUsageLimits(' "OpenCode usage-limit probe wired into OpenCodeProvider"

# --- Usage-limit recovery (upstream #11215 + #9012 port; kept over #12458, 2026-09-18) ---
require apps/server/src/persistence/Migrations.ts "ProjectionUsageLimitResume" "usage-limit resume migration (fork id 56)"
require apps/server/src/orchestration-v2/runtimeLayer.ts 'UsageLimitRecoveryWorker.layer.pipe(' "V2 usage-limit resume sweep wired"
require apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts 'providerFailureFromResult(message, completedAt, failureHint, usageLimited)' "Claude usage-limit classification"
require packages/client-runtime/src/state/threadSettled.ts "threadUsageLimitResetsAt" "snooze-until-reset source"
require apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.ts 'thread.settledOverride === "settled"' "settled threads excluded from usage-limit recovery"

# --- Upstream PRs taken 2026-09-18 (open upstream; keep until they merge there) ---
require apps/server/src/orchestration-v2/ThreadSettlementService.ts 'input.autoSettleKeepPullRequests === true && hasPullRequest' "auto-settle can preserve threads with a PR"
require apps/server/src/orchestration-v2/ThreadSettlementService.ts 'toMillis(thread.lastSnoozeWakeAt), timerWakeAtMs' "woken snoozed threads get a fresh auto-settle window"
require apps/server/src/process/externalLauncher.ts 'readHostEnv(COMMAND_LOOKUP_ENV_NAMES)' "editor discovery reads the hydrated PATH"
require apps/server/src/process/externalLauncher.ts 'resolveEditorCommand(editor, env)' "editor discovery uses shared app-bundle lookup"
require apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts 'excludeTurns: true' "exact native thread resume avoids loading history"
require apps/server/src/orchestration-v2/runtimeLayer.ts 'layerProviderContinuationWorkerProvided,' "provider wake requests drained by the V2 continuation worker"

# V2 resumes an existing native identity exactly; starting fresh would lose its history.
require apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts 'threadId: nativeThreadId,' "Codex resume targets the existing native thread"
require apps/server/src/orchestration-v2/ProviderSessionManager.ts 'yield\* resolveDesktopMcp()' "desktop MCP launch resolved for provider sessions"
require packages/provider-grok/src/server/adapter.ts 'return yield\* makeAcpAdapterV2({' "Grok uses the shared ACP desktop MCP injection"
require apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.ts 'thread.archivedAt !== null' "archived threads excluded from usage-limit recovery"
require packages/shared/src/editor.ts 'isVersionedBundle(entry, name)' "macOS editor bundles support versioned JetBrains installs"

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "fork-feature verification FAILED — an upstream merge dropped call sites." >&2
  echo "Restore the wiring before pushing to fork/main (git log -S '<pattern>' finds the last-good commit)." >&2
  exit 1
fi
echo "fork-feature verification OK (all custom call sites present)"

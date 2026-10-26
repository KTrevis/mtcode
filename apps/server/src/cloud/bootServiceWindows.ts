// Startup shortcuts require launcher supervision and file acknowledgements because Windows has no service manager here.
import { CLI_RELEASE_BASE_URL_ENV } from "@t3tools/shared/cliRelease";
import {
  Architecture as HostProcessArchitecture,
  Platform as HostProcessPlatform,
} from "@t3tools/shared/HostProcess";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpClient } from "effect/http";
import * as NodeOS from "node:os";

import * as ProcessRunner from "../processRunner.ts";
import * as BootService from "./bootService.ts";
import {
  ensurePinnedRuntimeInstalled,
  pinnedRuntimeCommand,
  pinnedRuntimePaths,
  PinnedRuntimeInstallError,
} from "./pinnedRuntime.ts";
import {
  SERVICE_LAUNCHER_PROTOCOL,
  SERVICE_LAUNCHER_CONTEXT_ENV,
  SERVICE_PID_FILE,
  SERVICE_STATE_FILE,
  decodeServiceLauncherPresence,
  serviceLauncherPresenceIsFromThisBoot,
  SERVICE_STOP_REQUEST_FILE,
  compareExactServiceVersions,
  parseServiceState,
  serviceStateActiveVersion,
  serviceStateHasPendingUpdate,
  type ServiceState,
} from "./serviceProtocol.ts";

/** Windows only. The shortcut basename doubles as the title of the window that
    blinks once at sign-in, because a console launched from a shortcut takes its
    title from the shortcut. "Server" rather than "Code" because the desktop app
    is a separate thing the user may also start. */
const SHORTCUT_NAME = "T3 Code Server";
export const SHORTCUT_FILE = `${SHORTCUT_NAME}.lnk`;
const STARTUP_SCRIPT_FILE = "service-startup.ps1";
const SHORTCUT_SCRIPT_FILE = "service-shortcut.ps1";

/**
 * Windows only. How long the CLI waits for a running launcher to shut down.
 *
 * It must comfortably exceed the launcher's own worst case. That is a restart
 * backoff (5s, now interruptible) plus one watch interval (2s), so 30s leaves
 * room for a slow database backup holding the launcher's transition queue.
 */
const STOP_REQUEST_TIMEOUT = Duration.seconds(30);
/** Windows only. How often the CLI re-checks whether the launcher has gone. */
const STOP_REQUEST_ACK_POLL = Duration.millis(250);
const POWERSHELL_TIMEOUT = Duration.seconds(30);

/**
 * Windows only. The absolute interpreter path, rather than trusting PATH.
 * The shortcut has to spell it out anyway, so every call site uses the same one.
 */
const powershellPath = (systemRoot: string) =>
  `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

// cmd expands percent variables even inside quoted paths, so these paths cannot be passed safely.
export function findPercentInPaths(
  paths: ReadonlyArray<readonly [label: string, value: string]>,
): string | undefined {
  const offender = paths.find(([, value]) => value.includes("%"));
  return offender === undefined ? undefined : offender[0];
}

/**
 * Windows only. Signal 0 asks the kernel whether a process exists without
 * touching it. Node implements it on Windows too. A permission error means the
 * process is there but not ours, which still counts as running.
 */
const processIsAlive = (pid: number): Effect.Effect<boolean> =>
  Effect.sync(() => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (cause) {
      return (cause as NodeJS.ErrnoException | undefined)?.code === "EPERM";
    }
  });

/** Windows only. Milliseconds since the epoch when this machine last booted. */
const currentBootTimeMs = DateTime.now.pipe(
  Effect.map((now) => DateTime.toEpochMillis(now) - NodeOS.uptime() * 1_000),
);

/** Windows only. PowerShell single-quoted strings escape a quote by doubling it. */
export function quotePowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface WindowsBootServicePlan extends BootService.BootServicePlan {
  readonly startupScriptPath: string;
  readonly shortcutScriptPath: string;
}

/** Windows only. What the preflight learned about this machine. */
export interface WindowsPreflight {
  readonly shellRunning: boolean;
  readonly entryDisabled: boolean;
  /** Absent when no shortcut exists yet. */
  readonly shortcutTarget?: string;
  readonly shortcutArguments?: string;
}

/** Windows only. What the shortcut must point at for the service to work. */
export function expectedShortcutArguments(plan: WindowsBootServicePlan): string {
  return `-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${plan.startupScriptPath}"`;
}

/**
 * Windows only. Pure renderer for the script the shortcut runs at sign-in.
 *
 * The command shell does the redirect because PowerShell cannot append, and
 * cannot send both streams to the same file. Doubling the outer quote is the
 * documented way to pass a fully quoted command line through `cmd /c`.
 */
export function renderStartupScript(plan: WindowsBootServicePlan): string {
  const program = plan.program.map((part) => `"${part}"`).join(" ");
  const command = `"${program} >> "${plan.logPath}" 2>&1"`;
  return [
    "# Generated by `t3 service install`. Do not edit; it is rewritten on update.",
    "$ErrorActionPreference = 'Stop'",
    "# Belt and braces. The blink is usually titled from the shortcut name.",
    `try { $Host.UI.RawUI.WindowTitle = ${quotePowerShellLiteral(SHORTCUT_NAME)} } catch { }`,
    `$env:T3CODE_HOME = ${quotePowerShellLiteral(plan.baseDir)}`,
    "# Nothing supervises a Startup folder entry, so the launcher supervises itself.",
    "$env:T3_SERVICE_SELF_SUPERVISE = '1'",
    `$logDir = Split-Path -Parent ${quotePowerShellLiteral(plan.logPath)}`,
    "if (-not (Test-Path -LiteralPath $logDir)) {",
    "  New-Item -ItemType Directory -Path $logDir -Force | Out-Null",
    "}",
    "$startInfo = New-Object System.Diagnostics.ProcessStartInfo",
    "$startInfo.FileName = $env:ComSpec",
    `$startInfo.Arguments = ${quotePowerShellLiteral(`/c ${command}`)}`,
    "$startInfo.UseShellExecute = $false",
    "# The whole point: the launcher runs with no console window at all.",
    "$startInfo.CreateNoWindow = $true",
    `$startInfo.WorkingDirectory = ${quotePowerShellLiteral(plan.baseDir)}`,
    "[System.Diagnostics.Process]::Start($startInfo) | Out-Null",
    "",
  ].join("\n");
}

/**
 * Windows only. Pure renderer for the script that probes, creates and removes
 * the shortcut. One script owns every shortcut interaction so there is a single
 * place to read when the Startup entry misbehaves.
 */
export function renderShortcutScript(plan: WindowsBootServicePlan): string {
  return [
    "# Generated by `t3 service install`. Do not edit; it is rewritten on update.",
    "param([Parameter(Mandatory = $true)][ValidateSet('Probe', 'Install')][string]$Action)",
    "$ErrorActionPreference = 'Stop'",
    `$shortcutPath = ${quotePowerShellLiteral(plan.unitPath)}`,
    `$shortcutFile = ${quotePowerShellLiteral(SHORTCUT_FILE)}`,
    "",
    "if ($Action -eq 'Probe') {",
    "  # The shell is what runs Startup folder entries. A different shell is a",
    "  # deliberate choice, so this is reported and not treated as a failure.",
    "  $shell = @(Get-Process -Name 'explorer' -ErrorAction SilentlyContinue).Count -gt 0",
    "  # Windows records entries disabled through Settings here. The low bit of",
    "  # the first byte is the disabled flag. It only means anything while the",
    "  # shortcut exists, because the value outlives the .lnk. Reporting a stale",
    "  # one sends the user hunting for an entry Startup apps no longer shows.",
    "  $key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder'",
    "  $disabled = $false",
    "  $present = Test-Path -LiteralPath $shortcutPath",
    "  if ($present -and (Test-Path -LiteralPath $key)) {",
    "    $value = (Get-ItemProperty -LiteralPath $key -Name $shortcutFile -ErrorAction SilentlyContinue).$shortcutFile",
    "    if ($null -ne $value -and $value.Length -gt 0) { $disabled = ($value[0] -band 1) -eq 1 }",
    "  }",
    '  Write-Output "shell=$shell"',
    '  Write-Output "disabled=$disabled"',
    "  # Read the shortcut back. That the script which wrote it still matches",
    "  # says nothing about a .lnk somebody edited or replaced since.",
    "  if ($present) {",
    "    $existing = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)",
    '    Write-Output "target=$($existing.TargetPath)"',
    '    Write-Output "arguments=$($existing.Arguments)"',
    "  }",
    "  exit 0",
    "}",
    "",
    "$startupDir = Split-Path -Parent $shortcutPath",
    "if (-not (Test-Path -LiteralPath $startupDir)) {",
    "  New-Item -ItemType Directory -Path $startupDir -Force | Out-Null",
    "}",
    "$shell = New-Object -ComObject WScript.Shell",
    "$shortcut = $shell.CreateShortcut($shortcutPath)",
    "$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
    `$shortcut.Arguments = ${quotePowerShellLiteral(expectedShortcutArguments(plan))}`,
    "$shortcut.WorkingDirectory = $env:USERPROFILE",
    `$shortcut.Description = ${quotePowerShellLiteral(`${SHORTCUT_NAME}, started at sign-in`)}`,
    "# Minimized, because PowerShell paints a console before it hides itself.",
    "$shortcut.WindowStyle = 7",
    "$shortcut.Save()",
    "",
  ].join("\n");
}

// An incomplete probe must fail closed; missing flags do not prove that startup is enabled.
export function parseProbeOutput(stdout: string): WindowsPreflight | undefined {
  const read = (key: string) => {
    const match = new RegExp(`^${key}=(True|False)\\s*$`, "im").exec(stdout)?.[1];
    return match === undefined ? undefined : match === "True";
  };
  const readText = (key: string) => new RegExp(`^${key}=(.*)$`, "im").exec(stdout)?.[1]?.trim();
  const shellRunning = read("shell");
  const entryDisabled = read("disabled");
  if (shellRunning === undefined || entryDisabled === undefined) return undefined;
  const shortcutTarget = readText("target");
  const shortcutArguments = readText("arguments");
  return {
    shellRunning,
    entryDisabled,
    ...(shortcutTarget === undefined ? {} : { shortcutTarget }),
    ...(shortcutArguments === undefined ? {} : { shortcutArguments }),
  };
}

export interface WindowsBootServiceInput {
  readonly baseDir: string;
  readonly logsDir: string;
  readonly cliVersion: string;
  readonly host?: BootService.BootServiceHost;
  /** Overridable so tests do not sit through the real wait. */
  readonly stopRequestTimeout?: Duration.Duration;
}

export const make = Effect.fn("cloud.boot_service_windows.make")(function* (
  input: WindowsBootServiceInput,
) {
  const platform = yield* HostProcessPlatform;
  const arch = yield* HostProcessArchitecture;
  const httpClient = yield* HttpClient.HttpClient;
  const releaseBaseUrl = Option.getOrUndefined(
    yield* Config.String(CLI_RELEASE_BASE_URL_ENV).pipe(Config.option),
  );
  const runningInsideService = Option.isSome(
    yield* Config.String(SERVICE_LAUNCHER_CONTEXT_ENV).pipe(Config.option),
  );
  const appData = yield* Config.String("APPDATA").pipe(Config.withDefault(""));
  const systemRoot = yield* Config.String("SystemRoot").pipe(Config.withDefault("C:\\Windows"));
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;

  const startupDir = path.join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
  );
  const unitPath = path.join(startupDir, SHORTCUT_FILE);
  const logPath = path.join(input.logsDir, "boot-service.log");
  const runtimeDir = path.join(input.baseDir, "runtime");
  const statePath = path.join(runtimeDir, SERVICE_STATE_FILE);
  const stopRequestPath = path.join(runtimeDir, SERVICE_STOP_REQUEST_FILE);
  const pidPath = path.join(runtimeDir, SERVICE_PID_FILE);
  const startupScriptPath = path.join(runtimeDir, STARTUP_SCRIPT_FILE);
  const shortcutScriptPath = path.join(runtimeDir, SHORTCUT_SCRIPT_FILE);
  const runtimePaths = pinnedRuntimePaths(path, input.baseDir, input.cliVersion, "win32");

  // The executable hosts the launcher as a hidden subcommand of itself, so the
  // shortcut runs the pinned runtime directly and the machine needs no Node.
  const plan: WindowsBootServicePlan = {
    program: [runtimePaths.entryPath, "__service-launcher"],
    baseDir: input.baseDir,
    logPath,
    unitPath,
    startupScriptPath,
    shortcutScriptPath,
  };

  /**
   * Windows only. A copy of the Linux durable write, minus its final directory
   * sync. Windows cannot open a directory as a file, so that sync always fails
   * here. Every other step is identical on purpose.
   */
  const writeDurably = (filePath: string, contents: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = path.dirname(filePath);
        yield* fs.makeDirectory(directory, { recursive: true });
        const tempPath = yield* fs.makeTempFileScoped({ directory, prefix: ".service-write-" });
        yield* fs.writeFileString(tempPath, contents, { mode: 0o600 });
        yield* (yield* fs.open(tempPath, { flag: "r" })).sync;
        yield* fs.rename(tempPath, filePath);
      }),
    ).pipe(Effect.mapError((cause) => new BootService.BootServiceInstallError({ cause })));

  const requireWindows = Effect.gen(function* () {
    if (platform !== "win32" || appData === "") {
      return yield* new BootService.BootServiceUnsupportedError({ platform });
    }
  });

  /** Windows only. A copy of the Linux step runner, duplicated for the same
      reason as the pinned-runtime step below: extracting it would restructure
      the systemd path. Fix bugs here and in bootService.ts together. */
  const runStep = Effect.fn("cloud.boot_service_windows.run_step")(function* (
    step: string,
    command: string,
    args: ReadonlyArray<string>,
    options?: { readonly timeout?: Duration.Input },
  ) {
    return yield* runner.run({ command, args, timeout: options?.timeout }).pipe(
      Effect.mapError((cause) => new BootService.BootServiceCommandError({ step, cause })),
      Effect.filterOrFail(
        (result) => result.code === 0,
        (result) =>
          new BootService.BootServiceCommandError({
            step,
            exitCode: Number(result.code),
            stdoutLength: result.stdout.length,
            stderrLength: result.stderr.length,
          }),
      ),
      Effect.tapError((error) =>
        DateTime.now.pipe(
          Effect.flatMap((now) =>
            fs.writeFileString(logPath, `${DateTime.formatIso(now)} ${error.message}\n`, {
              flag: "a",
            }),
          ),
          Effect.ignore,
        ),
      ),
    );
  });

  const powershell = powershellPath(systemRoot);

  const runPowerShellScript = (
    step: string,
    scriptPath: string,
    extraArgs: ReadonlyArray<string> = [],
  ) =>
    runStep(
      step,
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        ...extraArgs,
      ],
      { timeout: POWERSHELL_TIMEOUT },
    );

  const runShortcutScript = (step: string, action: "Probe" | "Install") =>
    runPowerShellScript(step, shortcutScriptPath, ["-Action", action]);

  /**
   * Windows only. Proves the Startup folder is usable and reports what would
   * silently stop the entry from ever running. The shortcut script must already
   * be on disk, which is safe: it lives under the data directory, not the
   * Startup folder, so nothing outside our own tree has been touched yet.
   */
  const preflight: Effect.Effect<
    WindowsPreflight,
    | BootService.BootServiceUnsupportedError
    | BootService.BootServiceInstallError
    | BootService.BootServiceCommandError
  > = Effect.gen(function* () {
    yield* requireWindows;
    yield* fs
      .makeDirectory(startupDir, { recursive: true })
      .pipe(Effect.mapError((cause) => new BootService.BootServiceInstallError({ cause })));
    // Prove it is writable now, rather than failing halfway through an install.
    yield* Effect.scoped(
      fs.makeTempFileScoped({ directory: startupDir, prefix: ".t3-service-probe-" }),
    ).pipe(Effect.mapError((cause) => new BootService.BootServiceInstallError({ cause })));

    const probe = yield* runShortcutScript("checking the Windows Startup folder", "Probe");
    const findings = parseProbeOutput(probe.stdout);
    if (findings === undefined) {
      return yield* new BootService.BootServiceCommandError({
        step: "reading the Windows Startup folder check",
        stdoutLength: probe.stdout.length,
        stderrLength: probe.stderr.length,
      });
    }
    return findings;
  });

  // Only disappearance of the PID record acknowledges a stop; the request alone cannot authorize runtime replacement.
  const pidRecordMtime = fs.stat(pidPath).pipe(
    Effect.map((info) => Option.map(info.mtime, (mtime) => mtime.getTime())),
    Effect.orElseSucceed(() => Option.none<number>()),
  );

  const requestStop = Effect.gen(function* () {
    // Only a confirmed absence means no launcher. A transient read error, say a
    // sharing violation while the launcher rewrites its record, must not be
    // read as proof the launcher is gone, or the install writes over a live one.
    const recorded = yield* fs.readFileString(pidPath).pipe(
      Effect.asSome,
      Effect.catch((error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed(Option.none<string>())
          : Effect.fail(new BootService.BootServiceInstallError({ cause: error })),
      ),
    );
    if (Option.isNone(recorded)) {
      yield* fs.remove(stopRequestPath, { force: true }).pipe(Effect.ignore);
      return false;
    }
    const presence = decodeServiceLauncherPresence(recorded.value);
    // Boot identity rejects recycled PIDs; only subsequent heartbeat observations distinguish a stale record from sleep.
    const recordMtimeBefore = yield* pidRecordMtime;
    const live =
      presence !== undefined &&
      serviceLauncherPresenceIsFromThisBoot(presence, yield* currentBootTimeMs) &&
      (yield* processIsAlive(presence.pid));
    if (!live || presence === undefined) {
      // No launcher is listening. Clear the request too: leaving one behind
      // would stop the very launcher this install is about to start.
      yield* fs.remove(pidPath, { force: true }).pipe(Effect.ignore);
      yield* fs.remove(stopRequestPath, { force: true }).pipe(Effect.ignore);
      return false;
    }
    const pid = presence.pid;

    // A launcher is confirmed alive, so a failed write must fail the whole
    // operation. Swallowing it would let the caller carry on and start a second
    // server against the same database.
    yield* fs
      .writeFileString(stopRequestPath, "")
      .pipe(Effect.mapError((cause) => new BootService.BootServiceInstallError({ cause })));

    const timeoutMs = Duration.toMillis(input.stopRequestTimeout ?? STOP_REQUEST_TIMEOUT);
    const pollMs = Math.min(timeoutMs, Duration.toMillis(STOP_REQUEST_ACK_POLL));
    const attempts = Math.max(1, Math.ceil(timeoutMs / pollMs));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      yield* Effect.sleep(Duration.millis(pollMs));
      const stillRunning = yield* fs.exists(pidPath).pipe(Effect.orElseSucceed(() => true));
      if (!stillRunning) return true;
    }
    // An unchanged heartbeat belongs to a dead or recycled owner; a changing one forbids replacing its runtime.
    const recordMtimeAfter = yield* pidRecordMtime;
    const neverRefreshed =
      Option.isNone(recordMtimeAfter) ||
      (Option.isSome(recordMtimeBefore) && recordMtimeBefore.value === recordMtimeAfter.value);
    if (neverRefreshed) {
      yield* fs.remove(pidPath, { force: true }).pipe(Effect.ignore);
      yield* fs.remove(stopRequestPath, { force: true }).pipe(Effect.ignore);
      return false;
    }
    return yield* new BootService.BootServiceCommandError({
      step: "stopping the running service",
      pid,
      timeoutSeconds: Math.round(timeoutMs / 1000),
    });
  });

  // Keep runtime validation consistent with the other boot service managers.
  const installPinnedRuntime = ensurePinnedRuntimeInstalled({
    baseDir: input.baseDir,
    version: input.cliVersion,
    fs,
    path,
    runner,
    httpClient,
    platform,
    arch,
    releaseBaseUrl,
    validate: (runtime) =>
      runner
        .run({
          command: pinnedRuntimeCommand(runtime).command,
          args: [...pinnedRuntimeCommand(runtime).args, "--version"],
          timeout: Duration.seconds(30),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new PinnedRuntimeInstallError({ step: "verifying the pinned t3 runtime", cause }),
          ),
          Effect.flatMap((result) => {
            const reportedVersion = /\bv(\S+)\s*$/.exec(result.stdout)?.[1];
            return result.code === 0 && reportedVersion === input.cliVersion
              ? Effect.void
              : Effect.fail(
                  new PinnedRuntimeInstallError({
                    step: "verifying the pinned t3 runtime",
                    exitCode: Number(result.code),
                    stdoutLength: result.stdout.length,
                    stderrLength: result.stderr.length,
                  }),
                );
          }),
        ),
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "PinnedRuntimeInstallError"
        ? new BootService.BootServiceCommandError({
            step: error.step,
            exitCode: error.exitCode,
            stdoutLength: error.stdoutLength,
            stderrLength: error.stderrLength,
            cause: error,
          })
        : new BootService.BootServiceInstallError({ cause: error }),
    ),
  );

  const install: BootService.BootService["Service"]["install"] = Effect.fn(
    "cloud.boot_service_windows.install",
  )(function* (options) {
    yield* requireWindows;
    yield* fs
      .makeDirectory(input.logsDir, { recursive: true })
      .pipe(Effect.mapError((cause) => new BootService.BootServiceInstallError({ cause })));

    const percentIn = findPercentInPaths([
      ["the t3 runtime", runtimePaths.entryPath],
      // Named with the variable that moves it, because the shared message
      // deliberately gives no relocation advice of its own.
      ["the T3 Code data directory (T3CODE_HOME)", plan.baseDir],
      ["the T3 Code log directory", plan.logPath],
    ]);
    if (percentIn !== undefined) {
      return yield* new BootService.BootServicePathHasPercentError({ pathLabel: percentIn });
    }

    // Write the shortcut script first so the preflight has something to run.
    // It lives under the data directory, so nothing user-visible changes yet.
    yield* writeDurably(shortcutScriptPath, renderShortcutScript(plan));
    const checks = yield* preflight;
    if (!checks.shellRunning) {
      // Not fatal. Running a different shell is a deliberate choice, and it is
      // the user's to make. Saying nothing would leave them with a service that
      // silently never starts.
      yield* Console.warn(
        "Windows Explorer is not running, and it is what starts Startup folder entries.\n" +
          "If you use a different shell, T3 Code may never start when you sign in.",
      );
    }
    if (checks.entryDisabled) {
      return yield* new BootService.BootServiceStartupEntryDisabledError({
        shortcutName: SHORTCUT_NAME,
      });
    }

    // Prepare every immutable artifact before stopping a running launcher.
    yield* installPinnedRuntime;

    const installed = yield* fs
      .exists(unitPath)
      .pipe(Effect.mapError((cause) => new BootService.BootServiceInstallError({ cause })));
    // Before anything is stopped. This guard exists to protect an in-flight
    // remote update, and terminating the launcher first would interrupt the
    // very thing it is guarding.
    const previousStateText = yield* fs.readFileString(statePath).pipe(Effect.option);
    if (Option.isSome(previousStateText) && serviceStateHasPendingUpdate(previousStateText.value)) {
      return yield* new BootService.BootServiceUpdatePendingError();
    }
    // An older CLI must not silently replace a newer service.
    if (installed && Option.isSome(previousStateText)) {
      const installedVersion = serviceStateActiveVersion(previousStateText.value);
      if (
        installedVersion !== undefined &&
        options?.allowDowngrade !== true &&
        compareExactServiceVersions(input.cliVersion, installedVersion) < 0
      ) {
        return yield* new BootService.BootServiceDowngradeRefusedError({
          installedVersion,
          targetVersion: input.cliVersion,
        });
      }
    }

    // Keyed on the pid file, never on the shortcut. A launcher outlives a
    // manually deleted shortcut, and starting a second one alongside it would
    // put two servers on the same database.
    const stopped = yield* requestStop;

    yield* Effect.gen(function* () {
      yield* writeDurably(
        statePath,
        // @effect-diagnostics-next-line preferSchemaOverJson:off - fixed launcher-owned document.
        `${JSON.stringify(
          {
            protocol: SERVICE_LAUNCHER_PROTOCOL,
            activeVersion: input.cliVersion,
          } satisfies ServiceState,
          null,
          2,
        )}\n`,
      );
      yield* writeDurably(startupScriptPath, renderStartupScript(plan));

      yield* runShortcutScript("creating the Windows Startup shortcut", "Install");
      // Start last. No administrative state write occurs after this succeeds.
      yield* runPowerShellScript("starting the service", startupScriptPath);
    }).pipe(
      Effect.tapError(() =>
        installed || stopped
          ? runPowerShellScript(
              "restarting the service after a failed update",
              startupScriptPath,
            ).pipe(Effect.ignore)
          : Effect.void,
      ),
    );
    return plan satisfies BootService.BootServicePlan;
  });

  const uninstall: BootService.BootService["Service"]["uninstall"] = Effect.gen(function* () {
    yield* requireWindows;
    const installed = yield* fs
      .exists(unitPath)
      .pipe(Effect.mapError((cause) => new BootService.BootServiceInstallError({ cause })));

    // Stop first, and decide that on the pid file rather than the shortcut. A
    // launcher survives someone deleting the shortcut by hand, and leaving it
    // running is exactly what the user asked us not to do.
    const stopped = yield* requestStop;
    if (!installed && !stopped) return false;

    // A shortcut is an ordinary file, so removing it needs no PowerShell. That
    // also means a missing or broken generated script cannot strand the entry.
    yield* fs
      .remove(unitPath, { force: true })
      .pipe(Effect.mapError((cause) => new BootService.BootServiceInstallError({ cause })));
    yield* fs.remove(startupScriptPath, { force: true }).pipe(Effect.ignore);
    yield* fs.remove(shortcutScriptPath, { force: true }).pipe(Effect.ignore);
    return true;
  }).pipe(Effect.withSpan("cloud.boot_service_windows.uninstall"));

  const status: BootService.BootService["Service"]["status"] = Effect.gen(function* () {
    const base = { kind: "win32-startup-shortcut", unitPath, logPath } as const;
    if (platform !== "win32" || appData === "") {
      return { supported: false, installed: false, current: false, ...base };
    }
    if (!(yield* fs.exists(unitPath))) {
      return { supported: true, installed: false, current: false, ...base };
    }
    const [startupScript, shortcutScript, runtimeEntryExists, runtimeSentinel, stateText] =
      yield* Effect.all([
        fs.readFileString(startupScriptPath).pipe(Effect.option),
        fs.readFileString(shortcutScriptPath).pipe(Effect.option),
        fs.exists(runtimePaths.entryPath),
        fs.readFileString(runtimePaths.sentinelPath).pipe(Effect.option),
        fs.readFileString(statePath).pipe(Effect.option),
      ]);
    const state = Option.isSome(stateText) ? parseServiceState(stateText.value) : undefined;
    const installedVersion = Option.isSome(stateText)
      ? serviceStateActiveVersion(stateText.value)
      : undefined;
    // Read the shortcut itself back, because the script that wrote it matching
    // proves nothing about the .lnk someone may have edited or replaced since.
    const shortcut = yield* runShortcutScript(
      "checking the Windows Startup shortcut",
      "Probe",
    ).pipe(
      Effect.map((probe) => parseProbeOutput(probe.stdout)),
      Effect.orElseSucceed(() => undefined),
    );
    const shortcutMatches =
      shortcut?.shortcutTarget === powershell &&
      shortcut.shortcutArguments === expectedShortcutArguments(plan);
    // Duplicated from the Linux status. The runtime and state checks are the
    // same, but the Linux copy also compares the systemd unit, so it cannot be
    // shared without changing the Linux path.
    return {
      supported: true,
      installed: true,
      ...(installedVersion === undefined ? {} : { installedVersion }),
      current:
        shortcutMatches &&
        Option.isSome(startupScript) &&
        startupScript.value === renderStartupScript(plan) &&
        // The shortcut script embeds the shortcut path, the interpreter and the
        // window style, so comparing it is what catches shortcut drift.
        Option.isSome(shortcutScript) &&
        shortcutScript.value === renderShortcutScript(plan) &&
        runtimeEntryExists &&
        Option.isSome(runtimeSentinel) &&
        runtimeSentinel.value.trim() === input.cliVersion &&
        state?.activeVersion === input.cliVersion &&
        state?.update?.status !== "pending",
      ...base,
    };
  }).pipe(
    Effect.mapError((cause) => new BootService.BootServiceInstallError({ cause })),
    Effect.withSpan("cloud.boot_service_windows.status"),
  );

  const restart: BootService.BootService["Service"]["restart"] = Effect.gen(function* () {
    yield* requireWindows;
    // Nothing installed here is nothing of ours to restart. The generated
    // startup script is the artifact that proves this base directory owns it.
    const script = yield* fs.readFileString(startupScriptPath).pipe(Effect.option);
    if (Option.isNone(script) || script.value !== renderStartupScript(plan))
      return "skipped" as const;
    if (runningInsideService) {
      const restartProgram = `[IO.File]::WriteAllText(${quotePowerShellLiteral(stopRequestPath)}, ''); $deadline = (Get-Date).AddSeconds(30); while (Test-Path -LiteralPath ${quotePowerShellLiteral(pidPath)}) { if ((Get-Date) -gt $deadline) { exit 1 }; Start-Sleep -Milliseconds 250 }; & ${quotePowerShellLiteral(startupScriptPath)}`;
      const encoded = Buffer.from(restartProgram, "utf16le").toString("base64");
      yield* runStep("queuing the service restart", powershell, [
        "-NoProfile",
        "-Command",
        `Start-Process -FilePath ${quotePowerShellLiteral(powershell)} -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand',${quotePowerShellLiteral(encoded)}`,
      ]);
      return "queued" as const;
    }
    yield* requestStop;
    yield* runPowerShellScript("restarting the service", startupScriptPath);
    return "restarted" as const;
  }).pipe(Effect.withSpan("cloud.boot_service_windows.restart"));

  const withStopped = Effect.fn("cloud.boot_service_windows.with_stopped")(function* <A, E, R>(
    operation: Effect.Effect<A, E, R>,
  ): Effect.fn.Return<A, E | BootService.BootServiceError, R> {
    if (platform !== "win32") return yield* operation;
    const script = yield* fs.readFileString(startupScriptPath).pipe(Effect.option);
    if (Option.isNone(script) || script.value !== renderStartupScript(plan))
      return yield* operation;
    return yield* Effect.acquireUseRelease(
      requestStop,
      () => operation,
      (wasRunning, exit) => {
        if (!wasRunning) return Effect.void;
        const start = runPowerShellScript("restoring the service", startupScriptPath);
        return Exit.isFailure(exit) ? Effect.ignore(start) : start;
      },
    );
  });
  return BootService.BootService.of({ install, restart, withStopped, uninstall, status });
});

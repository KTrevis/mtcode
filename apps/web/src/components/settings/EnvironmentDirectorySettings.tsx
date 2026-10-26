import { APP_BASE_NAME } from "../../branding";
import { useEnvironmentOperateAccess } from "../../hooks/useEnvironmentOperateAccess";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import type { EnvironmentPresentation } from "../../state/environments";
import { DraftInput } from "../ui/draft-input";
import { SettingResetButton, SettingsRow } from "./settingsLayout";

/**
 * Directory defaults for one environment. Inputs hold only what is stored on
 * that server; its own default shows as the placeholder, so an empty field
 * reads as "use the default" and the reset arrow marks an override.
 */
export function EnvironmentDirectoryRows({
  environment,
}: {
  environment: EnvironmentPresentation;
}) {
  const settings = useEnvironmentSettings(environment.environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environment.environmentId);
  const operateAccess = useEnvironmentOperateAccess(environment.environmentId);
  const disabledReason =
    environment.connection.phase !== "connected"
      ? "Connect to edit directories."
      : operateAccess === "pending"
        ? "Checking access…"
        : operateAccess !== "granted"
          ? "Your session cannot edit settings."
          : null;
  const disabled = disabledReason !== null;
  const supportsWorktreeDirectory =
    environment.serverConfig?.environment.capabilities.worktreeBaseDirectory === true;
  // Older servers don't report defaults; Add Project opens at "~/" there.
  const defaults = environment.serverConfig?.environment.defaultDirectories;

  return (
    <>
      <SettingsRow
        title="Repositories directory"
        description="Add Project and Clone Repository start here."
        status={disabledReason}
        aria-disabled={disabled || undefined}
        resetAction={
          !disabled && settings.addProjectBaseDirectory !== "" ? (
            <SettingResetButton
              label="repositories directory"
              onClick={() => updateSettings({ addProjectBaseDirectory: "" })}
            />
          ) : null
        }
        control={
          <DraftInput
            size="sm"
            className="w-full sm:w-72"
            value={settings.addProjectBaseDirectory}
            onCommit={(addProjectBaseDirectory) => updateSettings({ addProjectBaseDirectory })}
            disabled={disabled}
            placeholder={defaults?.repositories ?? "~"}
            spellCheck={false}
            aria-label="Repositories directory"
          />
        }
      />
      <SettingsRow
        title="Worktrees directory"
        description={
          supportsWorktreeDirectory
            ? "New worktrees only. Existing worktrees stay where they are."
            : "Update this server to set a worktrees directory."
        }
        status={disabledReason}
        aria-disabled={disabled || !supportsWorktreeDirectory || undefined}
        resetAction={
          !disabled && supportsWorktreeDirectory && settings.worktreeBaseDirectory !== "" ? (
            <SettingResetButton
              label="worktrees directory"
              onClick={() => updateSettings({ worktreeBaseDirectory: "" })}
            />
          ) : null
        }
        control={
          <DraftInput
            size="sm"
            className="w-full sm:w-72"
            value={settings.worktreeBaseDirectory}
            onCommit={(worktreeBaseDirectory) => updateSettings({ worktreeBaseDirectory })}
            disabled={disabled || !supportsWorktreeDirectory}
            placeholder={defaults?.worktrees ?? `${APP_BASE_NAME} default`}
            spellCheck={false}
            aria-label="Worktrees directory"
          />
        }
      />
    </>
  );
}

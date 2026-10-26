// Desktop supplies its product brand; standalone servers use the fork default.

const DEFAULT_APP_DISPLAY_NAME = "KT Code";

export function resolveAppDisplayName(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.T3CODE_APP_DISPLAY_NAME?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_APP_DISPLAY_NAME;
}

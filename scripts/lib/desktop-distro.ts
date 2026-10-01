/**
 * KT distribution identity for personal-fork desktop builds.
 *
 * Set T3CODE_DESKTOP_DISTRO=kt when packaging installers for munimtech.com.
 * Default (unset) keeps the official T3 Code identity for the private SSH fleet.
 */

export type DesktopDistroId = "default" | "kt";

export interface DesktopDistroIdentity {
  readonly id: DesktopDistroId;
  readonly appId: string;
  readonly productName: string;
  readonly packageName: string;
  readonly artifactName: string;
  readonly description: string;
  readonly author: string;
  readonly updateRepository: string | undefined;
  readonly protocolSchemes: readonly string[];
  readonly protocolName: string;
  readonly linuxExecutableName: string;
  readonly linuxStartupWmClass: string;
  /** .deb control-file Maintainer. */
  readonly linuxMaintainer: string;
  readonly nsisShortcutName: string;
  readonly nsisInstallDirectoryName: string;
}

const OFFICIAL: DesktopDistroIdentity = {
  id: "default",
  appId: "com.t3tools.t3code",
  productName: "T3 Code",
  packageName: "t3code",
  artifactName: "T3-Code-${version}-${arch}.${ext}",
  description: "T3 Code desktop build",
  author: "T3 Tools",
  updateRepository: undefined,
  protocolSchemes: ["t3code", "t3code-dev"],
  protocolName: "T3 Code",
  linuxExecutableName: "t3code",
  linuxStartupWmClass: "t3code",
  linuxMaintainer: "T3 Tools <hello@t3.codes>",
  nsisShortcutName: "T3 Code",
  nsisInstallDirectoryName: "t3code",
};

const KT: DesktopDistroIdentity = {
  id: "kt",
  appId: "com.munim.mtcode",
  productName: "KT Code",
  packageName: "mtcode",
  artifactName: "MT-Code-${version}-${arch}.${ext}",
  description: "KT Code — Munim Technologies fork of T3 Code",
  author: "Munim, Inc.",
  updateRepository: "munimtechnologies/mtcode",
  protocolSchemes: ["mtcode", "mtcode-dev"],
  protocolName: "KT Code",
  linuxExecutableName: "mtcode",
  linuxStartupWmClass: "mtcode",
  linuxMaintainer: "Munim Technologies <support@munimtech.com>",
  nsisShortcutName: "KT Code",
  nsisInstallDirectoryName: "mtcode",
};

export function resolveDesktopDistroId(
  raw: string | undefined | null = process.env.T3CODE_DESKTOP_DISTRO,
): DesktopDistroId {
  return raw?.trim() === "kt" || raw?.trim() === "munim" ? "kt" : "default";
}

export function resolveDesktopDistroIdentity(
  raw: string | undefined | null = process.env.T3CODE_DESKTOP_DISTRO,
): DesktopDistroIdentity {
  return resolveDesktopDistroId(raw) === "kt" ? KT : OFFICIAL;
}

/**
 * Keep the munim-computer-use pin on the newest release, so an MT Code release
 * never ships an older desktop-control server than the one already published.
 * The fleet release runs `node scripts/bump-munim-computer-use.ts` before it
 * builds anything, and commits the pin when it moved.
 */
import type { MunimComputerUseManifest } from "@t3tools/shared/munimComputerUse";

/** Numeric per part, so 0.4.10 sorts after 0.4.9. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/** `<sha256>  <file>` lines, as a release's SHA256SUMS.txt writes them. */
export function parseSha256Sums(text: string): ReadonlyMap<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match) sums.set(match[2]!, match[1]!.toLowerCase());
  }
  return sums;
}

/**
 * The manifest pinned to `version` with that release's checksums, or null when
 * the pin is already there or ahead. Every asset MT Code ships must appear in
 * the sums: a release missing a platform must not be pinned half-filled.
 */
export function bumpedManifest(
  manifest: MunimComputerUseManifest,
  version: string,
  sums: ReadonlyMap<string, string>,
): MunimComputerUseManifest | null {
  if (compareVersions(version, manifest.version) <= 0) return null;
  const assets = Object.fromEntries(
    Object.entries(manifest.assets).map(([key, asset]) => {
      const sha256 = sums.get(asset.name);
      if (sha256 === undefined) {
        throw new Error(`munim-computer-use ${version} publishes no checksum for ${asset.name}`);
      }
      return [key, { ...asset, sha256 }];
    }),
  );
  return { ...manifest, version, assets };
}

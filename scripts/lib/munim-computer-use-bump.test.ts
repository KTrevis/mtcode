import { assert, describe, it } from "@effect/vitest";
import type { MunimComputerUseManifest } from "@t3tools/shared/munimComputerUse";

import { bumpedManifest, compareVersions, parseSha256Sums } from "./munim-computer-use-bump.ts";

const pinned: MunimComputerUseManifest = {
  repository: "munimtechnologies/munim-computer-use",
  version: "0.4.3",
  assets: {
    "darwin-universal": { name: "munim-computer-use-macos-universal.zip", sha256: "a".repeat(64) },
    "win32-x64": { name: "munim-computer-use-windows-x64.zip", sha256: "b".repeat(64) },
  },
};

const sums = parseSha256Sums(
  [
    `${"1".repeat(64)}  munim-computer-use-macos-universal.zip`,
    `${"2".repeat(64)}  munim-computer-use-windows-x64.zip`,
    `${"3".repeat(64)}  munim-computer-use-linux-x64.tar.gz`,
    "",
  ].join("\n"),
);

describe("munim-computer-use pin bump", () => {
  it("compares versions per part, not as text", () => {
    assert.strictEqual(compareVersions("0.4.10", "0.4.9"), 1);
    assert.strictEqual(compareVersions("0.5.0", "0.4.99"), 1);
    assert.strictEqual(compareVersions("0.4.4", "0.4.4"), 0);
    assert.strictEqual(compareVersions("0.4.3", "0.4.4"), -1);
  });

  it("pins a newer release with its published checksums", () => {
    const next = bumpedManifest(pinned, "0.4.4", sums);
    assert.strictEqual(next?.version, "0.4.4");
    assert.strictEqual(next?.assets["darwin-universal"]?.sha256, "1".repeat(64));
    assert.strictEqual(next?.assets["win32-x64"]?.sha256, "2".repeat(64));
  });

  it("leaves the pin alone when it is current or ahead", () => {
    assert.strictEqual(bumpedManifest(pinned, "0.4.3", sums), null);
    assert.strictEqual(bumpedManifest(pinned, "0.4.2", sums), null);
  });

  it("refuses a release that is missing a platform MT Code ships", () => {
    const partial = parseSha256Sums(`${"1".repeat(64)}  munim-computer-use-macos-universal.zip\n`);
    assert.throws(() => bumpedManifest(pinned, "0.4.4", partial), /windows-x64/);
  });
});

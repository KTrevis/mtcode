// @effect-diagnostics nodeBuiltinImport:off - Tests create a temporary packaged manifest for the synchronous pre-ready resolver.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

import { resolveDesktopDistroIdentity } from "./desktop-distro.ts";
import { resolveRuntimeDesktopDistro } from "../../apps/desktop/src/app/desktopDistro.ts";

it.each(["kt", "munim"])("keeps the KT identity and existing data for %s builds", (name) => {
  const build = resolveDesktopDistroIdentity(name);
  const runtime = resolveRuntimeDesktopDistro({
    env: { T3CODE_DESKTOP_DISTRO: name },
    isDevelopment: false,
  });
  expect(build.id).toBe("kt");
  expect(build.productName).toBe("KT Code");
  expect(build.appId).toBe("com.munim.mtcode");
  expect(runtime.id).toBe("kt");
  expect(runtime.baseName).toBe(build.productName);
  expect(runtime.userDataDirName).toBe("mt");
  expect(runtime.defaultHomeDirName).toBe(".mt");
});

it.each(["kt", "munim"])(
  "recognizes packaged %s builds without an environment override",
  (name) => {
    const appPath = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kt-distro-"));
    try {
      NodeFS.writeFileSync(
        NodePath.join(appPath, "package.json"),
        JSON.stringify({ t3DesktopDistro: name }),
      );
      expect(resolveRuntimeDesktopDistro({ env: {}, appPath, isDevelopment: false }).id).toBe("kt");
    } finally {
      NodeFS.rmSync(appPath, { recursive: true, force: true });
    }
  },
);

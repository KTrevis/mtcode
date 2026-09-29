// @effect-diagnostics nodeBuiltinImport:off - fixture provider files on disk.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { ACTIVE_USER_HEADER, activeUserHeaders, readProviderAccounts } from "./activeUser.ts";

const CLAUDE_UUID = "5f0c1d2e-aaaa-4bbb-8ccc-0123456789ab";
const CODEX_ID = "8e7d6c5b-1111-4222-9333-abcdefabcdef";

function home(files: Record<string, unknown>): string {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mtcode-active-user-"));
  for (const [file, content] of Object.entries(files)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(directory, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(directory, file), JSON.stringify(content));
  }
  return directory;
}

const signedIn = () =>
  home({
    ".claude.json": { oauthAccount: { accountUuid: CLAUDE_UUID, emailAddress: "me@example.com" } },
    ".codex/auth.json": { tokens: { account_id: CODEX_ID, id_token: "secret" } },
  });

describe("anonymous active-user codes", () => {
  it("gives every device on the same accounts the same codes for the day", () => {
    const laptop = activeUserHeaders({ homeDirectory: signedIn(), env: {}, day: "2026-09-29" });
    const desktop = activeUserHeaders({ homeDirectory: signedIn(), env: {}, day: "2026-09-29" });
    expect(laptop).toEqual(desktop);
    expect(laptop[ACTIVE_USER_HEADER]?.split(",")).toHaveLength(2);
  });

  it("changes every day, so one day's codes cannot be linked to the next", () => {
    const directory = signedIn();
    const today = activeUserHeaders({ homeDirectory: directory, env: {}, day: "2026-09-29" });
    const tomorrow = activeUserHeaders({ homeDirectory: directory, env: {}, day: "2026-09-30" });
    const codes = (headers: Record<string, string>) => headers[ACTIVE_USER_HEADER]!.split(",");
    for (const code of codes(tomorrow)) expect(codes(today)).not.toContain(code);
  });

  it("sends only opaque hashes, never the account id, email or token", () => {
    const value = activeUserHeaders({ homeDirectory: signedIn(), env: {}, day: "2026-09-29" })[
      ACTIVE_USER_HEADER
    ]!;
    expect(value).toMatch(/^[0-9a-f]{32},[0-9a-f]{32}$/);
    for (const secret of [CLAUDE_UUID, CODEX_ID, "me@example.com", "secret"]) {
      expect(value).not.toContain(secret);
    }
  });

  it("sends nothing when signed out, and honours relocated provider homes", () => {
    expect(activeUserHeaders({ homeDirectory: home({}), env: {}, day: "2026-09-29" })).toEqual({});
    const elsewhere = home({
      "claude/.claude.json": { oauthAccount: { accountUuid: CLAUDE_UUID } },
      "codex/auth.json": { tokens: { account_id: CODEX_ID } },
    });
    expect(
      readProviderAccounts({
        homeDirectory: home({}),
        env: {
          CLAUDE_CONFIG_DIR: NodePath.join(elsewhere, "claude"),
          CODEX_HOME: NodePath.join(elsewhere, "codex"),
        },
      }),
    ).toEqual([
      ["claude", CLAUDE_UUID],
      ["codex", CODEX_ID],
    ]);
  });
});

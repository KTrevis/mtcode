import type { PluginMarketplacePlugin } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canQuickInstallListing,
  marketplaceContentsSummary,
  mergeMarketplaceListings,
} from "./catalog";
import { filterMarketplacePlugins, marketplaceSectionCounts, skillMatchesHarness } from "./filter";

function plugin(
  id: string,
  input: {
    readonly category: string;
    readonly summary: string;
    readonly mcp?: number;
    readonly skills?: number;
    readonly apps?: number;
    readonly harness?: "codex" | "claude";
    readonly installed?: boolean;
  },
): PluginMarketplacePlugin {
  const mcp = input.mcp ?? 0;
  const skills = input.skills ?? 0;
  const apps = input.apps ?? 0;
  return {
    id: `${id}@marketplace`,
    sourceHarness: input.harness ?? "codex",
    packageName: id,
    name: id.replaceAll("-", " "),
    summary: input.summary,
    developer: "OpenAI",
    category: input.category,
    version: "1.0.0",
    marketplaceName: "marketplace",
    marketplaceSourceType: "git",
    installPolicy: "AVAILABLE",
    authPolicy: "ON_INSTALL",
    installed: input.installed ?? false,
    enabled: input.installed ?? false,
    brandColor: null,
    hasLocalLogo: false,
    logoDataUrl: null,
    logoUrl: null,
    contents: {
      mcpServerCount: mcp,
      skillCount: skills,
      appCount: apps,
      commandCount: 0,
      agentCount: 0,
      ruleCount: 0,
      hookCount: 0,
      hasHooks: false,
    },
    support: [
      {
        harness: input.harness ?? "codex",
        mcp: mcp > 0,
        skills: skills > 0,
        apps: apps > 0,
      },
    ],
  };
}

const PLUGINS = [
  plugin("github", {
    category: "Developer tools",
    summary: "Review pull requests and manage repositories",
    mcp: 1,
    skills: 3,
  }),
  plugin("computer-use", {
    category: "Productivity",
    summary: "Control local Mac apps from Codex",
    mcp: 1,
    skills: 1,
    apps: 1,
    installed: true,
  }),
  plugin("design-tools", {
    category: "Design",
    summary: "Turn designs into code",
    skills: 2,
    harness: "claude",
  }),
];

const DEFAULT_FILTERS = {
  query: "",
  section: "plugins",
  status: "all",
  harness: "all",
  category: "all",
} as const;

describe("filterMarketplacePlugins", () => {
  it("searches live catalog metadata", () => {
    expect(
      filterMarketplacePlugins(PLUGINS, { ...DEFAULT_FILTERS, query: "pull request" }).map(
        (entry) => entry.packageName,
      ),
    ).toEqual(["github"]);
    expect(
      filterMarketplacePlugins(PLUGINS, { ...DEFAULT_FILTERS, query: "computer-use" }).map(
        (entry) => entry.packageName,
      ),
    ).toEqual(["computer-use"]);
  });

  it("narrows the Apps, MCPs, and Skills sections to bundles that ship that component", () => {
    expect(
      filterMarketplacePlugins(PLUGINS, { ...DEFAULT_FILTERS, section: "mcps" }).map(
        (entry) => entry.packageName,
      ),
    ).toEqual(["github", "computer-use"]);
    expect(
      filterMarketplacePlugins(PLUGINS, { ...DEFAULT_FILTERS, section: "skills" }).map(
        (entry) => entry.packageName,
      ),
    ).toEqual(["github", "computer-use", "design-tools"]);
    expect(
      filterMarketplacePlugins(PLUGINS, { ...DEFAULT_FILTERS, section: "apps" }).map(
        (entry) => entry.packageName,
      ),
    ).toEqual(["computer-use"]);
  });

  it("filters by install status within a section", () => {
    expect(
      filterMarketplacePlugins(PLUGINS, { ...DEFAULT_FILTERS, status: "installed" }).map(
        (entry) => entry.packageName,
      ),
    ).toEqual(["computer-use"]);
    expect(
      filterMarketplacePlugins(PLUGINS, {
        ...DEFAULT_FILTERS,
        section: "mcps",
        status: "available",
      }).map((entry) => entry.packageName),
    ).toEqual(["github"]);
  });

  it("combines harness and category filters", () => {
    expect(
      filterMarketplacePlugins(PLUGINS, {
        ...DEFAULT_FILTERS,
        harness: "claude",
        category: "Design",
      }).map((entry) => entry.packageName),
    ).toEqual(["design-tools"]);
  });
});

describe("mergeMarketplaceListings", () => {
  it("groups same-named packages and keeps unrelated names apart", () => {
    const figma = mergeMarketplaceListings([
      {
        ...plugin("figma", { category: "Design", summary: "Codex Figma", mcp: 1, installed: true }),
        name: "Figma",
      },
      {
        ...plugin("figma-claude", {
          category: "Design",
          summary: "Claude Figma",
          skills: 1,
          harness: "claude",
        }),
        name: "Figma",
      },
      plugin("docs-canvas", { category: "Design", summary: "Different plugin" }),
    ]);

    expect(figma.map((entry) => entry.name)).toEqual(["Figma", "docs canvas"]);
    expect(figma[0]?.installed).toBe(true);
    expect(figma[0]?.support.map((entry) => entry.harness)).toEqual(["codex", "claude"]);
    expect(figma[0]?.contents.mcpServerCount).toBe(1);
    expect(figma[0]?.contents.skillCount).toBe(1);
  });
});

describe("marketplaceSectionCounts", () => {
  const installed = [
    plugin("cloudflare", { category: "Dev", summary: "", mcp: 5, skills: 13, installed: true }),
    plugin("security", { category: "Dev", summary: "", mcp: 1, apps: 3, installed: true }),
    plugin("writer", {
      category: "Docs",
      summary: "",
      skills: 2,
      harness: "claude",
      installed: true,
    }),
    plugin("unused", { category: "Dev", summary: "", mcp: 9, skills: 9, apps: 9 }),
  ];

  it("counts installed plugins and the apps, MCP servers, and skills they ship", () => {
    expect(marketplaceSectionCounts(installed, "all", 4)).toEqual({
      plugins: 3,
      apps: 3,
      mcps: 6,
      skills: 19,
    });
  });

  it("follows the harness filter and waits for the skill inventory", () => {
    expect(marketplaceSectionCounts(installed, "claude", null)).toEqual({
      plugins: 1,
      apps: 0,
      mcps: 0,
      skills: null,
    });
  });
});

describe("listing card helpers", () => {
  it("offers one-click install only for single-harness plugins this app can install", () => {
    const available = plugin("github", { category: "Dev", summary: "" });
    expect(canQuickInstallListing(available)).toBe(true);
    expect(canQuickInstallListing({ ...available, installed: true })).toBe(false);
    expect(canQuickInstallListing({ ...available, installPolicy: "EXTERNAL" })).toBe(false);
    expect(canQuickInstallListing({ ...available, marketplaceName: "ChatGPT Public" })).toBe(false);
    const [merged] = mergeMarketplaceListings([
      { ...available, name: "Figma" },
      { ...plugin("figma", { category: "Dev", summary: "", harness: "claude" }), name: "Figma" },
    ]);
    expect(merged && canQuickInstallListing(merged)).toBe(false);
  });

  it("leads the contents line with the browsed component", () => {
    const bundle = plugin("security", {
      category: "Dev",
      summary: "",
      mcp: 1,
      apps: 3,
      skills: 12,
    });
    expect(marketplaceContentsSummary(bundle)).toBe("12 skills · 1 MCP server");
    expect(marketplaceContentsSummary(bundle, "apps")).toBe("3 apps · 1 MCP server");
    expect(marketplaceContentsSummary(plugin("remote", { category: "Dev", summary: "" }))).toBe("");
  });

  it("matches skill driver kinds to marketplace harnesses", () => {
    expect(skillMatchesHarness("claudeAgent", "claude")).toBe(true);
    expect(skillMatchesHarness("codex", "claude")).toBe(false);
    expect(skillMatchesHarness("opencode", "all")).toBe(true);
  });
});

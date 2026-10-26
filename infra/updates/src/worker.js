// Differential Range downloads bypass GitHub counters; failures redirect to the original release URL.

const REPO = "munimtechnologies/mtcode";
const TAG_PREFIX = "munim-v";
const FEED_CACHE_SECONDS = 60;

/** latest.yml, latest-mac.yml, latest-linux.yml, latest-linux-arm64.yml, and nightly twins */
const FEED_RE = /^\/(latest|nightly)(-mac|-linux(?:-arm64)?)?\.yml$/;
/**
 * MT-Code-0.0.84-arm64.dmg, ...-x64.exe.blockmap, and friends. Linux names
 * carry the packager's own arch spelling: electron-builder writes
 * MT-Code-<version>-x86_64.AppImage and MT-Code-<version>-amd64.deb for x64.
 */
const ASSET_RE =
  /^\/MT-Code-(.+?)-(?:arm64|x64|x86_64|amd64)\.(?:dmg|zip|exe|AppImage|deb)(?:\.blockmap)?$/;

const githubLatest = (name) => `https://github.com/${REPO}/releases/latest/download/${name}`;
const githubTagged = (version, name) =>
  `https://github.com/${REPO}/releases/download/${TAG_PREFIX}${version}/${name}`;

/**
 * A stable pseudonym for one install, so the same machine polling all day is
 * one active install and a differential update's many range requests are one
 * delivery. IP and user agent are hashed with a secret and never stored.
 */
async function clientId(request, env) {
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const ua = request.headers.get("user-agent") ?? "";
  const data = new TextEncoder().encode(`${env.CLIENT_SALT ?? "mtcode"}:${ip}:${ua}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function platformOf(pathname) {
  if (pathname.endsWith("-mac.yml") || pathname.endsWith(".dmg") || pathname.endsWith(".zip")) {
    return "mac";
  }
  if (
    /-linux(?:-arm64)?\.yml$/.test(pathname) ||
    pathname.endsWith(".AppImage") ||
    pathname.endsWith(".deb")
  ) {
    return "linux";
  }
  if (pathname.endsWith(".yml") || pathname.endsWith(".exe")) return "win";
  return "";
}

/**
 * One row per client per version per day per kind. The primary key does the
 * de-duplication, so a differential update that issues forty range requests
 * counts once and a client polling every four minutes counts once a day.
 */
async function record(env, { kind, client, version, platform }) {
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO events (day, kind, client, version, platform)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(day, kind, client, version ?? "", platform ?? "")
    .run();
}

async function serveFeed(request, env, ctx, url) {
  const name = url.pathname.slice(1);
  const cache = caches.default;
  const cacheKey = new Request(`https://feed.invalid/${name}`, { method: "GET" });

  let response = await cache.match(cacheKey);
  if (!response) {
    const upstream = await fetch(githubLatest(name), {
      headers: { "user-agent": "mtcode-updates-worker" },
      redirect: "follow",
    });
    if (!upstream.ok) {
      // No feed is better served by a wrong answer than by an error: send the
      // updater to GitHub, which is where it looked before this Worker existed.
      return Response.redirect(githubLatest(name), 302);
    }
    response = new Response(await upstream.arrayBuffer(), {
      headers: {
        "content-type": "text/yaml; charset=utf-8",
        "cache-control": `public, max-age=${FEED_CACHE_SECONDS}`,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  const codes = activeUserCodes(request);
  const platform = platformOf(url.pathname);
  ctx.waitUntil(
    clientId(request, env)
      .then(async (client) => {
        await record(env, { kind: "poll", client, version: "", platform });
        for (const code of codes) {
          await record(env, { kind: "person", client, version: code, platform });
        }
      })
      .catch(() => {}),
  );
  return response;
}

/**
 * The app's anonymous active-user codes (apps/desktop/src/updates/activeUser.ts):
 * one-way hashes of an opaque Claude or ChatGPT account id and the UTC date,
 * the same on every device signed into that account and different every day.
 * Anything that is not such a hash is ignored.
 */
function activeUserCodes(request) {
  const header = request.headers.get("x-mtcode-active-user") ?? "";
  return [...new Set(header.split(",").map((code) => code.trim().toLowerCase()))]
    .filter((code) => /^[0-9a-f]{32}$/.test(code))
    .slice(0, 4);
}

function serveAsset(request, env, ctx, url, version) {
  const name = url.pathname.slice(1);
  // Count only ranged archive deliveries; GitHub counts full downloads and blockmaps are not deliveries.
  if (!name.endsWith(".blockmap") && request.headers.has("range")) {
    ctx.waitUntil(
      clientId(request, env)
        .then((client) =>
          record(env, { kind: "deliver", client, version, platform: platformOf(url.pathname) }),
        )
        .catch(() => {}),
    );
  }
  // Redirect rather than stream: the updater already follows GitHub's own
  // redirect to object storage, and a 302 keeps 150 MB of release payload off
  // the Worker while still putting every request through this counter.
  return Response.redirect(githubTagged(version, name), 302);
}

// Count one delivery per client/day and merge devices sharing a daily account code.
// Active-user codes expire after two days; clients without a code each count as one user.
async function stats(env) {
  const [total, monthly, installs, links] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (SELECT DISTINCT day, client FROM events WHERE kind = 'deliver')`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (SELECT DISTINCT day, client FROM events
       WHERE kind = 'deliver' AND day >= date('now', '-30 day'))`,
    ),
    env.DB.prepare(
      `SELECT DISTINCT client FROM events WHERE kind = 'poll' AND day = date('now', '-1 day')`,
    ),
    env.DB.prepare(
      `SELECT client, version AS code FROM events
       WHERE kind = 'person' AND day = date('now', '-1 day')`,
    ),
  ]);
  await env.DB.prepare(`DELETE FROM events WHERE kind = 'person' AND day < date('now', '-2 day')`)
    .run()
    .catch(() => {});
  const clients = installs.results.map((row) => row.client);
  return {
    deliveries: total.results[0]?.n ?? 0,
    deliveriesLast30Days: monthly.results[0]?.n ?? 0,
    activeInstalls: clients.length,
    activeUsers: countPeople(clients, links.results),
  };
}

/** Installs joined by any shared code, counted as connected groups. */
function countPeople(clients, links) {
  const parent = new Map();
  const find = (node) => {
    let root = node;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(node, root);
    return root;
  };
  const add = (node) => {
    if (!parent.has(node)) parent.set(node, node);
  };
  for (const client of clients) add(`install:${client}`);
  for (const { client, code } of links) {
    if (!parent.has(`install:${client}`)) continue;
    add(`code:${code}`);
    parent.set(find(`install:${client}`), find(`code:${code}`));
  }
  return new Set(clients.map((client) => find(`install:${client}`))).size;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/stats") {
        return Response.json(await stats(env), {
          headers: { "cache-control": "public, max-age=300" },
        });
      }

      if (FEED_RE.test(url.pathname)) {
        return await serveFeed(request, env, ctx, url);
      }

      const asset = ASSET_RE.exec(url.pathname);
      if (asset) {
        return serveAsset(request, env, ctx, url, asset[1]);
      }

      if (url.pathname === "/") {
        return Response.json({
          service: "mtcode-updates",
          repo: REPO,
          routes: [
            "/latest-mac.yml",
            "/latest.yml",
            "/latest-linux.yml",
            "/MT-Code-<version>-<arch>.<ext>",
            "/stats",
          ],
        });
      }

      return new Response("not found", { status: 404 });
    } catch {
      // Never let a counting bug break an update. Anything the Worker cannot
      // serve goes to the GitHub URL the updater would have used anyway.
      return Response.redirect(githubLatest(url.pathname.slice(1)), 302);
    }
  },
};

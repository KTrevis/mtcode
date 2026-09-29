# MT Code update feed

A Cloudflare Worker at `updates.mtcode.munimtech.com` that sits between the desktop
updater and GitHub Releases, so updates can be counted.

## Why it exists

GitHub publishes one cumulative download counter per release asset, and it only
moves for a full-file request. A `Range:` request returns `206` and leaves it
alone — verified directly against a release asset. electron-updater takes
exactly that path: it fetches the `.blockmap`, then range-requests the archive,
whenever a blockmap is published, which is every release here. So publishing
straight at the repo made **every differential auto-update invisible**, and the
README badge could only ever report full downloads.

It also reported the wrong thing entirely until recently: summing every asset
counted the update feed, and one always-on install fetches `latest-mac.yml`
every four minutes. 7396 of the first 7430 "downloads" were feed polls and
blockmap reads.

## What it does

The Worker owns no artifacts. GitHub Releases stays the only place a release
lives.

| Route                                                                  | Behaviour                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/latest-mac.yml`, `/latest.yml`, `/latest-linux.yml`, `/nightly*.yml` | Proxied from the newest GitHub release, cached 60s. Records a poll.               |
| `/MT-Code-<version>-<arch>.<ext>` (also `.blockmap`)                   | `302`s to that version's GitHub asset; a ranged archive fetch records a delivery. |
| `/stats`                                                               | `{ deliveries, deliveriesLast30Days, activeInstalls }`                            |

`<arch>.<ext>` covers the macOS `.dmg`/`.zip`, the Windows `.exe`, and Linux,
where electron-builder spells x64 its own way: `x86_64.AppImage` and `amd64.deb`.

Redirecting rather than streaming keeps ~150 MB of release payload off the
Worker while still putting every request through the counter — the updater
already follows GitHub's own redirect to object storage.

Anything the Worker cannot serve falls through to a `302` at the same GitHub URL
the app used before this existed. A broken Worker must not mean a fleet that
cannot update.

## Counting

D1, one row per `(day, kind, client, version)`. The primary key does the
de-duplication: a differential update that issues forty range requests is one
delivery, and a client polling every four minutes is one poll per day.

Only a **ranged** archive request is a delivery: that is the differential update
GitHub cannot see. A full-file request is left to GitHub's counter, which sees it
after the redirect, so the two never count the same download. Blockmaps are never
deliveries — the updater reads the installed version's blockmap as well as the new
one's, which used to log every update twice (once for the version it replaced).

`/stats` counts deliveries once per client per day, which also folds those older
double rows together, and reports **active installs as the clients that polled on
the last complete UTC day**.

`client` is a truncated SHA-256 of a secret salt, the IP and the user agent. No
address is stored, and the value is meaningless without `CLIENT_SALT`.

## How the app finds it

`T3CODE_DESKTOP_UPDATE_URL` makes `resolveGitHubPublishConfig` emit a `generic`
publish provider instead of `github`; `scripts/personal-publish-github-release.sh`
sets it, and passes it to the Windows build host and to the Linux build in its WSL
Ubuntu (`scripts/personal-linux-build.sh`). `useMultipleRangeRequest` must
stay `false`: the bytes come from GitHub's release storage, which answers a
multi-range request with **501**, and the generic provider enables multi-range by
default.

Builds without that variable still publish straight at GitHub, so a plain
`pnpm dist:desktop:*` needs no extra service.

## Migration

Every install built since the switch reads this feed, and older ones moved onto
it with their next update. Active installs therefore come from here alone: the
`latest-mac.yml` fetches GitHub still counts are mostly this Worker refilling its
60 s feed cache, so the GitHub-side estimate `.github/workflows/download-counts.yml`
used to add counted the same Macs twice and was dropped. Downloads still sum
both sides: GitHub's full-file counts and this Worker's ranged deliveries.

## Operating

```bash
wrangler deploy                                   # ship
wrangler d1 migrations apply mtcode-updates --remote
wrangler tail mtcode-updates                      # live logs
wrangler d1 execute mtcode-updates --remote \
  --command "SELECT day, kind, COUNT(*) FROM events GROUP BY day, kind ORDER BY day DESC LIMIT 20"
```

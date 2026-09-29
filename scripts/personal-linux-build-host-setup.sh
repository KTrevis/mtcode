#!/usr/bin/env bash
# Provision a Debian/Ubuntu host (Blade's WSL2 Ubuntu by default) to build the
# MT Code Linux desktop artifacts. Idempotent: every step checks before it
# installs, so personal-linux-build.sh runs it before each build.
#
# Installs what LINUX_DESKTOP_BUILD_PREREQUISITES in
# scripts/build-desktop-artifact.ts checks for (cargo + the x64 Rust target,
# a C toolchain and make, libsecret headers + pkg-config, ImageMagick), plus
# Node 24 (the engines range in package.json) and Vite+ (`vp`), which runs every
# install and build step, and fetches pnpm itself. Plus unzip, which staging
# munim-computer-use needs.
#
# Runs as root (Blade's WSL default user) or as a user with passwordless sudo;
# apt is the only step that needs either.
#
# Node and Vite+ live under $HOME and are put on PATH by the build script, not
# by shell profiles, so nothing here changes how the host's other services run.
set -euo pipefail

NODE_MAJOR=24
NODE_ROOT="$HOME/.local/mtcode-node"
RUST_TARGET="x86_64-unknown-linux-gnu"

log() { printf '[linux-build-host-setup] %s\n' "$*"; }

# WSL appends the Windows PATH; a Windows node/pnpm must never win.
PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '^/mnt/' | paste -sd: -)"
export PATH

if [[ "$(uname -m)" != "x86_64" ]]; then
  log "this host is $(uname -m); only x86_64 builds are supported" >&2
  exit 1
fi

SUDO=()
if [[ "$(id -u)" != "0" ]]; then
  SUDO=(sudo -n)
fi

# --- System packages ---
APT_PACKAGES=(
  build-essential
  ca-certificates
  curl
  git
  imagemagick
  libsecret-1-dev
  pkg-config
  python3
  # scripts/lib/munim-computer-use.ts unpacks the Chrome extension with it.
  unzip
  xz-utils
)
# Electron's runtime libraries (the .deb's Depends in createBuildConfig), so
# personal-linux-build.sh can start the packaged binary as a smoke test.
# Ubuntu 24.04+ renamed some for 64-bit time; the first name apt knows wins.
ELECTRON_RUNTIME_PACKAGES=(
  "libasound2t64 libasound2"
  "libatspi2.0-0t64 libatspi2.0-0"
  "libgbm1"
  "libgtk-3-0t64 libgtk-3-0"
  "libnotify4"
  "libnss3"
  "libsecret-1-0"
  "libxss1"
  "libxtst6"
)
installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"; }
# The alternatives below are resolved with apt-cache, which knows nothing
# before the first update on a fresh host.
if ! compgen -G "/var/lib/apt/lists/*_Packages" >/dev/null; then
  "${SUDO[@]}" env DEBIAN_FRONTEND=noninteractive apt-get update -q
fi
missing=()
for package in "${APT_PACKAGES[@]}"; do
  installed "$package" || missing+=("$package")
done
for alternatives in "${ELECTRON_RUNTIME_PACKAGES[@]}"; do
  have=""
  for package in $alternatives; do
    installed "$package" && have=1 && break
  done
  [[ -n "$have" ]] && continue
  for package in $alternatives; do
    if apt-cache show "$package" >/dev/null 2>&1; then
      missing+=("$package")
      break
    fi
  done
done
if [[ ${#missing[@]} -gt 0 ]]; then
  log "installing apt packages: ${missing[*]}"
  "${SUDO[@]}" env DEBIAN_FRONTEND=noninteractive apt-get update -q
  "${SUDO[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "${missing[@]}"
else
  log "apt packages present"
fi

# --- Rust ---
if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck source=/dev/null
  . "$HOME/.cargo/env"
fi
if ! command -v rustup >/dev/null 2>&1; then
  log "installing rustup (stable, minimal profile)"
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs |
    sh -s -- -y --profile minimal --default-toolchain stable --no-modify-path
  # shellcheck source=/dev/null
  . "$HOME/.cargo/env"
fi
if ! rustup target list --installed | grep -qx "$RUST_TARGET"; then
  log "adding Rust target $RUST_TARGET"
  rustup target add "$RUST_TARGET"
fi

# --- Node 24 from nodejs.org, checksum-verified ---
node_ok() {
  [[ -x "$NODE_ROOT/current/bin/node" ]] &&
    [[ "$("$NODE_ROOT/current/bin/node" -p 'process.versions.node.split(".")[0]')" == "$NODE_MAJOR" ]]
}
if ! node_ok || [[ "${MTCODE_LINUX_UPGRADE_NODE:-}" == "1" ]]; then
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  sums="$(curl -fsSL "$base/SHASUMS256.txt")"
  file="$(awk '/ node-v[0-9.]+-linux-x64\.tar\.xz$/ { print $2; exit }' <<<"$sums")"
  sha="$(awk -v f="$file" '$2 == f { print $1; exit }' <<<"$sums")"
  [[ -n "$file" && -n "$sha" ]] || { log "could not resolve the Node $NODE_MAJOR tarball" >&2; exit 1; }
  version_dir="$NODE_ROOT/${file%.tar.xz}"
  if [[ ! -x "$version_dir/bin/node" ]]; then
    log "installing $file"
    tmp="$(mktemp -d)"
    curl -fsSL "$base/$file" -o "$tmp/$file"
    echo "$sha  $tmp/$file" | sha256sum -c --quiet -
    mkdir -p "$NODE_ROOT"
    tar -xJf "$tmp/$file" -C "$NODE_ROOT"
    rm -rf "$tmp"
  fi
  ln -sfn "$version_dir" "$NODE_ROOT/current"
fi
export PATH="$NODE_ROOT/current/bin:$PATH"

# --- Vite+ ---
# VP_HOME pins the same ~/.vite-plus layout the Mac and Windows hosts use;
# VP_NODE_MANAGER=no keeps the installer from shimming `node` for the whole
# user, since the build puts Node 24 on PATH itself.
if [[ ! -x "$HOME/.vite-plus/bin/vp" ]]; then
  log "installing Vite+"
  curl -fsSL https://vite.plus | VP_HOME="$HOME/.vite-plus" VP_NODE_MANAGER=no bash
fi
export PATH="$HOME/.vite-plus/bin:$PATH"

log "node $(node --version), vp $(vp --version 2>/dev/null | head -1), $(cargo --version), $(pkg-config --modversion libsecret-1 | sed 's/^/libsecret /')"

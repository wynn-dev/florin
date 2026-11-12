#!/bin/sh
# Installs or updates florin for the current user:
#
#   curl -fsSL https://raw.githubusercontent.com/wynn-dev/florin/main/install.sh | sh
#
# It needs curl (or wget), tar and a sha256 tool; the release carries its own
# Node. florin goes to ~/.local/share/florin/<version>, with
# ~/.local/share/florin/current pointing at it and ~/.local/bin/florin
# linking to its launcher. Running it again updates florin in place and
# restarts its service if that is running.
#
#   FLORIN_VERSION=0.2.0       install this version instead of the newest
#   FLORIN_DOWNLOAD_URL=...    fetch checksums.txt and the tarball from here
#                              instead of GitHub Releases (used by CI)
#
# Everything is inside main, called on the last line, so a partly downloaded
# script does nothing.

main() {
  set -eu
  repo="wynn-dev/florin"
  share="$HOME/.local/share/florin"
  bindir="$HOME/.local/bin"
  # FLORIN_SERVICE_NAME is for florin's own tests, which use a unit of their own.
  service=${FLORIN_SERVICE_NAME:-florin}
  label="io.github.wynn-dev.$service"

  platform=$(detect_platform)
  need tar
  sha256_tool >/dev/null || die "florin's installer needs sha256sum, shasum or openssl to check the download."

  version=${FLORIN_VERSION:-}
  version=${version#v}
  if [ -n "${FLORIN_DOWNLOAD_URL:-}" ]; then
    base=${FLORIN_DOWNLOAD_URL%/}
  elif [ -n "$version" ]; then
    base="https://github.com/$repo/releases/download/v$version"
  else
    base="https://github.com/$repo/releases/latest/download"
  fi

  tmp=$(mktemp -d "${TMPDIR:-/tmp}/florin-install.XXXXXX")
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 1' INT TERM

  download "$base/checksums.txt" "$tmp/checksums.txt" ||
    die "Couldn't download $base/checksums.txt. Check the version and your connection."
  if [ -z "$version" ]; then
    version=$(sed -n "s/^[0-9a-f]*  florin-\(.*\)-$platform\.tar\.gz\$/\1/p" "$tmp/checksums.txt" | head -n 1)
    [ -n "$version" ] || die "The release at $base has no florin build for $platform."
    [ -n "${FLORIN_DOWNLOAD_URL:-}" ] || base="https://github.com/$repo/releases/download/v$version"
  fi
  file="florin-$version-$platform.tar.gz"
  expected=$(awk -v f="$file" '$2 == f { print $1 }' "$tmp/checksums.txt")
  [ -n "$expected" ] || die "The release has no $file. florin $version may not exist or may not support $platform."

  say "Downloading florin $version for $platform"
  download "$base/$file" "$tmp/$file" || die "Couldn't download $base/$file."
  actual=$(sha256_tool "$tmp/$file")
  [ "$actual" = "$expected" ] ||
    die "The download's checksum doesn't match: expected $expected, got $actual. Nothing was installed. Try again; if it keeps failing, report it at https://github.com/$repo/issues."

  tar -xzf "$tmp/$file" -C "$tmp"
  unpacked="$tmp/florin-$version-$platform"
  [ -x "$unpacked/bin/florin" ] || die "The tarball doesn't hold bin/florin; nothing was installed."

  mkdir -p "$share" "$bindir"
  rm -rf "$share/.new-$version" "$share/.old-$version"
  mv "$unpacked" "$share/.new-$version"
  [ ! -e "$share/$version" ] || mv "$share/$version" "$share/.old-$version"
  mv "$share/.new-$version" "$share/$version"
  ln -sfn "$version" "$share/current"
  ln -sfn "$share/current/bin/florin" "$bindir/florin"

  restarted=$(restart_service)
  # Earlier versions go once the service runs the new one.
  for old in "$share"/* "$share"/.old-*; do
    [ -e "$old" ] || continue
    case ${old##*/} in
      current | "$version") ;;
      *) rm -rf "$old" ;;
    esac
  done

  say "Installed florin $version in $share/$version"
  if [ -n "$restarted" ]; then
    say "florin's service was running and now runs florin $version."
  else
    case ":${PATH:-}:" in
      *":$bindir:"*) ;;
      *) say "Add ~/.local/bin to your PATH: export PATH=\"\$HOME/.local/bin:\$PATH\" (and put that line in your shell's profile)." ;;
    esac
    say "Then run florin service install to keep it running in the background, or florin start to try it in this terminal."
  fi
}

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'florin install: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "florin's installer needs $1; install it and run this again."
}

detect_platform() {
  os=$(uname -s)
  arch=$(uname -m)
  case $os in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) die "florin has no build for $os; it runs on Linux and macOS." ;;
  esac
  case $arch in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) die "florin has no build for $arch processors; it runs on x64 and arm64." ;;
  esac
  # A shell under Rosetta reports x86_64 on an Apple silicon Mac.
  if [ "$os-$arch" = darwin-x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then
    arch=arm64
  fi
  if [ "$os" = linux ] && ls /lib/ld-musl-* >/dev/null 2>&1 && ! ls /lib*/ld-linux-* /lib/*/ld-linux-* >/dev/null 2>&1; then
    die "This Linux uses musl (Alpine, for example); florin's bundled Node needs glibc."
  fi
  echo "$os-$arch"
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    die "florin's installer needs curl or wget."
  fi
}

sha256_tool() {
  if command -v sha256sum >/dev/null 2>&1; then
    [ -z "${1:-}" ] || sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    [ -z "${1:-}" ] || shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v openssl >/dev/null 2>&1; then
    [ -z "${1:-}" ] || openssl dgst -sha256 "$1" | sed 's/.*= *//'
  else
    return 1
  fi
}

# Restarts florin's service if it is installed and running, and prints
# "restarted" when it did.
restart_service() {
  if [ "$(uname -s)" = Darwin ]; then
    target="gui/$(id -u)/$label"
    if [ -f "$HOME/Library/LaunchAgents/$label.plist" ] && launchctl print "$target" >/dev/null 2>&1; then
      if launchctl kickstart -k "$target" >/dev/null; then echo restarted; else restart_failed; fi
    fi
  elif command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet "$service.service" 2>/dev/null; then
    if systemctl --user restart "$service.service"; then echo restarted; else restart_failed; fi
  fi
}

restart_failed() {
  printf '%s\n' "florin install: couldn't restart florin's service; run florin service start, and florin service status to see why." >&2
}

main "$@"

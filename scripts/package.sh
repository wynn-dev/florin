#!/bin/sh
# Packages the build in .output/ into one release tarball per platform, each
# with the official Node runtime for that platform and a bin/florin launcher,
# plus dist/checksums.txt. Run `pnpm build` first.
#
#   scripts/package.sh                 all four platforms
#   scripts/package.sh linux-x64       just these
#
# NODE_VERSION picks the Node release to bundle; by default it is the newest
# release of the major version package.json's engines field asks for.
# Downloads are kept in ~/.cache/florin-package between runs.
set -eu

ALL_PLATFORMS="linux-x64 linux-arm64 darwin-x64 darwin-arm64"
root=$(cd "$(dirname "$0")/.." && pwd)
dist="$root/dist"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/florin-package"

fail() {
  echo "package: $*" >&2
  exit 1
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

[ -f "$root/.output/cli.mjs" ] || fail "no build in .output/; run pnpm build first"
# One build serves every platform only while it is pure JavaScript.
native=$(find "$root/.output" -name '*.node' | head -n 1)
[ -z "$native" ] || fail "the build has a native module ($native), so it can't be shared across platforms"

version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$root/package.json")
[ -n "$version" ] || fail "can't read the version from package.json"

mkdir -p "$cache" "$dist"
if [ -z "${NODE_VERSION:-}" ]; then
  major=$(sed -n 's/^    "node": ">=\([0-9]*\)".*$/\1/p' "$root/package.json")
  [ -n "$major" ] || fail "can't read the Node major version from package.json's engines field"
  curl -fsSL "https://nodejs.org/dist/latest-v$major.x/SHASUMS256.txt" -o "$cache/latest-v$major.txt"
  NODE_VERSION=$(sed -n 's/.*node-v\([0-9.]*\)-linux-x64\.tar\.gz$/\1/p' "$cache/latest-v$major.txt")
  [ -n "$NODE_VERSION" ] || fail "can't find the newest Node $major release"
fi
NODE_VERSION=${NODE_VERSION#v}

shasums="$cache/node-v$NODE_VERSION-SHASUMS256.txt"
[ -s "$shasums" ] || curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$shasums"

platforms=${*:-$ALL_PLATFORMS}
work=$(mktemp -d "${TMPDIR:-/tmp}/florin-package.XXXXXX")
trap 'rm -rf "$work"' EXIT

echo "Packaging florin $version with Node $NODE_VERSION"
for platform in $platforms; do
  case " $ALL_PLATFORMS " in
    *" $platform "*) ;;
    *) fail "unknown platform $platform (one of: $ALL_PLATFORMS)" ;;
  esac

  node_name="node-v$NODE_VERSION-$platform"
  node_tar="$cache/$node_name.tar.gz"
  expected=$(awk -v f="$node_name.tar.gz" '$2 == f { print $1 }' "$shasums")
  [ -n "$expected" ] || fail "nodejs.org lists no $node_name.tar.gz"
  if [ ! -f "$node_tar" ] || [ "$(sha256 "$node_tar")" != "$expected" ]; then
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$node_name.tar.gz" -o "$node_tar.part"
    mv "$node_tar.part" "$node_tar"
  fi
  actual=$(sha256 "$node_tar")
  [ "$actual" = "$expected" ] || fail "$node_name.tar.gz has checksum $actual, but nodejs.org lists $expected"

  name="florin-$version-$platform"
  dir="$work/$name"
  mkdir -p "$dir/bin" "$dir/node/bin" "$dir/app"
  tar -xzf "$node_tar" -C "$work" "$node_name/bin/node" "$node_name/LICENSE"
  mv "$work/$node_name/bin/node" "$dir/node/bin/node"
  mv "$work/$node_name/LICENSE" "$dir/node/LICENSE"
  rm -rf "${work:?}/$node_name"
  cp -R "$root/.output/." "$dir/app/"
  cp "$root/scripts/launcher.sh" "$dir/bin/florin"
  chmod 755 "$dir/bin/florin" "$dir/node/bin/node"
  cp "$root/LICENSE" "$root/README.md" "$dir/"
  printf '%s\n' "$version" >"$dir/VERSION"

  tar -czf "$dist/$name.tar.gz" -C "$work" "$name"
  rm -rf "$dir"
  echo "  dist/$name.tar.gz"
done

# checksums.txt covers every tarball of this version in dist/, so packaging
# one platform at a time still ends with a complete list.
(
  cd "$dist"
  for file in florin-"$version"-*.tar.gz; do
    printf '%s  %s\n' "$(sha256 "$file")" "$file"
  done
) >"$dist/checksums.txt"
echo "  dist/checksums.txt"

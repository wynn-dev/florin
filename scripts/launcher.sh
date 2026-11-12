#!/bin/sh
# florin's launcher, bin/florin in a release tarball: runs the Node bundled
# beside it on the app, wherever the launcher is linked from.
self=$0
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case $link in
    /*) self=$link ;;
    *) self=$(dirname "$self")/$link ;;
  esac
done
root=$(cd "$(dirname "$self")/.." && pwd -P) || exit 1
exec "$root/node/bin/node" "$root/app/cli.mjs" "$@"

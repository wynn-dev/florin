#!/bin/sh
# Installs the linux-x64 tarball in dist/ the way a person would, piping
# install.sh to sh inside a clean Debian container that has no Node, then
# checks the florin it installed runs. Needs Docker; run scripts/package.sh
# linux-x64 first.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$root/dist/checksums.txt" ] || {
  echo "test-install: no dist/checksums.txt; run scripts/package.sh linux-x64 first" >&2
  exit 1
}

docker run --rm \
  -v "$root/dist:/release:ro" \
  -v "$root/install.sh:/install.sh:ro" \
  debian:stable-slim sh -euc '
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends curl ca-certificates >/dev/null
    if command -v node; then echo "the image has Node; the test needs one without" >&2; exit 1; fi

    useradd -m ana
    su ana -c "
      set -eu
      cd
      curl -fsSL file:///install.sh | FLORIN_DOWNLOAD_URL=file:///release sh
      export PATH=\$HOME/.local/bin:\$PATH
      florin version
      FLORIN_PORT=4699 florin start >start.log 2>&1 &
      pid=\$!
      for i in \$(seq 1 40); do
        curl -sf http://127.0.0.1:4699/api/session && break
        sleep 0.25
      done
      echo
      curl -sf http://127.0.0.1:4699/api/session >/dev/null || { cat start.log; exit 1; }
      kill \$pid

      # Without systemd, the service commands explain themselves.
      if florin service status 2>err.log; then echo \"florin service status should fail here\" >&2; exit 1; fi
      grep -q \"systemd\" err.log
      cat err.log

      # Running it again updates in place.
      curl -fsSL file:///install.sh | FLORIN_DOWNLOAD_URL=file:///release sh
      florin version
    "
  '
echo "install.sh installed a working florin in a clean container"

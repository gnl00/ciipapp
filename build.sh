#!/bin/sh
set -eu
cd "$(dirname "$0")"
target_arch=${CIIP_ARCH:-$(go env GOARCH)}
case "$target_arch" in
  arm64|amd64) ;;
  x86_64) target_arch=amd64 ;;
  *) echo "Unsupported CIIP_ARCH: $target_arch (use arm64 or amd64)" >&2; exit 1 ;;
esac
# Build TypeScript first so Go embeds the current production assets.
npm run build:app
CGO_ENABLED=1 go run github.com/egoist/mygo/cmd/mygo build -platform "darwin/$target_arch" -skip-dmg -skip-notarize "$@"

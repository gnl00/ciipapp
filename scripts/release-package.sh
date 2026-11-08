#!/bin/sh
# Package an already-built native bundle without opening Finder or the app.
set -eu
cd "$(dirname "$0")/.."

check_host() {
  case "$1" in
    arm64) expected_cpu=arm64 ;;
    amd64) expected_cpu=x86_64 ;;
    *) echo 'Release architecture must be arm64 or amd64.' >&2; exit 1 ;;
  esac
  if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != "$expected_cpu" ] ||
     [ "$(go env GOHOSTARCH)" != "$1" ] || [ "$(go env GOARCH)" != "$1" ]; then
    echo "A native macOS $expected_cpu host and matching Go toolchain are required." >&2
    exit 1
  fi
}

if [ "${1:-}" = --check-host ]; then
  [ "$#" -eq 2 ] || exit 1
  check_host "$2"
  exit 0
fi
[ "$#" -eq 2 ] || { echo 'Usage: sh scripts/release-package.sh vX.Y.Z arm64|amd64' >&2; exit 1; }
release_tag=$1
release_arch=$2
check_host "$release_arch"
node scripts/release.mjs validate "$release_tag"

bundle="build/darwin-$release_arch/ciip.app"
plist="$bundle/Contents/Info.plist"
release_version=${release_tag#v}
for version_key in CFBundleShortVersionString CFBundleVersion; do
  actual_version=$(/usr/libexec/PlistBuddy -c "Print :$version_key" "$plist")
  [ "$actual_version" = "$release_version" ] || { echo "$version_key does not match $release_tag" >&2; exit 1; }
done
executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")
actual_cpu=$(lipo -archs "$bundle/Contents/MacOS/$executable")
[ "$actual_cpu" = "$expected_cpu" ] || { echo "Unexpected bundle CPU: $actual_cpu" >&2; exit 1; }
codesign --verify --deep --strict --verbose=2 "$bundle"

output=build/release-assets
mkdir -p "$output"
asset_base="ciip-$release_tag-macos-$expected_cpu"
zip_path="$output/$asset_base.zip"
dmg_path="$output/$asset_base.dmg"
rm -f "$zip_path" "$dmg_path"
ditto -c -k --sequesterRsrc --keepParent "$bundle" "$zip_path"

dmg_stage=$(mktemp -d "${TMPDIR:-/tmp}/ciip-release.XXXXXX")
trap 'rm -rf "$dmg_stage"' EXIT HUP INT TERM
ditto "$bundle" "$dmg_stage/ciip.app"
ln -s /Applications "$dmg_stage/Applications"
hdiutil create -volname "ciip $release_version" -srcfolder "$dmg_stage" -format UDZO -ov "$dmg_path"
hdiutil verify "$dmg_path"
echo "Packaged $asset_base (ad hoc signature; not notarized)."

#!/usr/bin/env bash
#
# Regenerates the Apple project from scratch.
#
# `safari-web-extension-converter` is Apple's own scaffolder and the only
# supported way to produce a Safari web-extension project. It is also
# destructive: it overwrites the two Swift files this repository has replaced.
# So the sources we own are set aside, the scaffold is regenerated, they are put
# back, and `xcode-wire.py` reattaches everything the converter knows nothing
# about.
#
# Run this after changing the extension manifest, or to recover a project that
# has been edited into a state nobody can explain.
#
#     ./scripts/xcode-bootstrap.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT="apple/GlassFrog Clipper"
STASH="$(mktemp -d)"

# The web bundle has to exist first: the converter copies it into the project.
npm run build:safari

# Everything below is ours, not the converter's.
for path in \
  "Shared (Extension)/SafariWebExtensionHandler.swift" \
  "Shared (App)/ViewController.swift" \
  "Shared (App)/SettingsModel.swift" \
  "Shared (App)/SettingsView.swift"
do
  if [ -f "$PROJECT/$path" ]; then
    mkdir -p "$STASH/$(dirname "$path")"
    cp "$PROJECT/$path" "$STASH/$path"
  fi
done
for dir in "Shared (Share)" "iOS (Share)" "macOS (Share)" "Entitlements"; do
  [ -d "$PROJECT/$dir" ] && cp -R "$PROJECT/$dir" "$STASH/"
done

rm -rf "$PROJECT"

xcrun safari-web-extension-converter dist-safari \
  --project-location apple \
  --app-name "GlassFrog Clipper" \
  --bundle-identifier com.integralproductivity.GlassFrogClipper \
  --swift --copy-resources --no-open --no-prompt --force

cp -R "$STASH/." "$PROJECT/"
rm -rf "$STASH"

python3 scripts/xcode-wire.py
# Order matters: the share targets reuse the core file references that
# xcode-wire.py declares, so adding them first would declare the same file twice.
python3 scripts/xcode-add-share.py
python3 scripts/xcode-entitlements.py
# Last: replaces the converter's static copy of the web bundle with a build
# phase that produces it, so nothing generated ends up in version control.
python3 scripts/xcode-resource-phase.py
plutil -lint "$PROJECT/GlassFrog Clipper.xcodeproj/project.pbxproj"

#!/usr/bin/env bash
#
# Compiles every Apple target, and runs the Swift core's own tests.
#
# Code signing is disabled throughout. This proves the code *compiles and
# links* on both platforms; it cannot prove the app runs, because App Groups
# and a shared Keychain both require a real team identifier. See apple/README.md
# for what still needs a signed build, and what it will fail with until then.
#
# The core tests are the important half. They include the cross-language compose
# contract — the one place where a silent divergence would orphan every capture
# filed from the share sheet.
#
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT="apple/GlassFrog Clipper/GlassFrog Clipper.xcodeproj"
FLAGS=(-configuration Debug ARCHS=arm64 ONLY_ACTIVE_ARCH=NO
       CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="")

echo "==> Swift core tests"
swift test --package-path apple/GlassFrogClipperCore

failed=0
build() {
  local target="$1"; shift
  printf '==> %-45s' "$target"
  if xcodebuild build -project "$PROJECT" -target "$target" "${FLAGS[@]}" "$@" > "/tmp/gfc-$(echo "$target" | tr ' ()' '___').log" 2>&1; then
    echo "ok"
  else
    echo "FAILED"
    grep -E 'error:' "/tmp/gfc-$(echo "$target" | tr ' ()' '___').log" | head -5 || true
    failed=1
  fi
}

# The apps are built last: each embeds both of its extensions, so building an
# app builds everything it ships with, and a failure there is a packaging
# failure rather than a compile one.
build "GlassFrog Clipper Extension (macOS)"
build "GlassFrog Clipper Share Extension (macOS)"
build "GlassFrog Clipper (macOS)"
build "GlassFrog Clipper Extension (iOS)"       -sdk iphonesimulator
build "GlassFrog Clipper Share Extension (iOS)" -sdk iphonesimulator
build "GlassFrog Clipper (iOS)"                 -sdk iphonesimulator

exit $failed

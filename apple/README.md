# GlassFrog Clipper for Apple platforms

A Safari web extension, a container app for iOS/iPadOS/macOS, and a Share
Extension — sharing the capture path in [`../src`](../src) rather than
re-deriving it. See
[ADR 0008](../docs/adr/0008-the-apple-build-shares-this-repo-and-this-capture-path.md)
for why this lives in the same repository as the Chrome extension.

## What is here

| Path | What it is |
|---|---|
| `GlassFrogClipperCore/` | The Swift capture logic, as a local package. Foundation only — no UIKit, no AppKit, no SafariServices — so the same code serves the app, both extensions, and `swift test`. |
| `GlassFrog Clipper/Shared (App)/` | The SwiftUI settings screen. |
| `GlassFrog Clipper/Shared (Extension)/` | The native bridge the Safari extension talks to. |
| `GlassFrog Clipper/Shared (Share)/` | The share-sheet capture form. |
| `GlassFrog Clipper/Entitlements/` | App Group and Keychain access, per platform. |
| `GlassFrog Clipper/Configurations/` | Signing. `Signing.xcconfig` is attached to the project; the team identifier goes in a gitignored `Local.xcconfig` beside it. |

The core is **compiled into** each target rather than linked as a package
product. `GlassFrogClipperCore` remains its canonical home and is what
`swift test` runs; see the note at the top of
[`../scripts/xcode-wire.py`](../scripts/xcode-wire.py) for why linking it was
not worth the pbxproj state it needs.

## Build and verify

```bash
./scripts/verify-apple.sh
```

Runs the Swift core tests and compiles all six targets with signing disabled.
This proves the code compiles and links; it cannot prove the app runs — see
below.

To regenerate the Xcode project from scratch:

```bash
./scripts/xcode-bootstrap.sh
```

`safari-web-extension-converter` is Apple's own scaffolder and the only
supported way to produce a Safari web-extension project. It is also destructive:
the bootstrap script sets aside the sources this repository owns, regenerates,
puts them back, and reattaches everything the converter knows nothing about.

**The web extension bundle is not in version control.** The converter snapshots
it into the project, which for a hand-written extension is right — the copy is
the source. Here it is compiled from TypeScript, so a committed copy would be
12,000 lines of build output that churns on every source change and can go stale
without anyone noticing: a stale bundle still builds, the extension still loads,
and it runs last month's capture path. A Run Script phase on each extension
target builds and syncs it instead, so opening the project in Xcode and hitting
Build is enough — provided `npm install` has been run.

That phase has `ENABLE_USER_SCRIPT_SANDBOXING = NO`, scoped to those two targets.
It runs `npm`, which touches `node_modules` and its caches — paths a build phase
cannot declare, and which the sandbox therefore denies.

## Before this can actually run

Everything below needs an Apple Developer team, and none of it can be done from
a build with signing disabled. **Until these are set, the code compiles and the
app launches, but capture will not work end to end.**

1. **Set a Development Team.** Copy the example and fill in the ten-character
   identifier from developer.apple.com/account -> Membership details:

   ```bash
   cp "apple/GlassFrog Clipper/Configurations/Local.xcconfig.example" \
      "apple/GlassFrog Clipper/Configurations/Local.xcconfig"
   ```

   `Local.xcconfig` is gitignored, and `Signing.xcconfig` includes it optionally,
   so a machine without one builds unsigned exactly as before — which is what
   `verify-apple.sh` and CI rely on.

   Set here rather than in Xcode's target editor because this project is
   generated: `xcode-bootstrap.sh` deletes and rebuilds it, and a value typed
   into the editor is lost the next time anyone regenerates. `xcode-team.py` is
   wired into that chain to reattach the xcconfig, the way
   `xcode-entitlements.py` reattaches the entitlements. One value at the project
   level is inherited by all six targets.

   `test/xcode-signing.test.ts` holds that arrangement in place: it asserts the
   bootstrap still runs the generator in the right order and still stashes
   `Configurations/`, that both project-level configurations point at
   `Signing.xcconfig`, that no target shadows the inherited team, and that the
   include stays optional. A full regeneration has **not** been run end to end —
   that needs a Mac with `safari-web-extension-converter` and rewrites every
   UUID in the project — so the chain is verified by assertion, not by
   observation. Run `./scripts/xcode-bootstrap.sh` once when convenient and
   confirm the test still passes afterwards.

2. **Register the App Group** `group.com.integralproductivity.GlassFrogClipper`
   on the developer portal, and enable it for all six targets.

   Six targets, but three App IDs: iOS and macOS share a bundle identifier for
   each of the app (`com.integralproductivity.GlassFrogClipper`), the Safari
   extension (`.Extension`) and the Share Extension (`.Share`). Each of the three
   needs App Groups *and* Keychain Sharing enabled.

   Without it, `UserDefaults(suiteName:)` returns nil and `ConfigurationStore`
   falls back to `.standard`. The app then works standalone and the Share
   Extension sees no configuration at all — the settings screen says so rather
   than leaving it to be discovered from the share sheet.

3. **Register the Keychain access group.** The entitlements name
   `$(AppIdentifierPrefix)com.integralproductivity.GlassFrogClipper`, which is
   inert until there is a team identifier to resolve.

   Without it, the API key is private to whichever process wrote it. The app can
   save a key that the Share Extension then cannot read, which presents as
   "not set up yet" in the share sheet immediately after configuring the app.

4. **Allow notifications** in the app, once. Safari extensions cannot raise
   notifications themselves, so the app raises them on the extension's behalf.
   Declining is a supported state, not a broken one: the notice falls through to
   storage and appears the next time the popup or options page is opened.

## The three platform differences

Not preferences — they are what Safari does and does not implement.

**No `chrome.notifications`.** [`../src/notify.ts`](../src/notify.ts) is a chain:
system notification, then this app over native messaging, then storage. The
floor matters more than the top — a background capture that failed with nowhere
to report it is the worst case, where the practitioner believes an item was
filed and it was not.

**Sandboxed extension storage.** The app cannot read the extension's
`chrome.storage.local`, and vice versa.
[`../src/bridge.ts`](../src/bridge.ts) syncs configuration one way at
configuration time in both directions, and never on the capture path.

**No extension shortcuts on iOS or iPadOS.** R22's unbound-shortcut notice is
suppressed where `chrome.commands` could only ever report nothing. On iPhone and
iPad the share sheet is the *primary* capture path, not a secondary one.

## Changing `compose()`

`compose()` exists in TypeScript and again in Swift, because the Share Extension
files natively and never runs the web extension. If you change either one:

```bash
node scripts/generate-compose-fixtures.mjs   # regenerate the golden file
npm test                                     # TypeScript side
swift test --package-path apple/GlassFrogClipperCore   # Swift side
```

The fixture is the contract. Its most important case is a title made of
family emoji: Swift's `String` counts grapheme clusters where JavaScript's
`Array.from` counts Unicode scalars — 47 against 200 for the same title. A Swift
port written with `String.prefix()` passes every ASCII case and silently orphans
every share-sheet capture from the triage-survival metric.

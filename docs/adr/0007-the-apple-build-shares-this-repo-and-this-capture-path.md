# 7. The Apple build shares this repo, and this capture path

Date: 2026-08-31

## Status

Accepted

Builds on [2. GlassFrog authentication and write path for the browser extension](0002-glassfrog-authentication-and-write-path-for-the-browser-extension.md),
[3. GlassFrog v5 has no role-less write path](0003-glassfrog-v5-has-no-role-less-write-path.md),
and [4. Provenance marker rides in the tension body](0004-provenance-marker-rides-in-the-tension-body.md).

## Context

GlassFrog Clipper needs a Safari extension and iOS/iPadOS/macOS apps with the
same capture behaviour as the Chrome extension. Two questions had to be settled
before any of it could be built: **where the code lives**, and **how much of the
existing capture path it can actually reuse.**

### What is genuinely shared

The capture path is 1,652 lines of framework-free TypeScript, and its coupling
to Chrome is shallower than the name `-chrome-extension` suggests. `compose.ts`,
`errors.ts`, `messages.ts`, `types.ts` and `config.ts` touch no browser API at
all. Safari implements the same `chrome.*` namespace, so the compiled JavaScript
is byte-identical across both browsers.

Three things in that shared code are **contracts, not implementation**:

- `PROVENANCE_MARKER`, which ADR 0004 makes the basis of the triage-survival
  metric. An item filed with a marker one character adrift is invisible to that
  metric while looking entirely ordinary in GlassFrog.
- The four-way failure taxonomy of KTD9, which decides whether a practitioner is
  told to retry or to go and fix something.
- The at-most-once ordering of KTD7, which exists because v5 has no idempotency
  key.

### What cannot be shared

The Share Extension is the exception, and it is not a small one. It is handed a
URL by the share sheet in a Swift process with no JavaScript runtime, and it is
*on the capture path* — standing up a runtime to reuse `compose()` would be
latency spent on exactly the thing STRATEGY.md protects. So `compose()` has to
exist twice.

### Three platform gaps, not preferences

- **Safari implements no `chrome.notifications`.** KTD2 routes every failure and
  lifecycle notice through it. On Safari that surface is absent, not different.
- **Safari sandboxes the extension's storage away from its own app.** The
  containing app and the Share Extension cannot read `chrome.storage.local`, so
  a practitioner who configured "the clipper" once has configured it once.
- **Safari on iOS and iPadOS has no extension shortcuts.** R22's unbound-shortcut
  check reports nothing there whether or not anything is wrong.

## Decision

**One repository.** The Apple build lives here, alongside the Chrome extension,
sharing `src/` rather than consuming a published copy of it. The repository is
renamed from `glassfrog-clipper-chrome-extension` to `glassfrog-clipper`; the
npm package was already named that.

**Capabilities are detected at runtime, never at build time.** `src/platform.ts`
asks whether a method exists rather than which browser this is, so a capability
Safari ships later starts working with no code change and no stale
`=== 'safari'` left behind to find. One `tsup` run produces both bundles; only
the manifest differs, and it differs as an overlay so the shared keys cannot
drift.

**The duplicated `compose()` is contained by a golden file, not by care.**
`test/fixtures/compose-cases.json` is generated from the TypeScript
implementation and asserted independently by both suites.

## Consequences

### What this buys

The three contracts above have exactly one definition each. Two repositories
would have meant either duplicating them — with the marker drifting silently,
which is the one failure mode ADR 0004 was written to prevent — or publishing a
fifth internal package to consume them, for roughly 600 lines of pure
TypeScript.

STRATEGY.md already scopes this work in-product: the Capture surface track names
"a mobile share-sheet companion" as on-strategy and sequenced later. This is that
item, not a second product. ADRs 0002, 0003 and 0004 are platform-agnostic and
keep governing both builds; splitting would have made every one of them a
cross-repository reference, which does not auto-close and has to be reconciled by
hand.

### What it costs

Xcode signing and macOS runners are a different CI toolchain from the existing
`ubuntu-latest` Node job. That is paid with a second, path-filtered job rather
than a second repository.

The golden file is the load-bearing part of the compose decision, and its value
is concentrated in one case. Swift's `String` counts grapheme clusters where
JavaScript's `Array.from` counts Unicode scalars — 47 against 200 for the same
family-emoji title. A Swift port written with `String.prefix()` passes every
ASCII case and silently orphans every share-sheet capture from the
triage-survival metric. **Changing `compose()` on either side now means
regenerating that fixture and making both suites pass.**

### What is deliberately not solved here

The configuration sync between the extension and the app is one-way, at
configuration time, in both directions — never a read-through on the capture
path. A capture that had to wake the containing app to learn its own role id
would pay a process launch on the one path the strategy protects, and would fail
outright whenever the app was unavailable. Two stores that agree beats one store
that is slow. The cost is a window in which they can disagree; the app's copy is
treated as a mirror and never overwrites a configured extension.

`nativeMessaging` is a new permission, and it appears only in the Safari
manifest. The Chrome permission list is unchanged, so the Definition of Done's
stop condition on it still holds; `test/safari-manifest.test.ts` puts the same
discipline on the Safari list, including a check that the permission has a caller.

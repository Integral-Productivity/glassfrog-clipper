# Verifying the extension in a real browser

The Verification Contract's manual gates cannot be met by the test suite, and the
reason is worth stating plainly: the capture path is deliberately tested through
the `CaptureWriter` port against a fake. That is what makes it testable, and it
is also what makes it possible to be confidently wrong about the thing on the
other side of the port.

Two defects reached `main`-ready state invisible to 100+ passing tests, and both
were found here:

- the v5 API rejects `label` on tension create, so R11's provenance marker would
  have been lost on every capture;
- the SDK invokes `fetch` unbound, which browsers reject with `Illegal
  invocation`, so **every** request failed and reported itself as "you are
  offline".

Neither is reachable from Node. Run these gates before shipping a change to the
write path.

## Loading the extension

Chrome 137+ removed `--load-extension`, and the
`DisableLoadExtensionCommandLineSwitch` feature flag no longer overrides it — a
current Chrome silently installs nothing and renders the extension URL as
"is blocked". Use **Chrome for Testing**, which Playwright already vendors:

```bash
npm run build
BIN="$HOME/Library/Caches/ms-playwright/chromium-"*"/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
"$BIN" --user-data-dir=/tmp/clipper-profile \
       --load-extension="$PWD/dist" --disable-extensions-except="$PWD/dist" \
       --headless=new --remote-debugging-port=9333 about:blank
```

The extension id is derived from the absolute path of `dist`: SHA-256 of the
path, first 16 bytes, each nibble mapped onto `a`–`p`.

A service worker is lazy — it will not appear in `/json/list` until an event
wakes it. Opening the options page and sending it a message is enough.

## What to check

| Gate | How |
|---|---|
| Worker registers | a `service_worker` target exists for the extension id, and `Runtime`/`Log` report no exceptions |
| Shortcuts bound (R22) | `chrome.commands.getAll()` shows both `quick-capture` and `_execute_action` with non-empty shortcuts |
| Permissions (DoD) | `chrome.permissions.getAll()` matches the manifest exactly, and `contains({origins:['https://api.glassfrog.com/*']})` is true (A3) |
| Unreadable tab (OQ7) | on a `chrome://` tab, `tabs.query` returns `url: null`, so the guard surfaces "Cannot capture this page" |
| Held capture (R9/R15) | two captures while unconfigured leave exactly one `clipper.pendingCapture`, and the replacement is surfaced |

## The write path

Point the extension at the real host with a **deliberately fake key** — a 401 is
the expected answer, so no credential is involved. Enable the `Fetch` domain on
the *service worker* target and watch what leaves:

```
POST https://api.glassfrog.com/api/v5/roles/{role}/tensions
{"tension":{"body":"[glassfrog-clipper] <title>\n\n<url>\n\n<selection>"}}
```

Assert the marker leads the body, and that the payload carries **no `label` and
no `status`** — the API rejects the first on create and derives the second.
Exactly one request must appear: KTD7 sets `maxRetries: 0`.

To exercise the **success** path without a real key, intercept with
`Fetch.requestPaused` and `Fetch.fulfillRequest` a `201` carrying
`{"data":{...}}`. Everything up to the response is the extension's own code
running for real. Then assert:

- the outcome is `{status:'filed', itemId}`
- the badge reads `✓` and a `clipper/clear-badge` alarm is scheduled (KTD2, R14)
- no in-flight marker remains — it is cleared only after the 201 (KTD7)
- the pending slot is empty (R16)
- no notification was raised; success is badge-only (KTD2)

## First-install checklist — the one gate this cannot replace

Everything above can be run without a credential. This cannot, and it is the
last open row in
[the verification record](plans/2026-08-28-capture-path-verification-record.md).

**Run on 2026-08-30, and the record's row is now Pass.** Keep this checklist:
it is the right sequence for anyone installing the extension on a new machine or
against a different organisation, and the run that first exercised it found two
defects no automated gate could reach.

- [ ] `chrome://extensions` → Developer mode → **Load unpacked** → the built
      `dist/`. The extension id is derived from that path, so pick a location
      you intend to keep.
- [ ] Options page → paste a GlassFrog v5 API key → **Save**. The role picker
      should populate from your own roles. A key GlassFrog refuses must say
      *"That key wasn't accepted"* and leave the picker empty (R21).
- [ ] Choose a capture role → **Save**.
- [ ] On an ordinary web page, press the quick-capture shortcut. The badge
      should show `✓` without focus leaving the tab (R14), and no notification
      should appear — success is badge-only (KTD2).
- [ ] In GlassFrog, confirm the tension carries the `[glassfrog-clipper]`
      marker, the page URL and title, and reports `unprocessed` (R7, R11, KD2).
- [ ] Select text on a page and capture again; confirm the selection rides along
      (AE2).
- [ ] Update the `Not run` row in the verification record with the tension id.

If the shortcut does nothing, check `chrome://extensions/shortcuts` — Chrome
drops a suggested binding silently when another extension already holds it, and
R22 should have raised a notification at startup. If it did not, that is itself
a defect worth filing.

### Why it is worth running even though both halves are verified

- **What the extension sends** was proven in Chrome against the real
  `api.glassfrog.com`: one request, marker leading the body, no `label` or
  `status`, and a 401 from a deliberately fake key classified as
  `unusable-role` with the capture preserved.
- **What GlassFrog accepts** was proven by filing the payload `compose()`
  produces against the live API, reading it back, and deleting it.

Those are two verified halves, not a verified whole. The defects this project
actually hit — a rejected `label` field, and a `fetch` that threw only in
browsers — both lived precisely in the seams between layers that each looked
correct on their own.

## Gate run — 2026-09-01, the Safari/Apple branch

Run against `dist/` built from `claude/safari-extension-apple-apps-13cfca`, in
Chrome for Testing 151 headless over CDP. The branch changes five files the
Chrome path already runs, so the gates were re-run rather than assumed.

**Capability detection, which had only ever been exercised against a fake:**

| Observed | Consequence |
|---|---|
| `chrome.runtime.getURL('')` → `chrome-extension://…` | `browserKind()` reports `chrome`, not `unknown` |
| `chrome.notifications.create` is a function | the notice chain takes its first branch |
| `chrome.runtime.sendNativeMessage` is **undefined** | without the `nativeMessaging` permission the method is absent, so `hasNativeMessaging()` is false and the whole containing-app bridge is inert on Chrome |

That last row is the one worth recording. `src/bridge.ts` and the second link of
`src/notify.ts`'s chain both call `sendNative`, and the test suite can only show
they behave correctly against a fake that omits the method. Chrome genuinely
omits it.

**Write path** — fake key, request intercepted, a `201` fulfilled so the success
path runs for real. All twelve assertions held:

```
POST https://api.glassfrog.com/api/v5/roles/{role}/tensions
{"tension":{"body":"[glassfrog-clipper] Write path gate\n\nhttps://example.org/gate\n\na selected passage"}}
```

Marker leads the body; no `label`; no `status`; exactly one request; outcome
`{status:'filed', itemId}`; in-flight marker cleared only after the 201; pending
slot empty; badge `✓`; **no notice stored** — success remains badge-only, so the
new `clipper.lastNotice` slot does not accumulate on the happy path.

**Failure path** — a `401`, which is R18's reconfigure case. All nine held:
classified `unusable-role` with `reconfigure: true` and `mayHaveFiled: false`;
exactly one request; the capture preserved in the pending slot (R10); the
in-flight marker settled so startup will not claim it may have filed; the API key
absent from both the surfaced message and the stored notice (R12); and the notice
recorded as `deliveredBy: "notifications"` — Chrome takes the system-notification
branch and never reaches the stored floor.

**One defect found.** `npm run build` copies the whole of `public/` into `dist/`,
so the Safari manifest overlay was shipping inside the Chrome bundle. Chrome
ignores files the manifest does not name, so nothing broke — but the packaged
extension carried a manifest describing a different platform.
`scripts/build-safari.mjs` already removed it from the Safari bundle for the same
reason; the Chrome half was missing. Fixed, and `scripts/check-bundle.mjs` now
fails on it.

_Still not covered here: a capture against a live organisation with a real key.
That is the first-install checklist above, and on Safari it is
[#64](https://github.com/Integral-Productivity/glassfrog-clipper/issues/64)._

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

## The one gate this cannot replace

Filing against live GlassFrog with a valid key. The two halves are verifiable
separately — that the extension sends exactly this payload to exactly this
endpoint, and that GlassFrog accepts exactly this payload and reports the result
`unprocessed` — but their composition needs a real credential and a person to
enter it.

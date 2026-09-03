# Privacy policy — GlassFrog Clipper

_Last updated: 2026-09-02. Applies to the GlassFrog Clipper browser extension for
Chrome and Safari, published by Integral Productivity LLC._

GlassFrog Clipper files the page you are on into your own GlassFrog
organisation. It has no backend. There is no Integral Productivity server
involved in a capture, and no account with us to create.

The short version: the extension talks to exactly one host, `api.glassfrog.com`,
and it talks to it as **you**, with **your** GlassFrog API key. Everything else
it knows stays in your browser.

## What the extension stores, and where

All of it lives in `chrome.storage.local` on the device where you installed the
extension. None of it is synced across your devices, and none of it is
transmitted to Integral Productivity.

| Stored | Why |
|---|---|
| Your GlassFrog API key | Authenticates the write to GlassFrog. Sent only to `api.glassfrog.com`. |
| Your chosen capture role | The role a keystroke capture files against, so capture needs no decision. |
| A cached list of your GlassFrog roles | Populates the role picker without a round trip on every capture. |
| Your default item status | `current` or `someday`, applied to captures you do not classify. |
| A pending capture | A capture made before the extension was configured, held so it is not lost. Expires after 7 days. |
| A popup draft | What you typed in the popup, so closing it accidentally does not discard the thought. |
| In-flight markers and the last notice | Lets the extension tell you whether a capture succeeded. |
| A local telemetry log | Timings and outcomes only — see below. |

Storage keys are enumerated in [`src/storage.ts`](src/storage.ts).

## What leaves your device

**Only captures, and only to GlassFrog.** When you file an item, the extension
sends an HTTPS request to `https://api.glassfrog.com/api/v5/...` containing:

- the **title** of the page you captured;
- the **URL** of the page you captured;
- the **text you had selected**, if any;
- any **note, role, and work type** you set;
- your **GlassFrog API key**, in an `X-Auth-Token` header.

That is the whole payload. It is composed in [`src/compose.ts`](src/compose.ts).

Two consequences worth stating plainly rather than leaving you to infer:

- **The URL is transmitted in full, including its query string — with one
  exception.** Any credentials embedded in the URL's `userinfo` component (the
  `user:password@` that sometimes appears just before the hostname) are stripped
  before the capture is stored or sent. Everything else is carried exactly as
  you saw it, so if you capture a page whose URL holds a session token in its
  query string or fragment, that token goes into GlassFrog along with everything
  else. Where it lands is your own GlassFrog organisation, visible to whoever
  your organisation's settings make it visible to. This is deliberate: deciding
  which query parameters are secret means guessing, and a wrong guess would
  quietly destroy the evidence you clipped the page for.
- **A popup draft persists until you file or clear it.** If you open the popup
  on a sensitive page and close it without filing, the page's content stays in
  local storage until the next capture replaces it. Tracked as
  [issue #7](https://github.com/Integral-Productivity/glassfrog-clipper-chrome-extension/issues/7).

The extension reads a page only at the moment you invoke it, on the tab you
invoked it from. It does not run on pages in the background, does not observe
your browsing, and has no permission to reach any host other than
`api.glassfrog.com`.

## Telemetry

The extension records how long captures take and whether they succeed, so the
thresholds in [STRATEGY.md](STRATEGY.md) can be judged against reality.

**This log never leaves your device on its own.** It is written to
`chrome.storage.local` and there is no code path in the extension that transmits
it. The only way it goes anywhere is a **Copy** button on the options page, which
puts it on your clipboard for you to do as you like with. A **Clear** button
deletes it.

A telemetry record carries a capture id, a path (`keystroke` or `popup`),
timestamps, a duration, an outcome, and two booleans for whether role and work
type were set. It carries **no** URL, page title, selection text, or API key.
That is enforced three ways — an allowlist at the write boundary, a shape with
nowhere to put text, and a test that files a capture full of sentinel strings and
asserts none reaches the serialised log. See
[`src/telemetry.ts`](src/telemetry.ts) and
[ADR 0007](docs/adr/0007-telemetry-is-local-only-and-allowlisted-at-the-write-boundary.md).

## What we do not do

- We do not operate a server that the extension contacts. There is none.
- We do not collect, receive, or store your data. We cannot: nothing is sent to
  us.
- We do not sell or transfer your data to third parties.
- We do not use your data for advertising, credit assessment, or lending.
- We do not use your data to train models.
- There are no analytics SDKs, no trackers, and no remote code. The extension
  ships as the code you can read in this repository.

Your data does go to **GlassFrog**, because sending it there is the entire point
of the extension. GlassFrog is operated by HolacracyOne and governed by
[their privacy policy](https://www.glassfrog.com/privacy), not by this one.

## Permissions, and why each one exists

| Permission | Why |
|---|---|
| `activeTab` | Read the title, URL, and selection of the tab you invoked the extension on — only at that moment. |
| `scripting` | Run the small function that reads your selection on that tab. |
| `storage` | Keep your API key, capture role, and held captures locally. |
| `notifications` | Tell you a capture succeeded or failed when no popup is open to say so. |
| `alarms` | Expire a held capture after 7 days rather than keeping it indefinitely. |
| `https://api.glassfrog.com/*` | The one host the extension talks to. |

The list is a stop condition, not a default: adding to it is guarded by
[`fitness/checks/manifest-permissions.ts`](fitness/checks/manifest-permissions.ts),
which fails the build if the set changes.

## Deleting your data

Uninstalling the extension removes everything it stored. You can also clear the
telemetry log at any time from the options page, and replacing your API key there
overwrites the stored one.

Because nothing is transmitted to us, there is no account to close and no
deletion request to file.

## Children

The extension is a tool for people using GlassFrog at work. It is not directed at
children and collects nothing from anyone.

## Changes

Material changes to this policy will be recorded in this file's history in the
repository, and the "Last updated" date above will change. The published version
is whichever commit is current on `main`.

## Contact

Open an issue at
<https://github.com/Integral-Productivity/glassfrog-clipper-chrome-extension/issues>,
or email <kraigparkinson@integralproductivity.com>.

Integral Productivity LLC

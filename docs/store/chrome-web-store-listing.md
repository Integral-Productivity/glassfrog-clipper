# Chrome Web Store submission dossier

Everything the Web Store dashboard asks for, written down so a submission is a
paste job rather than a drafting session, and so the answers we gave are
reviewable in a pull request rather than living only in a Google form.

This exists for the same reason [`docs/verifying-in-chrome.md`](../verifying-in-chrome.md)
exists: the parts of shipping that the test suite cannot reach still need to be
written down, or they get improvised differently every time.

**Tracking:** [#101](https://github.com/Integral-Productivity/glassfrog-clipper/issues/101).
The Apple counterpart is [#65](https://github.com/Integral-Productivity/glassfrog-clipper/issues/65).

## Decisions taken

| Decision | Value | Why |
|---|---|---|
| Visibility | **Unlisted** | Exercises the full review path without a public debut while live-org verification ([#60](https://github.com/Integral-Productivity/glassfrog-clipper/issues/60), [#64](https://github.com/Integral-Productivity/glassfrog-clipper/issues/64)) is open. Anyone with the link can install; it does not appear in search. |
| Version | **0.1.0** | Honest pre-1.0. `0.0.1` reads on a public page as an accidental first commit. 1.0.0 is reserved for the release verified against a live GlassFrog org. |
| Privacy policy | [`PRIVACY.md`](../../PRIVACY.md) in this repo | Version-controlled beside the code that implements the posture, and reviewable in a PR. |
| Category | **Workflow & Planning** | Where GlassFrog-adjacent tooling is looked for. |
| Payments | None | Free. Commercial licensing is handled out of band — see the README's Licence section. |

## Before a submission is possible

These are human steps. None can be done from a terminal.

- [ ] **A Chrome Web Store developer account** and **publisher display name** —
      [#105](https://github.com/Integral-Productivity/glassfrog-clipper/issues/105).
      One-time $5 fee, paid once per Google account. Use an Integral Productivity
      account rather than a personal one: the account owns the listing and
      transferring it later is painful. The display name appears as the author,
      and a bare Gmail address is a trust cost on a listing whose whole pitch is
      trustworthiness.
- [ ] **A reachable privacy policy URL** —
      [#107](https://github.com/Integral-Productivity/glassfrog-clipper/issues/107),
      blocked by [#72](https://github.com/Integral-Productivity/glassfrog-clipper/issues/72)
      / [#80](https://github.com/Integral-Productivity/glassfrog-clipper/issues/80).
      `PRIVACY.md` is written, but the repository is still private. **The
      submission cannot be completed until the flip lands**, because the store
      validates the URL anonymously. Once public it is
      `https://github.com/Integral-Productivity/glassfrog-clipper/blob/main/PRIVACY.md`.

      The rename to `glassfrog-clipper` has **already happened**, which is the
      order this document previously asked for. Every URL here is written against
      the new name deliberately: the old one resolves only through GitHub's
      redirect, and that redirect disappears the moment anybody creates a
      repository under the old name. A privacy-policy URL the store has recorded
      is not somewhere to rely on a redirect.
      [#62](https://github.com/Integral-Productivity/glassfrog-clipper/issues/62)
      stays open for the references still carrying the old name elsewhere in the
      tree.
- [ ] **Screenshots** —
      [#104](https://github.com/Integral-Productivity/glassfrog-clipper/issues/104).
      See [Graphic assets](#graphic-assets); they need a real browser and a real
      GlassFrog org, so they cannot be generated from the source tree.

## Building the upload

```bash
npm run package
```

Builds `dist/`, validates the manifest against the store's rules, and writes
`release/glassfrog-clipper-<version>.zip`. It refuses to write a package that
would fail review — wrong icon dimensions, an over-long description, a version
that disagrees with `package.json`, a stray source map, the Safari manifest
leaking into the Chrome build. The same rules run on every PR two ways:
[`test/store-package.test.ts`](../../test/store-package.test.ts) applies them to
the repository's manifest with no build, and `ci.yml`'s `verify` job runs the
packaging itself against the real compiled output and records the digest.

The zip is deterministic: entries sorted, timestamps pinned. Two runs from the
same commit produce identical bytes, so "is this the package I reviewed?" is a
checksum comparison — which is why CI logs the digest rather than just exiting 0.

## Store listing

### Name

```
GlassFrog Clipper
```

### Summary

The manifest `description` is what the store shows as the summary. Limit 132
characters; this is 72.

```
Clip the page you're on into GlassFrog as a tension, action, or project.
```

### Detailed description

```
Holacracy practitioners sense tensions while deep in other work — reading, browsing, mid-task. Filing one means leaving that work for GlassFrog, and the thought usually doesn't survive the switch.

GlassFrog Clipper closes that gap. One keystroke files the page you're on into GlassFrog as a tension, with no further input, against a capture role you configured once. You never leave the page.

WHAT IT DOES

• Keystroke capture. Cmd+Shift+K (Ctrl+Shift+K) files the current page immediately — title, URL, and whatever you had selected. No dialog, no decision.
• Structured capture when you already know. Cmd+Shift+Y (Ctrl+Shift+Y) opens a popup where role, work type, and a note are all editable — offered, never demanded.
• Tensions, actions, or projects. File as whichever fits.
• Nothing is lost. Capture before you've configured the extension and it's held for you, not discarded.

THE DESIGN COMMITMENT

Capture never blocks on a decision, and never discards one you've already made. Those two together are the whole product. A general-purpose web clipper has no role or work-type structure to make optional, so it cannot make this promise.

PRIVACY

There is no server behind this extension. It talks to exactly one host — api.glassfrog.com — as you, with your own GlassFrog API key. Your key, your capture role, and your drafts stay in your browser's local storage.

Capture timings are recorded locally so the extension can tell you whether it is actually fast. That log never leaves your device unless you press Copy on the options page. It contains no URLs, page titles, selections, or keys — a test asserts it.

Permissions are kept to five plus a single host, and the list is a stop condition in the codebase rather than a default: a build fails if it widens.

OPEN SOURCE

GPL-3.0-or-later. The source, the architecture decisions behind it, and a line-level record of which parts were written with AI assistance are all public.

STATUS

Early. The capture path is implemented and tested, and the extension is published unlisted while it is verified against live GlassFrog organisations. Bug reports are welcome and need no agreement of any kind.

REQUIREMENTS

A GlassFrog account and an API key, which you generate in GlassFrog itself. Chrome 120 or later.
```

### URLs

| Field | Value | Note |
|---|---|---|
| Homepage URL | repository URL | Blocked on the public flip ([#72](https://github.com/Integral-Productivity/glassfrog-clipper/issues/72)). Deliberately **not** added to `manifest.json` as `homepage_url` yet — a private repo would render a dead "Website" link in `chrome://extensions`. Add it in the same change as the flip. |
| Support URL | repository `/issues` | Same dependency. |
| Privacy policy URL | `PRIVACY.md` on `main` | Same dependency. Mandatory — see below. |

## Graphic assets

| Asset | Spec | Status |
|---|---|---|
| Store icon | 128×128 PNG | **Ready** — `public/icon128.png`, rendered from [`scripts/render-icons.py`](../../scripts/render-icons.py). Vector source at [`icon.svg`](icon.svg). |
| Screenshots | 1280×800 or 640×400 PNG, 1–5, at least one required | **Outstanding.** See the recipe below. |
| Small promo tile | 440×280 PNG | Optional; only needed to be eligible for featuring, which an unlisted listing is not. Skip for this submission. |
| Marquee promo tile | 1400×560 PNG | Optional. Skip. |

### Taking the screenshots

Screenshots need a real browser and a real GlassFrog org, so they cannot be
produced from the source tree. Use the Chrome for Testing setup already
documented in [`docs/verifying-in-chrome.md`](../verifying-in-chrome.md) — the
same one the manual verification gates use — with a 1280×800 window.

Four that earn their place, in order:

1. **The popup, mid-capture**, on a recognisable page, with role and work type
   visible but obviously optional. This is the product's actual claim; lead with
   it.
2. **The options page**, showing the API key field and capture-role picker — the
   one-time configuration that makes the keystroke path possible.
3. **The filed item in GlassFrog**, showing the provenance marker and the page
   link. Proves the round trip rather than asserting it.
4. **The measurement panel** on the options page, showing capture timings.
   Distinctive, and it demonstrates the local-telemetry claim the privacy policy
   makes.

Use a demonstration GlassFrog org, not a client one. Screenshots are public even
on an unlisted listing.

## Privacy practices tab

This is the section that gets submissions rejected. Every answer below is
checkable against the source; keep them that way.

### Single purpose

```
GlassFrog Clipper captures the page the user is currently viewing and files it into their own GlassFrog organisation as a tension, action, or project. That is its only function.
```

### Permission justifications

One per declared permission. Each names the user-visible feature it enables —
reviewers reject justifications that restate the permission's own documentation.

| Permission | Justification |
|---|---|
| `activeTab` | Reads the title and URL of the tab the user invoked the extension on, at the moment they invoke it, so the captured item identifies the page they were reading. The extension has no access to any other tab and no access to this one until the user acts. |
| `scripting` | Injects a one-line function into the active tab to read the user's current text selection, so a highlighted passage is captured as evidence alongside the page link. Runs only in response to the user invoking the extension. |
| `storage` | Stores the user's GlassFrog API key, their chosen capture role, and any capture made before configuration was complete, all in local storage. Without it the user would re-authenticate on every capture and a capture made before setup would be discarded. |
| `notifications` | Confirms that a capture reached GlassFrog, or reports that it failed. The keystroke capture path deliberately opens no window, so a notification is the only surface available to tell the user what happened. |
| `alarms` | Expires a capture that has been held awaiting configuration after seven days, rather than retaining the page's content indefinitely. |
| `https://api.glassfrog.com/*` | The GlassFrog API, and the only host the extension contacts. Captures are written here using the user's own API key. |

### Remote code

**No.** All code executes from the package. There is no `eval`, no remote script
loading, and no relaxed content security policy — `scripts/package-chrome.mjs`
fails the package if a CSP permitting either appears in the manifest.

### Data usage disclosures

Chrome asks which categories are collected. Answer:

| Category | Collected? | Note |
|---|---|---|
| Personally identifiable information | **No** | |
| Health information | **No** | |
| Financial and payment information | **No** | |
| Authentication information | **Yes** | The GlassFrog API key. Stored locally; transmitted only to `api.glassfrog.com`, which is what it authenticates against. |
| Personal communications | **No** | |
| Location | **No** | |
| Web history | **No** | The extension reads only the page the user explicitly captures. It does not observe browsing. |
| User activity | **No** | Capture timings are recorded locally and never transmitted. |
| Website content | **Yes** | The title, URL, and selected text of a page the user chooses to capture, sent to their own GlassFrog organisation. |

All three certifications can be affirmed truthfully:

- **Not being sold to third parties** — nothing is transmitted to anyone but the
  user's own GlassFrog organisation.
- **Not being used or transferred for purposes unrelated to the single purpose** —
  the transmitted data *is* the captured item.
- **Not being used or transferred to determine creditworthiness or for lending** —
  no.

## Notes for the reviewer

Paste into the "Notes for reviewers" field. Reviewers cannot test the extension
without a GlassFrog account, and a reviewer who cannot reach the main flow tends
to reject.

```
This extension requires a GlassFrog account (glassfrog.com) and a user-generated API key. Without one, the extension shows its options page and asks for a key; no capture can be completed.

If you need working credentials to review the capture path, please request them via the support email on the listing and we will provision a demonstration organisation.

The extension has no backend of its own. Its only network destination is https://api.glassfrog.com, declared as its sole host permission. All code is in the package; nothing is loaded remotely.

Source, including the architecture decisions behind the permission set, is public at the repository URL on the listing.
```

## Submission checklist

- [ ] Developer account registered and publisher display name set ([#105](https://github.com/Integral-Productivity/glassfrog-clipper/issues/105))
- [x] Repository renamed to `glassfrog-clipper` — done; every URL here is written against the new name rather than the redirect
- [ ] Repository public ([#72](https://github.com/Integral-Productivity/glassfrog-clipper/issues/72))
- [ ] URLs filled in and loading for a signed-out visitor ([#107](https://github.com/Integral-Productivity/glassfrog-clipper/issues/107))
- [x] `npm run package` clean against the real bundle — `verify` does this on every PR ([#103](https://github.com/Integral-Productivity/glassfrog-clipper/issues/103)); take the SHA-256 from that run's log
- [ ] Screenshots taken at 1280×800 against a demonstration org ([#104](https://github.com/Integral-Productivity/glassfrog-clipper/issues/104))
- [ ] Listing fields pasted from this document
- [ ] Privacy tab completed from this document
- [ ] Visibility set to **Unlisted**
- [ ] Submitted, and the review outcome recorded back on [#101](https://github.com/Integral-Productivity/glassfrog-clipper/issues/101)

## After a version is published

A version number accepted by the store can never be reused or rolled back. The
only remedy for a bad release is a higher version. Bump `package.json` and
`public/manifest.json` together — `npm run package` refuses to build if they
disagree, which is the guard that stops a release going out under a number the
repository does not record.

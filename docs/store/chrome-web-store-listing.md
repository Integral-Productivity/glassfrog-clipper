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

## Publisher identity

Who the store thinks we are. Settled in
[#105](https://github.com/Integral-Productivity/glassfrog-clipper/issues/105)
on 2026-09-02, and written down here because two of these choices cannot be
undone and the third is printed on a public page.

### What cannot be changed later

Three constraints shape everything below. All three are Google's, not ours.

- **A developer account's email address is permanent.** Google's registration
  guidance is explicit that it cannot be changed after the account exists. The
  address is therefore an architectural choice, not an administrative one.
- **A deleted account's address is burnt with it.** Google's registration page
  states that the email identity of a deleted developer account cannot be reused
  to create a new one. Deleting is not a way back to the same address.
- **Group publishing no longer exists.** It was replaced by adding *members* to
  a single publisher with roles — viewer, item manager, editor, admin. Members
  join free and do not repeat the registration flow. This, not a note in a wiki,
  is how a second person gets access.

**What *is* reversible, despite an earlier reading of this page:** the publisher
display name. It is an editable field on the Account page. The
one-publisher-per-account-for-life quota was the *group publisher* rule, from
the system the bullet above records as removed — see ADR
[0017](../adr/0017-the-publisher-is-owned-by-an-identity-not-a-mailbox.md).
Spend the caution on the account address, which really is permanent.

### Decisions

| Decision | Value | Why |
|---|---|---|
| Owning account | A `chrome-store`-style role address on the company domain, as a **Cloud Identity Free user** in the existing Workspace organization — a sign-in identity, not a licensed mailbox | Google's own registration guidance suggests a dedicated publishing account. Because the address is permanent, binding it to a role rather than a person is the only version of this choice that survives the person. The requirement is an account that can *sign in*, which a licence does not add and an alias cannot supply — so the identity is free rather than ~$85–110/year. ADR [0017](../adr/0017-the-publisher-is-owned-by-an-identity-not-a-mailbox.md). |
| Publisher display name | **Integral Productivity** | The brand as it reads everywhere else. Drops the entity suffix, which the verified trader block carries anyway. |
| Trader declaration | **Trader**, with **organization verification** — approved as Integral Productivity LLC on 2026-09-03, at the second attempt ([why](#the-entity-is-decided-by-the-payments-profile-not-by-the-trader-form)) | Commercial licensing is the plan, so trader is the accurate declaration; the alternative would be a misdeclaration *and* would tell EU users their consumer-protection rights do not apply. Verification is also the only route to a verified publisher name and a publisher page. |
| Published contact | **Business address** and a **Google Voice** number — as published | Both are mandatory and both are public. Google's trader FAQ names Google Voice as an acceptable SMS-capable option, which keeps a personal mobile off a page anyone can scrape. |
| Human access | Kraig as **Admin** member of the publisher | Satisfies "recorded somewhere durable" as a membership row in the dashboard rather than a fact someone has to remember. |

**The display name and the verified name will differ, and that is expected.**
The free-text publisher name is "Integral Productivity"; trader verification
publishes the *legal* entity, so the verified block will read "Integral
Productivity LLC". Seeing two names in the dashboard is not a misconfiguration.

### The trader disclosure

The EU Digital Services Act requires every Chrome Web Store developer to declare
trader or non-trader status. This is an account-level setting, separate from the
per-item [Privacy practices tab](#privacy-practices-tab), and it is easy to miss
because nothing in the item submission flow asks for it.

Declaring trader means Google collects and then **publishes, at the bottom of
the item listing**: legal name, physical address, phone number, and contact
email. Google's guidance is to use an address you are comfortable having shared
publicly, because it will be. The phone must be able to receive SMS.

Verification is what turns this from an obligation into an asset: a verified
organization gets a verified publisher name and a
[publisher page](https://developer.chrome.com/blog/cws-publisher-pages) — the
concrete form of the trust argument this listing is built on. Unverified, the
publisher name is free text with nothing standing behind it.

> **Still unconfirmed, and still owned by
> [#105](https://github.com/Integral-Productivity/glassfrog-clipper/issues/105):**
> Google's public FAQ does not say what happens to a live item if trader
> verification is started and never completed, nor whether a registered-agent
> address is acceptable in place of a business address. Step 7 was run on
> 2026-09-03 and **the flow surfaced neither**, so they are recorded as
> unanswered rather than quietly dropped. The first one is moot for the
> correction below, because there is no live item yet — which is part of why the
> correction is cheap now and would not be later.

### The entity is decided by the payments profile, not by the trader form

**This went wrong on the first attempt, and the mechanism is worth knowing before
anyone repeats it.** Verification on 2026-09-03 came back approved against an
**individual**, not against Integral Productivity LLC — so the name
standing behind the listing would have been a person's, and the verified
*publisher* name that [ADR 0016](../adr/0016-a-verified-publisher-is-bought-with-a-public-address.md)
set out to buy is available to a verified **organization**.

The cause is not the trader form. **Trader entity is inherited from the Google
payments profile used at registration**, and a payments profile's account type —
Individual or Business — is fixed when the profile is created and cannot be
changed afterwards. Paying the $5 on a personal profile therefore decides the
trader identity, silently, several steps before the trader form is ever shown.
The trader form then has no field that could correct it.

**The correction, and it is available because nothing is published yet:**

0. **Read the Dun & Bradstreet record first**, at
   [service.dnb.com](https://service.dnb.com/home). Google verifies an
   organization through D&B, and the payments profile must match that record
   *exactly* — entity name, address, phone. D&B is the source of truth here, not
   the profile.

   This step is load-bearing for a reason that is easy to miss: **whatever
   verifies becomes the public address on the listing.** A D&B record carrying a
   home or stale address would publish that instead, undoing through the back
   door the choice ADR 0016 made deliberately. Correcting a D&B record goes
   through their review and takes days, so it is a prerequisite rather than a
   cleanup. Checked on 2026-09-03: the record holds the business address, so no
   correction was needed.
1. Create a **Business** payments profile for Integral Productivity LLC — legal
   name, address and phone exactly as D&B holds them, with the
   [D-U-N-S number entered when prompted](https://support.google.com/paymentscenter/answer/13992651).
   A new profile is required; the existing one cannot be converted.
2. On the developer account, switch trader status to **non-trader**, then back to
   **trader**. This is the documented way to restart verification — it is what
   forces the profile choice to be asked again. Submit nothing during that
   interval.
3. Choose the business profile, and verify as an organization. Organization
   verification accepts a D-U-N-S number or company documents such as a corporate
   registry extract, rather than the personal identification an individual
   trader is asked for. Keep the SMS-capable number to hand: Google's trader FAQ
   still requires one for corporations today, with a D-U-N-S-associated number
   named only as a future option.

No second developer account and no second $5 are involved; the fee is bound to
the account, which is unchanged. **Do this before the first submission.** Once an
item is live the personal name and address are on a public page, and the
non-trader interval in step 2 stops being free — which is exactly the risk the
first unconfirmed question above names and nobody can currently answer.

**Done on 2026-09-03, exactly as written above.** Verification is approved as
**Integral Productivity LLC**. The sequence needed no step that is not listed and
no step that turned out to be unnecessary, so this is a runbook validated by use
rather than by reasoning. It cost one cycle only because nothing was published
yet — the argument for correcting before the first submission is the same
argument that made the correction cheap.

### Registering, in order

Order matters in one place: **create the identity before touching the
dashboard.** Registering first and fixing the address afterwards is the one
mistake here with no remedy.

1. **Create the identity.** In the Admin console, turn **off** automatic
   licensing (Billing → License settings) *before* adding anyone, add the
   **Cloud Identity Free** subscription, then add the role address as a
   **user** — not an alias, which cannot sign in, and not a group. Confirm in Billing → Subscriptions that it
   holds a Cloud Identity licence and not a Workspace one; the intent is not
   visible from the user record. Password into the team's password manager, in
   a vault that outlives whoever set it up.

   Then two settings the identity needs and a mailbox would not: a Gmail
   **Default routing** rule for that address (Apps → Google Workspace → Gmail →
   Default routing), because mail to a user without Gmail bounces and this is
   the address Google verifies and notifies; and **Chrome Web Store** turned on
   for that user's organizational unit (Apps → Additional Google services),
   because an administrator can have it off.

   **Test the routing before step 4.** Send a message to the address from
   outside and watch it arrive. This is the cheap moment to find it wrong. If an
   already-committed but unassigned Workspace seat exists, using it instead is
   equally free until renewal and skips both settings and this test.

   **Done on 2026-09-03.** The role address exists as a Cloud Identity Free
   user; it signs in independently, mail reaches it through
   the routing rule, Billing shows a Cloud Identity licence rather than a
   consumed seat, and Chrome Web Store is on for its organizational unit. Step 3
   then showed the developer dashboard presenting its ordinary registration
   screen to that account, so a publisher can be owned by an identity with no
   mailbox behind it. Google documents this neither way; it is recorded here
   because it was observed.

   **Registration completed the same day.** The fee is paid, the display name is
   saved, the account email verified through Google's own message reaching the
   mailbox-less address by the routing rule, and Kraig holds Admin as a
   membership row. Only the trader declaration (step 7) is outstanding, waiting
   on an SMS-capable number.
2. **Have a Google Voice number ready**, or note which existing business line
   can receive SMS. Trader verification will ask, and stalling mid-flow is
   avoidable.
3. **Sign in to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   as that account**, in a clean profile or incognito window. Signing in as the
   wrong Google account and paying is the expensive slip, and the dashboard does
   not make the active account obvious.
4. **Accept the developer agreement, then pay the $5.** One-time, per account,
   non-refundable, and charged before the dashboard is usable. Gift cards are
   not accepted; if several payment methods are attached to the account, confirm
   which one is charged.
5. **Set the publisher display name** to `Integral Productivity` on the Account
   page. This is an editable field, not a one-shot: the irreversible choice was
   the account address, in step 1.
6. **Verify the account email** from the message Google sends.
7. **Declare trader status** and start organization verification. Supply the
   legal name, business address, and SMS-capable number from the table above.
   Expect a code by SMS and a wait for Google's side.
8. **Add Kraig as an Admin member** so access does not depend on one mailbox's
   password.
9. **Record the outcome on
   [#105](https://github.com/Integral-Productivity/glassfrog-clipper/issues/105)** —
   which mailbox owns it, and whether verification came back approved. Do not
   put the password in the issue.

Steps 1 through 8 are all human. Registering an account, entering payment
details, and accepting the developer agreement are not actions an agent should
perform on someone's behalf, so this section is a runbook rather than a script.

## Before a submission is possible

These are human steps. None can be done from a terminal.

- [ ] **A Chrome Web Store developer account**, **publisher**, and **trader
      declaration** —
      [#105](https://github.com/Integral-Productivity/glassfrog-clipper/issues/105).
      One-time $5 fee, paid once per Google account, and payable before the
      dashboard opens at all. The identity decisions are settled — see
      [Publisher identity](#publisher-identity) for who owns it, what it is
      called, and what gets published — but the registration itself is a
      card-and-clicks errand that only a human can run.
- [x] **A reachable privacy policy URL** —
      [#107](https://github.com/Integral-Productivity/glassfrog-clipper/issues/107).
      **Done.** The repository went public on 2026-09-03
      ([#72](https://github.com/Integral-Productivity/glassfrog-clipper/issues/72)),
      which was the blocker, and
      `https://github.com/Integral-Productivity/glassfrog-clipper/blob/main/PRIVACY.md`
      now returns HTTP 200 to an anonymous request. That last part is the check
      that matters and it is easy to fake by looking at a signed-in browser tab:
      the store fetches the URL without credentials, so it has to be verified
      without them too.

      The rename to `glassfrog-clipper` has **already happened**, which is the
      order this document previously asked for. Every URL here is written against
      the new name deliberately: the old one resolves only through GitHub's
      redirect, and that redirect disappears the moment anybody creates a
      repository under the old name. A privacy-policy URL the store has recorded
      is not somewhere to rely on a redirect.
      [#62](https://github.com/Integral-Productivity/glassfrog-clipper/issues/62)
      swept the rest of the tree for the same reason.
- [x] **Screenshots** — one shipped, which is what the store requires
      ([#104](https://github.com/Integral-Productivity/glassfrog-clipper/issues/104)).
      Two more are worth adding and are tracked separately in
      [#215](https://github.com/Integral-Productivity/glassfrog-clipper/issues/215);
      they do not block submission, since a listing's screenshots can be updated
      afterwards. See [Graphic assets](#graphic-assets).

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
All three resolve for an anonymous visitor — the repository went public on
2026-09-03 (#72), which was the blocker. Verified by fetching each without
credentials rather than from a signed-in browser tab, since that is how the store
fetches them.

| Field | Value | Verified |
|---|---|---|
| Homepage URL | `https://github.com/Integral-Productivity/glassfrog-clipper` | HTTP 200 anonymous |
| Support URL | `https://github.com/Integral-Productivity/glassfrog-clipper/issues` | HTTP 200 anonymous |
| Privacy policy URL | `https://github.com/Integral-Productivity/glassfrog-clipper/blob/main/PRIVACY.md` | HTTP 200 anonymous |

The homepage is also declared in the manifest as `homepage_url`, which is what
renders the "Website" link on the extension's card in `chrome://extensions`. It
was deliberately withheld until the flip: a private repository would have put a
dead link there.

Re-check these if the repository is ever renamed again. They are written against
`glassfrog-clipper`, not a redirect — see the note under the privacy policy
prerequisite above.

## Graphic assets

| Asset | Spec | Status |
|---|---|---|
| Store icon | 128×128 PNG | **Ready** — `public/icon128.png`, rendered from [`scripts/render-icons.py`](../../scripts/render-icons.py). Vector source at [`icon.svg`](icon.svg). |
| Screenshots | 1280×800 or 640×400 PNG, 1–5, at least one required | **Ready** — [`screenshots/2-options.png`](screenshots/2-options.png), 1280×800. Two more tracked in [#215](https://github.com/Integral-Productivity/glassfrog-clipper/issues/215). |
| Small promo tile | 440×280 PNG | Optional; only needed to be eligible for featuring, which an unlisted listing is not. Skip for this submission. |
| Marquee promo tile | 1400×560 PNG | Optional. Skip. |

### Taking the screenshots

Screenshots need a real browser and a real GlassFrog org, so they cannot be
produced from the source tree. Use the Chrome for Testing setup already
documented in [`docs/verifying-in-chrome.md`](../verifying-in-chrome.md) — the
same one the manual verification gates use — with a 1280×800 window.

Use a demonstration GlassFrog org, not a client one. Screenshots are public even
on an unlisted listing.

**Shipped:** [`screenshots/2-options.png`](screenshots/2-options.png) — the options
page, showing the API key field (masked) and the capture-role picker populated from
a live organisation. That combination is not stageable: `config.ts` KTD8 validates
the key and fills the picker in a single call, so a populated picker proves a
working key.

**Still wanted**, tracked in
[#215](https://github.com/Integral-Productivity/glassfrog-clipper/issues/215) —
the popup mid-capture on a recognisable page, and the filed item in GlassFrog
showing the provenance marker and page link. Neither blocks submission; the store
requires one screenshot and a listing's screenshots can be updated later.

The measurement panel was considered and dropped. Until roughly twenty captures
exist it reports `0 captures in the last 30 days` and renders every metric as an
em-dash, which demonstrates that the panel exists without demonstrating that it
measures anything.

#### What the capture actually takes

Two mechanics, and one trap worth knowing before you spend an evening on it.

For an **extension page on its own** — the options page — drive CDP directly:
`Emulation.setDeviceMetricsOverride` at `{width: 1280, height: 800,
deviceScaleFactor: 2}`, then `Page.captureScreenshot`, then `sips -z 800 1280` to
bring the 2× capture down to the size the store accepts. No OS-level capture, no
window positioning, pixel-exact.

For anything that must show **browser chrome** — the popup floating over a page —
you need a real screen capture. Set the window with CDP `Browser.setWindowBounds`
to `{left: 0, top: 30, width: 1280, height: 800}` (macOS clamps the top below the
menu bar), then `screencapture -x -R0,30,1280,800` and resample as above.

Two things that cost time on the first run:

- **`--test-type`** suppresses Chrome's "only for automated testing" infobar, which
  otherwise sits across the top of every screenshot.
- **Do not put `--user-data-dir` under `/private/tmp`.** Temp cleanup wiped the
  configured profile twice mid-session, taking the API key and the GlassFrog login
  with it each time.

#### The popup needs a real gesture

`chrome.action.openPopup()` opens the popup but is **not a user gesture**, so Chrome
does not grant `activeTab`. `captureActiveTab()` returns null and the popup renders
*"Chrome does not allow extensions to read this tab."* with the file button disabled
([`src/popup.ts:189`](../../src/popup.ts)). That is correct behaviour — the manifest
asks for `activeTab`, not broad host permissions — so the answer is a genuine
gesture, never widening permissions.

Either gesture works: click the toolbar icon, or press the manifest's
`_execute_action` binding, **Cmd+Shift+Y**. Neither can be synthesised — CDP's
`Input.dispatchKeyEvent` reaches the page, not browser-level extension commands.
A human has to press it.

The filed-item shot additionally needs a **GlassFrog web session signed in** in that
same throwaway profile, not merely a configured extension. Do both in one sitting.

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

- [ ] Developer account registered, publisher created as **Integral Productivity**, and the $5 paid ([#105](https://github.com/Integral-Productivity/glassfrog-clipper/issues/105))
- [ ] Trader status declared and organization verification submitted ([#105](https://github.com/Integral-Productivity/glassfrog-clipper/issues/105)) — account-level, and nothing in the item submission flow prompts for it
- [x] Repository renamed to `glassfrog-clipper` — done; every URL here is written against the new name rather than the redirect
- [x] Repository public ([#72](https://github.com/Integral-Productivity/glassfrog-clipper/issues/72)) — read back as `visibility: public`, and topics added ([#70](https://github.com/Integral-Productivity/glassfrog-clipper/issues/70))
- [x] URLs filled in and loading for a signed-out visitor ([#107](https://github.com/Integral-Productivity/glassfrog-clipper/issues/107)) — all three HTTP 200 anonymous; `homepage_url` declared in the manifest
- [x] `npm run package` clean against the real bundle — `verify` does this on every PR ([#103](https://github.com/Integral-Productivity/glassfrog-clipper/issues/103)); take the SHA-256 from that run's log
- [x] Screenshots taken at 1280×800 against a demonstration org ([#104](https://github.com/Integral-Productivity/glassfrog-clipper/issues/104)) — one shipped; upload `docs/store/screenshots/2-options.png`
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

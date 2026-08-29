# Capture path — verification record

What was actually run against the Verification Contract in
[the capture-path plan](2026-08-28-1123-feat-zero-decision-capture-path-plan.md),
with evidence. Written at the point the implementation units landed, so the
record reflects the state at merge rather than a later reconstruction.

One gate did not run. It is marked as such rather than folded into the passes.

## Gates

| Gate | Result | Evidence |
|---|---|---|
| Types — `npm run typecheck` | Pass | `strict` + `noUncheckedIndexedAccess`, green in CI on every PR |
| Tests — `npm test` | Pass | 103 tests, non-zero count confirmed in CI output |
| Build — `npm run build` | Pass | green in CI |
| Bundle — no bare specifier | Pass | `scripts/check-bundle.mjs`; also rejects DOM-only globals |
| CI on a pull request | Pass | PRs #18, #20, #21, and `main` after each merge |
| CI on a Dependabot pull request | Pass | PR #22, run 33224406342 — all steps succeeded, including `npm ci` against GitHub Packages |
| Manual — loads unpacked, worker registers | Pass | Chrome for Testing; no exceptions; both commands bound (R22) |
| Manual — capture on a `chrome://` tab fails visibly | Pass | `tabs.query` returns `url: null`; `scripting` refused; the guard surfaces rather than filing an empty tension (OQ7) |
| **Manual — capture on a real page files a tension** | **Not run** | See below |

## Global Definition-of-Done clauses

| Clause | Result |
|---|---|
| All 22 requirements implemented or explicitly deferred | Pass — enforced by `test/requirements-coverage.test.ts`; R13 deferred to #3 |
| A2 confirmed against the real unprocessed queue | Pass — 13 unprocessed tensions, demonstrably worked; see PR #18 |
| No abandoned or experimental code in the diff | Pass — the `resolveWorkType` stub was removed with U4 |
| API key in no log, notification, error string or telemetry field | Pass — `test/errors.test.ts` and the wire-level assertions in `test/glassfrog-adapter.test.ts` |
| Permission list unchanged from the DoD's five plus the host permission | Pass — pinned by `test/manifest.test.ts`; confirmed live via `chrome.permissions.getAll()` |

## The gate that did not run

> **Manual** — load unpacked, capture on a real page → a tension appears in
> GlassFrog carrying the marker, URL, and title.

Filing against live GlassFrog requires a v5 API key entered into the options
page. That was not done, so this gate is **unmet as written**.

Its two halves were each verified independently, which is worth recording
because together they cover the substance without composing it:

1. **What the extension sends.** Driven in Chrome against the real
   `api.glassfrog.com`, the built extension emitted exactly one request:

   ```
   POST https://api.glassfrog.com/api/v5/roles/{role}/tensions
   {"tension":{"body":"[glassfrog-clipper] <title>\n\n<url>\n\n<selection>"}}
   ```

   with `X-Auth-Token` set, the marker leading the body, and no `label` or
   `status`. A deliberately fake key returned 401, classified as
   `unusable-role` with `reconfigure: true` (R18), the capture preserved and the
   in-flight marker retained (R10, KTD7). The success path was then exercised by
   fulfilling the extension's own request with a synthetic 201: outcome
   `{status:'filed', itemId}`, badge `✓` with a clear alarm scheduled, in-flight
   marker cleared only after the 201, pending slot empty.

2. **What GlassFrog accepts.** A tension was filed against the live API with the
   payload `compose()` actually produces, read back, and deleted. It landed
   carrying the marker, URL and selection, and reported `status: unprocessed` —
   server-derived, with no status sent (KD2).

What remains unproven is only the composition of the two: a valid key and the
real server in a single act. Whoever installs the extension first should run it,
and this row should be updated rather than quietly dropped.

## Two findings that reached merge-ready state invisible to the suite

Both were found only by leaving Node, and both are the reason the manual gates
exist. Recorded here so the next person does not conclude the test suite is
sufficient on its own.

- **The v5 API rejects `label` on tension create**, and caps it at 200
  characters. KTD5 placed R11's provenance marker there, so every capture would
  have failed or landed unmarked. See
  [ADR 0004](../adr/0004-provenance-marker-rides-in-the-tension-body.md).
- **The SDK invokes `fetch` unbound**, which browsers reject with
  `Illegal invocation`. Every capture failed with `status: 0`, which classifies
  correctly as a network error — so the practitioner would have been told they
  were offline, forever, on a working connection. Filed upstream as
  `glassfrog-sdk-ts#170`; worked around locally by passing a bound fetch.

The common shape: the capture path is deliberately tested through a narrow port
against a fake, which is what makes it testable, and equally what makes it
possible to be confidently wrong about what sits on the other side.
See [verifying-in-chrome.md](../verifying-in-chrome.md) for how to re-run these.

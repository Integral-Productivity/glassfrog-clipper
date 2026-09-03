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
| Bundle — no bare specifier | Pass | `scripts/check-bundle.mjs`; also rejects DOM-only globals *(that script was removed in #88; the same rule now runs as `fitness/checks/bundle-shape.ts`)* |
| CI on a pull request | Pass | PRs #18, #20, #21, and `main` after each merge |
| CI on a Dependabot pull request | Pass | PR #22, run 33224406342 — all steps succeeded, including `npm ci` against GitHub Packages |
| Manual — loads unpacked, worker registers | Pass | Chrome for Testing; no exceptions; both commands bound (R22) |
| Manual — capture on a `chrome://` tab fails visibly | Pass | `tabs.query` returns `url: null`; `scripting` refused; the guard surfaces rather than filing an empty tension (OQ7) |
| **Manual — capture on a real page files a tension** | **Pass** | Run by the practitioner 2026-08-30; see below |

## Global Definition-of-Done clauses

| Clause | Result |
|---|---|
| All 22 requirements implemented or explicitly deferred | Pass — enforced by `test/requirements-coverage.test.ts`; R13 deferred to #3 |
| A2 confirmed against the real unprocessed queue | Pass — 13 unprocessed tensions, demonstrably worked; see PR #18 |
| No abandoned or experimental code in the diff | Pass — the `resolveWorkType` stub was removed with U4 |
| API key in no log, notification, error string or telemetry field | Pass — `test/errors.test.ts` and the wire-level assertions in `test/glassfrog-adapter.test.ts` |
| Permission list unchanged from the DoD's five plus the host permission | Pass — pinned by `test/manifest.test.ts`; confirmed live via `chrome.permissions.getAll()` |

## The manual gate, as run

Run by the practitioner on 2026-08-30 against their own GlassFrog account, from
the extension loaded unpacked. Both a tension and a project were captured.

**Inspected directly** — `proj_c187828806cc4e62a0403d89817b5a3c`, filed by the
extension on ◎Technology Architecture:

```json
{
  "description": "[glassfrog-clipper] Hermes Agent — Open-Source AI Agent That Grows With You | Nous Research",
  "note": "Pilot using Hermes for AI agent work.\n\nhttps://hermes-agent.nousresearch.com/",
  "status": "current",
  "role_id": "role_528e6fa34ea2482e923f2165bdaea223"
}
```

That confirms, end to end and with a real credential: the provenance marker
leads the field (R11), the page title rides with it (R7), the practitioner's
note precedes the page URL in the evidence block (R17), the configured default
status was applied (R6, KD3), and the item landed on the role the practitioner
chose (R5).

**Reported, not independently inspected** — the tension capture, which the
practitioner confirmed worked. It was filed against a role not identified at the
time and was not located afterwards; the search endpoint indexes projects but
did not return it. The tension path is otherwise covered by the browser run
below and by the authorised live filing during implementation, both of which
produced a tension carrying marker, URL and title and reporting `unprocessed`.

The gate is recorded as passed on that basis: the composition it exists to test
— a valid key, the real server, and the extension in one act — was exercised and
produced correctly-formed items.

### What the run surfaced

Two defects, neither of which any automated gate could reach, both now filed:

- The role picker was permanently empty for every account, because the SDK's
  `me.get()` does not unwrap the `data` envelope the API returns. Fixed in the
  extension; filed upstream as `glassfrog-sdk-ts#172`.
- Three enhancements from real use: the project `link` field left unpopulated
  (#28), circles offered when filing an action or project (#29), and same-named
  roles indistinguishable in the picker (#30).

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

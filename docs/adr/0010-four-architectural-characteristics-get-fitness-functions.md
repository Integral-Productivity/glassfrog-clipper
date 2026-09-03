# Four architectural characteristics get fitness functions

Date: 2026-09-01

## Status

Accepted. Amended 2026-09-03 (#88) — the shim half of "reported from two" has
been retired now that the concurrency it existed to avoid has cleared. The
decision below stands; see the note at the end of the Decision section.

Makes enforceable the permission stop-condition in the Definition of Done, the
SDK boundary chosen in [GlassFrog authentication and write path](0002-glassfrog-authentication-and-write-path-for-the-browser-extension.md),
and the marker contract in [Provenance marker rides in the tension body](0004-provenance-marker-rides-in-the-tension-body.md).

Paired with [Behaviour is specified at the domain, with a thin platform surface layer](0011-behaviour-is-specified-at-the-domain-with-a-thin-platform-surface-layer.md),
which covers the other half of the tier-1 gate content.

## Context

The staged tier-3 → tier-1 transition decided in #49 makes `BDD / Scenarios` and
`Software Fitness / Self-compliance` required status checks. A required check
that never reports blocks every PR, so this repo needs real assertions behind
both before it can join the ruleset (#69).

"Real" is the load-bearing word. A suite that passes because it checks nothing
satisfies the ruleset mechanically and protects nothing, and is worse than no
gate: it converts an absent guarantee into an apparent one.

Three facts shaped what got built.

**The repo already had two fitness functions, filed as tests.**
`test/requirements-coverage.test.ts` and `test/adr-numbering.test.ts` both
describe themselves as fitness functions in their own headers. #69's premise
that the repo has none is off by two. What was missing was not the checks but a
suite the gate could address.

**The ad-hoc bundle check had already earned its place.** `scripts/check-bundle.mjs`
existed because U1 shipped a build that exited 0 and emitted a bundle no MV3
service worker could load. That is a fitness function in everything but filing.

**Not every candidate is worth the same.** #69 listed four candidates and said
to evaluate rather than assume. The evaluation question we used: *does this
characteristic erode silently, and is the erosion expensive?* A property that
fails loudly the moment it breaks does not need a fitness function; a test does.

## Decision

Four characteristics get fitness functions. All four candidates in #69 were
adopted, on the reasoning below rather than by default.

| Characteristic | Check | Why it erodes silently |
|---|---|---|
| **Loadability** — the service worker registers, and registers fast | `bundle-shape` | `npm run build` exits 0 on a bundle Chrome cannot load. Proven, not hypothetical: this is U1. |
| **Confidentiality** — the API key never leaves the service worker | `credential-confinement` | A closure over the key inside an injected function hands it to every page clipped. Nothing fails, nothing goes red, the extension looks identical. |
| **Installability** — the permission dialog stays small enough to accept | `manifest-permissions` | A widened permission ships green; the feedback arrives at Web Store review, months later. |
| **Evolvability** — a v5 change is an SDK bump, not a sweep of this repo | `sdk-boundary` | A raw `fetch` works perfectly until v5 changes, at which point the SDK bump fixes every call site except the one that bypassed it. |

Two further decisions about *how*, which matter as much as the set:

**The rule lives in one place and is reported from two.** `scripts/check-bundle.mjs`
became a shim over `fitness/checks/bundle-shape.ts`, so `ci.yml`'s existing step
kept working with no edit to a file sibling sessions were concurrently
changing. `test/manifest.test.ts`, `test/adr-numbering.test.ts`, and
`test/requirements-coverage.test.ts` now import their rules from `fitness/checks/`
and still assert them under `npm test`.

This is what `test/adr-numbering.test.ts`'s header meant by wanting "no separate
workflow step to drift from it". A second *implementation* drifts. A second
*reporter* of the same function cannot.

_Amended 2026-09-03 (#88)._ The shim was transitional: it existed so that #86
needed no edit to `ci.yml` while #67 and #68 were changing that file. Once those
had settled, the duplicate `Check the service worker bundle` step and
`scripts/check-bundle.mjs` were both removed, leaving
`Software Fitness / Self-compliance` as the rule's single caller.

That removal needed one thing this section did not say. "Reported from two" is a
claim about *authorship*, and whether a reporter may be dropped turns on
*enforcement*: at the time, `main` required only `verify`, so the surviving
reporter could go red without blocking a merge. `Software Fitness /
Self-compliance` was made a required check first, under [#194](../../issues/194)
and ADR 0012, and only then was the duplicate deleted. One implementation is
what makes two reporters agree; being required is what makes a reporter a gate.
That ordering is now a rule rather than an episode —
[ADR 0022](0022-a-fitness-check-is-only-a-gate-where-a-required-context-runs-it.md).

**Every check names the characteristic it defends, in its own output.** The
report carries the characteristic beside the result, so a red says what is being
protected rather than only what tripped. A check whose rationale lives in a
commit message becomes a check nobody dares change, and then a check somebody
deletes.

## Options considered

**A. Only graduate what exists.** Cheapest, and non-vacuous immediately. Rejected:
it leaves the two characteristics most load-bearing for the Distribution & trust
track — confidentiality and installability — unguarded, and that track is the one
the tier-1 transition is in service of.

**B. The trust triad only** (bundle, credentials, permissions), deferring the SDK
boundary. Defensible: the SDK boundary erodes slowly and its cost is moderate,
which is the weakest case of the four. Rejected on the balance of cost — the
check is thirty lines over a directory already being read, and the alternative is
noticing the bypass during a v5 incident.

**C. All four, plus graduating the two existing.** Adopted. Six checks.

## Consequences

The `Software Fitness / Self-compliance` gate reports six checks with real
assertions. Each was mutation-tested before this ADR was written: a permission
added to the manifest, a credential passed to an injected function, a raw
`fetch` at api.glassfrog.com, and an over-budget bundle each turn the suite red
and exit non-zero.

**The bundle budget is a judgement, not a measurement.** 256 KiB against ~190 KiB
today. It is sized to catch a *dependency* landing in the service worker, not a
feature, and is deliberately loose enough that ordinary growth never trips it — a
budget that fires spuriously is a budget somebody raises without reading, which
is the same as not having one. Raising it is fine; raising it in a commit that
does not say what got bigger is not.

**`credential-confinement` treats a new `content_scripts` entry as a stop
condition**, the same way the Definition of Done treats a new permission. That is
a real constraint on future work: adding a content script is now an argument to
have, not a line to add. This is intended. It is also the check most likely to be
wrong-shaped later — if a content script becomes genuinely necessary, the check
should be narrowed to "no credential reachable from it" rather than deleted.

**`sdk-boundary` reads the GlassFrog origin from the manifest rather than
carrying its own copy.** `public/manifest.json` already declares the one origin
the extension may reach, and `manifest-permissions` pins it. A second hardcoded
copy would mean a change to the origin moved the boundary while the guard kept
watching the old one. CodeQL prompted this — it flagged the hardcoded form as
incomplete URL sanitization, which is a false positive on a grep over source
text, but the fix it pushed us toward is better than what it replaced.

**A false red is possible and is preferable to a false green.** The first run of
`manifest-permissions` reported a violation that was a bug in the check —
`chrome.commands` is unlocked by the manifest's `commands` key, not by a
permission entry. That exemption is now pinned by a test rather than left to be
rediscovered. The general shape recurs: these checks read source with regular
expressions, and a refactor can produce a red with nothing wrong. The remedy is
to fix the check in a commit that says why, never to widen it silently.

**`test/fitness/suite.test.ts` guards the guards.** A fitness suite decays in two
ways that do not show up as a red — a check stops being run, or a check keeps
running but can no longer fail. It asserts that every module in `fitness/checks/`
is imported by some test and wired into `CHECKS`. That rule is stated as "imported
by a test", not "has a file of the same name", because this repo deliberately
breaks the filename proxy: two checks are asserted from the test files where they
were written.

**The gate runs from a repo-local workflow, not the org reusables.** Both
`reusable-bdd.yml` and `reusable-architecture-fitness.yml` are pnpm-hardcoded,
and this repo is npm-locked by ADR 0002 plus devops-excellence ADR-016. The
package scripts are built to the reusables' exact contract — `bdd`, and
`fitness:self --json-out=<path>` writing markdown to stdout and exiting non-zero
— so the eventual swap is replacing each job's `steps:` with a `uses:`.
Tracked as devops-excellence#603 (public host) and #617 (npm support).

**The job names in `.github/workflows/bdd-and-fitness.yml` carry a slash on
purpose.** A caller of a reusable emits `<caller job> / <called job>`; a plain job
emits its own name. Reproducing the exact required context therefore means
putting the whole string in `name:`, which reads like a typo and would silently
un-gate the repo if tidied. `test/workflow-contexts.test.ts` pins both.

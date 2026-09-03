# Auto-merge is armed by requiring exactly one check on main

Date: 2026-09-02

## Status

Accepted, amended 2026-09-03 — see [Amendment](#amendment-2026-09-03). The
decision below stands; the count in its title and in "Decision" does not. `main`
now requires three checks. The title is left as written because it records what
was decided on 2026-09-02, and because renaming the file would break every link
into it for no gain.

Numbered 12 rather than 10 deliberately: `0007` landed on `main` with
[#61](../../pull/61) while this was being written, and [#86](../../pull/86) is
still open claiming both `0010` and `0011`. Listing `docs/adr/` would have shown
0010 free; it is not. See [#83](../../issues/83) and the guard in
[`test/adr-numbering.test.ts`](../../test/adr-numbering.test.ts).

Relates to [#67](../../issues/67) (Stage 0 of the tier-1 transition) and
[#69](../../issues/69) (the tier-1 gates).

## Context

`CLAUDE.md` says Claude-authored branches are named `claude/<slug>` because that
"enables auto-merge on green CI", and that draft PRs are avoided because
"auto-merge only fires on ready-for-review PRs". Both sentences assume auto-merge
is available on this repository. It was not.

The repository setting was never the problem. Measured on 2026-09-02:

| surface | value |
|---|---|
| `allow_auto_merge` (REST) | `true` |
| `repository.autoMergeAllowed` (GraphQL) | `true` |
| viewer permission | `admin` |
| `GET /repos/.../branches/main/protection` | `404 Branch not protected` |
| `GET /repos/.../rules/branches/main` | `[]` |
| `pullRequest(61).viewerCanEnableAutoMerge` | **`false`** |

PR #61 at the time was `MERGEABLE`, not a draft, with all seven checks green.
Every gate GitHub documents passed except one: `main` had no branch protection
rule and no ruleset, and no org-level ruleset applied to it either.

That is sufficient on its own. **Auto-merge is a deferral primitive, not a merge
primitive.** GitHub offers it only when something would otherwise delay the
merge. With nothing required on the base branch, a mergeable PR can be merged
right now, so there is nothing to defer and GitHub declines to arm the feature.
The button is absent in the UI and `gh pr merge --auto` fails.

The trap is that the failure looks like a permissions or auth problem, so the
instinct is to check the token — which is the wrong surface entirely.

## Decision

`main` requires exactly one status check: **`verify`**, the sole job in
[`ci.yml`](../../.github/workflows/ci.yml).

> **Amended 2026-09-03.** `main` requires three. The rule that decides which is
> unchanged; only the count is. See [Amendment](#amendment-2026-09-03).

Requiring one check is enough to arm auto-merge. Requiring *more* is where this
gets dangerous, and the danger is not symmetric with the benefit:

| check | source | reports on every PR? | required? |
|---|---|---|---|
| `verify` | `ci.yml`, `pull_request`, unfiltered | yes | **yes** |
| `Swift core`, `Xcode targets` | `apple.yml`, `pull_request` **filtered** to `apple/**` &c. | **no** — silent unless the PR touches those paths | no |
| `CodeQL` (rollup) | code-scanning **default setup**, GHAS app `integration_id 57789` (not `codeql.yml`) | yes — 18 of 18 PR heads, in 2–4s | **decided yes**, gated — [#89](../../issues/89) |
| `Analyze (…)` | code-scanning **default setup**, one job per configured language | yes *today*, but the name set is mutable — see below | **no** — [#89](../../issues/89) |

A required check that never reports does not fail the PR; it pins it at
"Expected — waiting for status to be reported", forever. Requiring the Apple
checks would do exactly that to every PR that does not touch Apple paths.

The CodeQL row is the one worth reading twice, because the obvious reasoning
about it is wrong. `codeql.yml` really does trigger only on `schedule` and
`workflow_dispatch` — but the `CodeQL` and `Analyze (…)` checks appear on pull
requests regardless, because **code-scanning default setup is configured on this
repository** and runs independently of that workflow file. So "requiring CodeQL
would deadlock every PR" is false; the checks do arrive. Whether they are
*requirable* was left open here and settled by [#89](../../issues/89), which
measured them rather than reasoning about them. Two results change this table.

**The rollup is requirable; the per-language jobs are not.** `Analyze (swift)`
runs on `macos-latest` and took 10m37s–16m52s across thirteen pull requests that
touch no Swift at all, against 22–32s for `verify`. Requiring it would move
time-to-merge by 25–45× and bill a macOS runner, unfiltered, on every pull
request — the cost `apple.yml` path-filters precisely to avoid.

**A default-setup check name is not a stable surface to require.** The rule below
asks whether a check reports on every pull request. `Analyze (swift)` satisfies
that rule today and did not exist yesterday: default setup's language list gained
`swift` and `python` at `2026-09-02T21:55:08Z`, taking the `Analyze (…)` set from
two names to four *underneath open pull requests*. Those names derive from a
mutable repository setting, not from any file in `.github/workflows/`, so a
required one can lose its source with nothing in the repository to explain the
resulting deadlock. The rollup's name does not vary with that list.

So the row above splits. This is the sharper form of the lesson: a check name is
not owned by the workflow whose name resembles it — and where it is owned by a
*setting* rather than a file, satisfying the rule today is not evidence it will
satisfy the rule tomorrow.

The lesson generalises past this repo: **a check name is not owned by the
workflow whose name resembles it.** Verify where a check actually comes from
before reasoning about its trigger.

So the rule is not "require the important checks". It is: **a check may be
required only if it reports on every pull request.** Importance is not the
criterion; reporting reliably is.

## Consequences

Auto-merge becomes armable, which is what `CLAUDE.md` already assumed.

`verify` becomes genuinely blocking. That is the point, but it is a real change:
a red `verify` now stops a merge rather than merely embarrassing it.

CodeQL remains unenforced at the merge boundary as of this ADR. The evidence it
asked for arrived under [#89](../../issues/89): the `CodeQL` rollup is to become
a second required check, and no `Analyze (…)` job is. That change is **not
applied here** and is gated on [#111](../../issues/111) choosing a CodeQL owner,
because one of its options turns default setup off and would leave the rollup
with no source — requiring a check whose publisher has been removed is the
deadlock this ADR exists to prevent.

One caveat belongs on the record rather than in the commit message that
eventually applies it. The rollup returned `neutral` on 3 of 18 heads, with the
output `1 configuration not found` — it compares the head's analyses against
`main`'s, and cannot compute "alerts introduced by this pull request" when the
two carry different language sets. GitHub scores `neutral` as a pass. So the
required check will go green in exactly the case where it is reporting that it
could not do the comparison, and it re-fires on every open pull request each time
the language list changes. That is still strictly more enforcement than none, and
it is the shape devops-excellence ADR-024 / ADR-037 already mandate fleet-wide —
but a green `CodeQL` means "no new alerts *or* no comparison made", and the
ruleset cannot say which.

The rule above is executable rather than advisory:
[`test/branch-protection.test.ts`](../../test/branch-protection.test.ts) fails if
a required check is drawn from a workflow that cannot report on every PR. The
offline half runs in `npm test`. The half that reads live GitHub state is opt-in
behind `CHECK_LIVE_BRANCH_PROTECTION=1`, because CI's token has only
`contents: read` and cannot read rulesets — a check that cannot run in CI is
better declared opt-in than left to fail confusingly.

> **Amended 2026-09-03.** That last sentence rests on an incomplete premise, and
> the cost of it was paid before it was noticed. The rules endpoint answers
> unauthenticated on a public repository, so the token was never the obstacle —
> and while the live half sat skipped, the ruleset and the declared list
> disagreed with nothing to say so. [#200](../../issues/200) carries the
> decision about what to do with it.

## Amendment (2026-09-03)

`main` requires three status checks, not one:

| context | source | reports on every PR? |
|---|---|---|
| `verify` | `ci.yml`, `pull_request`, unfiltered | yes |
| `BDD / Scenarios` | `bdd-and-fitness.yml`, `pull_request`, unfiltered | yes |
| `Software Fitness / Self-compliance` | `bdd-and-fitness.yml`, `pull_request`, unfiltered | yes |

The two new contexts are the tier-1 gates that
`devops-excellence/rulesets/self-governance-adopted.json` mandates. The slash in
each name is load-bearing rather than a typo — a caller of a reusable workflow
emits `<caller job> / <called job>`, and `bdd-and-fitness.yml` reproduces the
org-canonical context from a local job by putting the whole string in `name:`.
[`test/workflow-contexts.test.ts`](../../test/workflow-contexts.test.ts) holds
that reasoning and pins both names against being tidied away.

**What this amendment does not change is the rule.** "A check may be required
only if it reports on every pull request" is why these two qualify and why the
`Analyze (…)` jobs still do not. Both new contexts come from an unfiltered
`pull_request` trigger, and both were observed reporting `success` on a pull
request's head (#193, head `1467da71`) before being required — the precondition
[ADR 0018](0018-the-cla-check-is-required-only-after-it-has-reported-once.md)
adds on top of this ADR's test.

**What it does change is the sentence "requiring exactly one check".** That was
never the criterion, only the count that satisfied it on 2026-09-02. One check
is what *arms* auto-merge; the number above one is set by which checks pass the
rule, not by any property of auto-merge. Nothing in the auto-merge reasoning
depends on the count, and neither does
`REQUIRE_UP_TO_DATE_BRANCHES`: strictness is a property of *when* a required
check is evaluated, not of how many there are.

### How this was found, which is the part worth keeping

The ruleset was changed to require all three under
[#194](../../issues/194) while
[`test/branch-protection.test.ts`](../../test/branch-protection.test.ts) still
declared `REQUIRED_CHECKS = ['verify']`. That file carries a live test whose
failure message is *"main's ruleset and REQUIRED_CHECKS disagree — one of them
was changed without the other"*, which is precisely the condition that held. It
did not fire. It is skipped unless `CHECK_LIVE_BRANCH_PROTECTION=1` is set, and
no workflow sets it, so the disagreement stood green for as long as it took a
human to notice.

That is the same shape as [#179](../../issues/179): not a missing guard, a guard
nothing runs. The offline half of that file is genuinely binding and did its job
here — adding these two contexts made it check their triggers. The live half is
documentation. Whether it can be made binding is
[its own question](../../issues/200), because the reason it is opt-in — CI's
`GITHUB_TOKEN` carries only `contents: read` — turns out not to be the whole
story: `GET /repos/{slug}/rules/branches/main` answers unauthenticated on a
public repository, at the price of a 60-per-hour shared rate limit.

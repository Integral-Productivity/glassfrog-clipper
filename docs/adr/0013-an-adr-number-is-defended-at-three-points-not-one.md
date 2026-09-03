# 13. An ADR number is defended at three points, not one

Date: 2026-09-02

## Status

Accepted

Resolves the decision [#83](../../issues/83) was opened to force. Builds on
[#42](../../pull/42) and [#54](../../pull/54) (the two earlier renumbers),
[#47](../../pull/47) (the numbering guard) and
[ADR 0012](0012-auto-merge-is-armed-by-requiring-exactly-one-check-on-main.md)
(what `main` requires).

## Context

On 2026-09-02 two open pull requests both carried a `docs/adr/0007-*.md`:
[#61](../../pull/61) (telemetry) and [#66](../../pull/66) (the Apple build).
`docs/adr/` on `main` ended at 0006, so the number was free when each was
written and neither author was careless. It was the second occurrence — the
same thing happened at 0005 on 2026-08-31, and #42 renumbered the loser to
0006. ADR 0012 was numbered 12 rather than 10 to stay clear of a *third*
in-flight claim on 0010 and 0011.

Twice is a pattern, and the pattern is not carelessness. It is that **a
sequential number is shared mutable state claimed on a private branch**, so two
branches can hold the same one without either being observably wrong.

The obvious diagnosis of the gap is wrong, and worth writing down so the next
reader does not act on it. `test/adr-numbering.test.ts` does *not* only look
within a branch. GitHub runs checks on the merge tree it builds from head plus
base, so the guard already sees `main`'s ADRs — as its own header says it was
designed to.

The actual hole was that a green it produced could go **stale and still merge**.
A check result is recorded against a head SHA, and a base-branch move is not a
`synchronize` event, so nothing re-runs when `main` gains an ADR underneath an
open pull request. With `strict_required_status_checks_policy` off, as it was:

1. #66 merges `docs/adr/0007-*.md`.
2. #61's `verify` is already green — against a tree in which 0007 was free.
3. Nothing re-runs, and nothing requires it to. #61 merges.
4. `main` holds two `0007-*.md`, and the guard that would have caught it never
   ran against the tree that contained both.

That did not happen, because the #66 session renumbered by hand in commit
`3e926b4`. Relying on that is relying on someone noticing.

## Decision

Three layers, deliberately redundant, each closing a different moment.

**The belt — make the existing guard binding.** `main` sets
`strict_required_status_checks_policy: true`, and the repository enables
`allow_update_branch`. This adds no cleverness to the guard; it forces the merge
tree to be rebuilt against a `main` that has moved, so a stale green cannot
merge. `allow_update_branch` is paired with it because auto-merge (ADR 0012)
needs a way to bring a stale branch forward without a human rebase. The number of
required checks is unchanged, so 0012's reasoning is untouched: strictness is a
property of *when* the one required check is evaluated, not of how many are
required.

Both are repository configuration rather than code, and **neither is applied
yet** — changing what `main` accepts is an operator action taken deliberately,
not a side effect of merging this ADR. Tracked in [#116](../../issues/116), with
the exact commands. `REQUIRE_UP_TO_DATE_BRANCHES` is set to the decided value
rather than the live one, so the opt-in live test is red until the settings
catch up; matching it to the current setting would record the gap as the intent.

**The suspenders — report the collision while both branches are still open.**
`scripts/check-adr-claims.ts` reads the ADR numbers each open pull request
claims, from the only place the claim actually lives: the paths it creates. A PR
whose number is also claimed by another open PR fails `verify` with a message
naming the other branch. This runs as a step inside `verify` rather than as a
second required context, again per 0012.

It cannot close the window — two pull requests opened in the same minute still
race, exactly as #47's header argued no pre-claim search can. What it changes is
*when* and *how legibly* the collision surfaces: while both branches are cheap to
move, rather than as a red on a branch its author thought was finished.

A claim is the *creation* of a numbered path — `added`, `renamed`, `copied` —
never `modified` or `removed`. Both exclusions are load-bearing and both are
tested. Counting `removed` would make a renumber look identical to the collision
it fixes. Counting `modified` would report two pull requests that merely edit the
same existing ADR as colliding; that was not hypothetical, it is what the first
live run reported about [#100](../../pull/100).

**The lifestyle change — stop racing on the number at all.** Both layers above
defend a scheme in which the contended resource is claimed on a branch. The
durable fix is to stop claiming it there. That is a larger change with a real
choice inside it — a number allocated at merge time, derived from the pull
request number, or something date-ordered — and it is scoped separately in
[#115](../../issues/115) rather than settled here, because picking a scheme
badly is worse than picking one late.

## Consequences

Pull requests must be up to date with `main` before merging. On a repository
this size that is a small cost, paid mostly by auto-merge rather than by a
person, and it is the entire reason the belt works.

Both sides of a live collision go red, and either one renumbering clears both.
The check does not guess which branch is cheaper to move; the failure message
states the rule #83 settled — the pull request opened first keeps the number.

The scan fails open when it cannot list pull requests: a fork's `GITHUB_TOKEN`
cannot, and a push to `main` has no subject. Everywhere else in this repository
a silently-skipping guard would be a defect, so the exception is stated rather
than assumed — this is the suspenders, and the belt does not depend on a token
or on this file. Failing open loses an early warning. It does not let a
duplicate reach `main`.

`REQUIRE_UP_TO_DATE_BRANCHES` in
[`test/branch-protection.test.ts`](../../test/branch-protection.test.ts) makes
the ruleset setting executable rather than remembered, alongside
`REQUIRED_CHECKS`. Like its neighbour, the live half is opt-in behind
`CHECK_LIVE_BRANCH_PROTECTION=1`, because CI's token cannot read rulesets.

The claim rules live in `scripts/adr-claims.ts`, not in `fitness/checks/`. That
placement was tried and rejected by `test/fitness/suite.test.ts`, which requires
every file in `fitness/checks/` to be registered in `CHECKS` and run by the
offline self-compliance gate — precisely so a check cannot quietly stop being
run. A check that asks the forge a question can never be offline or
deterministic, and exempting it would have blunted that guard for every future
check as well.

Sequential-ID collisions are not unique to this repository; the same failure has
occurred against `IPAT-NNN` and `SAE-NNN` slots elsewhere in the org. Whether
these layers become an org-wide standard in `devops-excellence` is scoped in
[devops-excellence#629](https://github.com/Integral-Productivity/devops-excellence/issues/629)
— a cross-repo reference, which GitHub links but never closes.

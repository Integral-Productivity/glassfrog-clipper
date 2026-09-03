# A fitness check is only a gate where a required context runs it

Date: 2026-09-03

## Status

Accepted

Extends [ADR 0010](0010-four-architectural-characteristics-get-fitness-functions.md),
which decided *what* the fitness suite checks and that a rule lives in one place
while being reported from more than one, and
[ADR 0012](0012-auto-merge-is-armed-by-requiring-exactly-one-check-on-main.md),
which decided what `main` may require. This decides the property that has to
hold between them.

Forced by [#88](../../issues/88), stated as a guard by
[#195](../../issues/195), and applied for the first time in the change that
carries this ADR.

## Context

`scripts/check-bundle.mjs` became a three-line shim over
`fitness/checks/bundle-shape.ts` in [#86](../../pull/86). From that moment
`ci.yml`'s `Check the service worker bundle` step and the fitness suite ran the
identical assertion, and #88 was opened to delete the duplicate. That is
ordinary cleanup, and the reasoning behind it was correct as far as it went.

It did not go far enough, and the gap is the reason for this ADR.

At the time `main` required exactly one status check: `verify`, from `ci.yml`.
`BDD / Scenarios` and `Software Fitness / Self-compliance` reported on every
pull request and gated none of them. So deleting `ci.yml`'s step would have
moved the loadability assertion from the only merge-blocking job onto a job that
reported without blocking. A bundle Chrome cannot register would have left
`verify` green — and with auto-merge armed and `required_approving_review_count`
at zero, it would have merged.

**Nothing would have gone red.** `npm test` passed. The fitness suite still ran
the check. The check could still fail. Failing had simply stopped meaning
anything.

ADR 0010 says the rule "lives in one place and is reported from two", and adds
that "a second *implementation* drifts; a second *reporter* of the same function
cannot." Both sentences are true and neither is the property that was needed.
They are claims about **authorship**. Whether a reporter may be dropped is a
question about **enforcement**, and the two had never been distinguished because
until then the surviving reporter happened to be the required one.

That is the shape this repository keeps finding, in
[#179](../../issues/179) and again in [#194](../../issues/194): the failure that
produces no red. A workflow that dies at startup emits no check run. A gate that
reports but does not block emits a green one. Neither is visible from the tests,
and both look exactly like success.

## Decision

**Every check in `fitness/self/cli.ts`'s `CHECKS` must be reachable from a
context named in `REQUIRED_CHECKS`.** Reachable means the chain holds end to
end:

1. a context in `REQUIRED_CHECKS` is emitted by a **job** that runs
   `npm run … fitness:self`;
2. the `fitness:self` script runs `fitness/self/cli.ts`, which owns `CHECKS`;
3. `CHECKS` covers every file in `fitness/checks/`.

Break any link and a check keeps running, keeps being able to fail, and stops
being a gate.

Two consequences follow directly, and both are ordering rules rather than
preferences:

**A reporter may be deleted only after the surviving reporter is required.** Not
"is green", not "runs on every pull request" — *required*. #88's own ordering is
the worked example: the ruleset changed under #194 first, the declaration
followed in [#202](../../pull/202), and only then did the duplicate step and the
shim go.

**A check added to `fitness/checks/` inherits the gate, or it inherits
nothing.** Registering it in `CHECKS` is what puts it behind the required
context; a check that runs somewhere else is a report.

The rule is job-scoped, and that is not a detail. A file-wide search for
`fitness:self` across `bdd-and-fitness.yml` passes whether the command sits in
the required job or the one beside it, which is precisely the distinction #88
turned on. A guard written that way would reproduce the bug it was built to
catch.

### What this does not say

It does not say every check must be required. ADR 0012's rule still decides
which *contexts* may be required at all — a check may be required only if it
reports on every pull request — and ADR 0018 adds that the context must have
been observed reporting on a pull request's head before it joins the list.
This ADR sits downstream of both: given the contexts that are required, every
fitness check must be behind one.

It does not make `ci.yml` the wrong place for a check. `verify` is required, so
an assertion living there is gated. What it forbids is *moving* an assertion out
of a required context and calling the move a de-duplication.

It says nothing about tests outside `fitness/checks/`. `npm test` runs inside
`verify`, which is required, so the same property holds there for a different
reason and needs no rule.

## Consequences

The rule is executable rather than advisory.
[`test/fitness/suite.test.ts`](../../test/fitness/suite.test.ts) asserts links 1
and 2 offline, in every `npm test`; link 3 is that file's opening test and is
referenced rather than repeated, because two copies of an assertion drift.
Reverting `REQUIRED_CHECKS` to `['verify']` turns it red — which is to say the
guard fails in exactly the world where #88's original commit was written.

`ci.yml` loses its bundle step and `scripts/check-bundle.mjs` is deleted, so
`npm run fitness:self` is the rule's single caller. ADR 0010's "reported from
two" now describes a transitional state that has ended, and carries an amendment
saying so.

The cost is a real one and belongs on the record: deleting a reporter removes a
second, independent chance to notice. `bundle-shape` now fails in one place
instead of two, and if `Software Fitness / Self-compliance` ever stops being
required, the check goes quiet rather than loud. That is the exact failure this
ADR exists to prevent, which is why the guard asserts the requirement rather
than trusting the ruleset to stay put — and why
[#200](../../issues/200) matters: the live half of
`test/branch-protection.test.ts`, which compares the declared list against
GitHub's, is skipped unless `CHECK_LIVE_BRANCH_PROTECTION=1` is set, and no
workflow sets it. The offline chain this ADR guards is binding. The tie between
the declared list and the live ruleset is not, yet.

There is a second cost worth naming, because it is the one that produced this
ADR rather than a code comment. #88 was correct in isolation and wrong in
context, and no reviewer of the diff alone could have seen it — the missing fact
was in a ruleset, not in the tree. Written down, the rule is checkable by
someone reading only the repository.

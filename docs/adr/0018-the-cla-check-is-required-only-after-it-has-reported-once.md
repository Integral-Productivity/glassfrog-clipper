# The CLA check is required only after it has reported once

Date: 2026-09-03

## Status

Accepted

Extends ADR
[0012](0012-auto-merge-is-armed-by-requiring-exactly-one-check-on-main.md),
which stands in full. 0012 decided *how many* checks `main` requires and why;
this decides the condition a check must meet before it joins them, using the
CLA gate from [#179](../../issues/179) as the case that forced the question.

## Context

`.github/workflows/cla.yml` concluded `startup_failure` on all 152 of its runs,
from two minutes after the file was created. The gate the workflow exists to
enforce — the one CLA.md calls unbypassable — has never been applied to anyone.
The cause is recorded in
[a startup failure hides its reason, so bisect the workflow](../solutions/workflow-issues/a-startup-failure-hides-its-reason-so-bisect-the-workflow.md):
the repository's allowed-actions policy admits GitHub's own actions and
Marketplace verified creators, and `contributor-assistant` is neither, so
naming the action fails the run before a job exists.

The obvious remedy to *the invisibility* is to require the check, and #179
proposes exactly that as its fifth acceptance criterion. The obvious remedy is
not safe yet, for a reason that only showed up under measurement.

**A startup failure emits no check run at all.** Verified on run
`33737439989`: `/actions/runs/33737439989/jobs` returns `total_count: 0`, and
the run's check suite `91427999604` returns `total_count: 0` check runs. The
commit's own check-runs list carries no `CLA` entry.

So a required CLA check would not have gone red through any of those 152 runs.
It would have reported *nothing*, and a required check that reports nothing
pins every pull request at "Expected — waiting for status to be reported"
forever. That is ADR 0012's stated failure mode, reached from a direction 0012
did not anticipate: 0012 reasoned about workflows **filtered by path** and
therefore silent on some pull requests, and concluded that a check may be
required only if its workflow runs on every pull request. `cla.yml` satisfies
that test — its `pull_request_target` trigger carries no path filter — and
would still have deadlocked the repository, because *running on every pull
request* and *reporting on every pull request* are not the same property.

Two further things were unknown when this decision was drafted, and were
deliberately written down as unknown rather than reasoned out, because
reasoning things out is what produced #179's 152 silent failures. The
organisation-level policy fix landed the same day, run **#164** started, and
both are now **observed** rather than argued:

1. **The check's context name is `cla`.** As expected — `cla.yml` declares a
   job id of `cla` with no `name:` override, the same rule that makes
   `ci.yml`'s job id the required `verify`. Expected and observed are still
   different things, and this is now the second.
2. **A `pull_request_target` check does report against the pull request's
   head.** This was the live worry: required status checks are evaluated on
   the head SHA while `pull_request_target` runs against the base ref, and
   every check required here comes from a `pull_request` workflow, so there
   was no local instance to reason from. Runs #164 and #166 settle it — both
   are `pull_request_target`, and each records its `cla` check against the
   pull request's head (`dc890cd`, then `ec22248` after an amend). So the
   trigger is no obstacle to requiring it.

   The first reading of this added "and absent from the base", which was true
   when measured and is not a fact. `cla` check runs *do* accumulate on
   `main`'s head — runs #165 and #167, both `issue_comment`, which execute on
   the default branch. They report `success` trivially: on a comment that does
   not carry the sign phrase the step's `if` is false, so the job succeeds
   having done nothing. Two triggers write the same context to two different
   commits, and only the `pull_request_target` one says anything about a pull
   request. Requiring `cla` means requiring the context that reaches the head;
   a green `cla` on `main` is not evidence of anything.

Both resolved in the permissive direction, which is worth noticing rather
than passing over: the caution cost nothing and the observation was cheap. Had
the guess been written down as settled it would have been *right*, and the
habit that produced it would still have been the one that produced #179. See
[verify the event, not the artifact that implies it](../solutions/workflow-issues/verify-the-event-not-the-artifact-that-implies-it.md).

What run #164 also exposed is a **second, independent defect**, which is now
the blocker in their place. The run reached the action and failed inside it:

> Error occurred when creating the signed contributors file: Repository rule
> violations found. Required status check "verify" is expected.

The action records signatures by committing `.github/cla-signatures.json` to
the branch named in `cla.yml`, which is `main` — and `main`'s ruleset requires
`verify`, so the ruleset rejects the action's own push. No signature can be
recorded, by anyone, ever. That is a collision between ADR 0012's required
check and the workflow's choice of storage branch: each is sound alone. Where
the signature record should live instead is
[ADR 0019](0019-the-cla-signature-record-lives-off-the-protected-branch.md).

## Decision

**A check joins `REQUIRED_CHECKS` only after it has been observed reporting on
a pull request under the name it will be required by.** Not when its workflow
looks correct; not when it runs on every pull request; when a check run bearing
that context has been seen on a pull request's head.

For the CLA gate specifically, in this order:

1. The allowed-actions policy is amended so `contributor-assistant/github-action`
   resolves — a repository or organisation Actions setting, not a change to
   this repository's contents.
2. The workflow completes a run with any conclusion other than
   `startup_failure`, and a test pull request from a non-allowlisted account
   receives the not-signed comment. (#179, criteria 2 and 3.)
3. The context name that check reports under is **read off a pull request**,
   and it is confirmed to report against the pull request's head rather than
   the base.
4. The action can actually record a signature — that is, ADR 0019 is settled
   and `.github/cla-signatures.json` exists because someone signed. A check
   that fails for every contributor is not a gate; requiring it would block
   every merge, including the merge that fixes it.
5. Only then does that name go into `REQUIRED_CHECKS` in
   `test/branch-protection.test.ts`, with a `CHECK_SOURCES` entry naming
   `cla.yml`, and into `main`'s ruleset in the same change — the live test at
   `test/branch-protection.test.ts` fails when those two disagree, which is the
   mechanism that makes this ordering binding rather than a good intention.

Steps 1, 2 and 3 are done. Step 2 closed on run #164, which posted the
not-signed comment on #180 with the custom text and the live `CLA.md` link.
Worth recording *why* it asked: #180 was opened by an allowlisted account, but
the commits are authored by `Claude <noreply@anthropic.com>`, which is not on
the allowlist. The action checks commit authorship, not who opened the pull
request. Step 4 is open and is now the binding constraint. Until it closes,
`cla` stays out of `REQUIRED_CHECKS`.

The first version of that sentence read "`REQUIRED_CHECKS` stays `['verify']`
and ADR 0012 is unmodified", which conflated two separate things and went stale
within the day. `REQUIRED_CHECKS` is now
`['verify', 'BDD / Scenarios', 'Software Fitness / Self-compliance']` and ADR
0012 carries an amendment — both from [#194](../../issues/194), which has
nothing to do with the CLA. What this ADR governs is whether **`cla`** joins
that list, not how long the list is. The correction is worth leaving visible:
writing a general rule and then pinning it to an unrelated variable is how a
rule acquires a false expiry.

The two contexts that did join satisfy this ADR's rule rather than bypassing it.
Both were observed reporting `success` on a pull request's head (#193, head
`1467da71`) before the ruleset required them — the step-3 evidence, gathered
for a different gate.

## Consequences

The CLA stays bypassable for as long as steps 1 to 4 take, on a public
repository. That is the cost, and it is accepted with its eyes open: the
alternative is requiring a name nobody has seen, on a trigger whose reporting
behaviour nobody here has observed, which risks converting a gate that
currently fails open into one that blocks every merge including the fix.

The rule generalises past the CLA. Every check this repository requires from
now on carries the same debt of observation, and the cheapest moment to pay it
is the first pull request the check reports on, not the change that requires
it.

It also names the thing 0012 was one step away from. 0012's table asks "reports
on every PR?" and answers it by reading triggers and path filters out of the
workflow files. That answers *would it be silent by configuration*. It cannot
answer *is it silent by failure*, because a workflow that dies at startup has
the same file as a workflow that works. Only the pull request knows.

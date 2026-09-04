# The diff comparison is the gate for carrying an authorship note

Date: 2026-09-04

## Status

Accepted. Amends [ADR 0009](0009-ai-authorship-survives-a-squash-only-where-the-diff-is-unchanged.md),
whose Decision this narrows: conditions 1 and 3 are replaced, condition 4 is
kept and becomes the whole gate.

Resolves [#163](../../issues/163). Related to
[#130](../../issues/130) and [ADR 0012](0012-auto-merge-is-armed-by-requiring-exactly-one-check-on-main.md),
which is where the pressure comes from.

## Context

ADR 0009 set four conditions for copying a note onto the squashed commit, and
said plainly which one mattered:

> Condition 4 is the actual correctness guard. The commit count is a cheap
> proxy; the diff comparison is the thing that establishes the line ranges still
> describe the code.

The implementation did not agree with that sentence. Measured on 2026-09-03:

```
gh run list --workflow=ai-authorship-notes.yml --limit 60 --json conclusion
[{"c":"skipped","n":10},{"c":"success","n":10}]
```

**Half of every run this workflow has ever had was skipped.** Two independent
mechanisms produced that, and each is a case where the information needed was
present and the workflow could not reach it.

**The proxy fought the ruleset.** `main` runs with
`strict_required_status_checks_policy`, so a branch that falls behind must be
brought current before it merges. `gh pr update-branch` and auto-merge's own
update both reconcile with a **merge commit**, which makes `commits > 1` and
disqualified the pull request. Complying with the ruleset is what broke the
attribution.

**The note was read from `head.sha` alone.** After any branch update, `head.sha`
*is* that merge commit, and a merge commit never carries a note — the note is on
the authored commit underneath it. So even a pull request that satisfied the
count could report "nothing to copy".

PR [#147](../../pull/147) is the worked example, and it is the reason this ADR
exists rather than a habit note. The note was on `495b548`. `head.sha` was
`001a2377`, an `update-branch` merge commit. And:

```
git diff 495b548^ 495b548   →  13,444 bytes
git diff 371177a^ 371177a   →  13,444 bytes, byte-identical
```

**Condition 4 would have passed.** The transfer was provably sound by ADR 0009's
own standard, and was skipped by its proxy. The note was repaired by hand
afterwards, mechanically, which is the tell: nothing was missing but reach.

There is a third property that made all of this cheap to ignore. The conditions
lived in a **job-level `if:`**, so a failing one skipped the entire job — no
steps, no runner, an empty log. Every `::warning::` in the file was unreachable,
and a forfeited note was indistinguishable at a glance from a healthy no-op on a
hand-written change. The loss was never counted because nothing counted it.

## Decision

**The byte-identical diff comparison is the gate. Nothing else is.**

1. **The commit count is not a condition.** It is reported as an observation, so
   the ratio above can be re-measured without reading every run by hand.
2. **The note is sourced from any commit in the pull request that carries one**,
   head first — so the ordinary one-commit case reads nothing else — and the
   chosen commit's diff must be byte-identical to the squashed commit's.
3. **No gate lives in the job-level `if:` except the two that make the job
   meaningless**: the pull request merged, and it came from this repository
   rather than a fork. Everything else is evaluated inside, where it can speak.
4. **A note that exists and cannot be carried emits a warning.** `forfeit` and
   `none` are different outcomes and the workflow says which.

Widening *where the note is read from* does not widen *whether it is correct*.
The diff comparison is unchanged, and it refuses to publish attribution whose
line ranges do not describe the landed diff. That is what makes 2 safe.

The selection is a pure module, `scripts/authorship-note-source.ts`, called by
the workflow and exercised by `test/authorship-notes-workflow.test.ts` — which
also pins the #147 shape, because a rule this repository got wrong once should
not be re-derivable only by reading YAML.

## Options considered

**A. Keep `commits == 1` and rely on rebasing.** Rejected. It is already
documented and already lost to `update-branch`, which is what both the CLI and
the auto-merge UI nudge toward. A convention maintained by remembering is the
failure mode this repository keeps re-encountering, and #126 has since automated
branch updates — with `--rebase`, but the shape recurs whenever anyone uses the
bare form by hand.

**B. Drop the count, keep reading `head.sha`.** Rejected as half a fix: the
`head.sha` failure fires independently and would have left #147 skipped anyway.

**C. Warn only, change nothing.** Rejected as insufficient, though it is a
strict improvement and was considered as a first step. It makes the loss visible
without reducing it, and the loss is mechanical to prevent.

**D. Make the count a hard gate on `main`.** Rejected. `copy-note` runs on
`pull_request: closed`, so requiring it would pin every open pull request at
"Expected — waiting for status to be reported" forever — the exact trap ADR 0012
documents.

## Consequences

Multi-commit pull requests can now land **with** attribution, where their
squashed diff happens to match a single authored commit's. That was previously
impossible by construction, and it is sound for the same reason the one-commit
case is.

The job now runs on every merged same-repository pull request rather than
skipping. That costs a runner-minute on merges that carry no note, and buys the
distinction between "no note existed" and "a note was forfeited" — which is the
number #163 asked to be able to re-measure.

**This does not make attribution complete, and the README should not start
implying it does.** A genuinely multi-commit change whose squashed diff matches
no single commit still lands unattributed. That is ADR 0009's position and it is
unchanged: absent attribution beats wrong attribution.

Re-measuring the skipped/success ratio is left to #163, deliberately — the
number is only meaningful after a period of real merges, and recording a figure
here on the day of the change would be the kind of claim this repository has a
solutions document about.

# The code-review check is advisory, and the notice is the guarantee

Date: 2026-09-03

## Status

Accepted

Amends the enforcement half of [#135](https://github.com/Integral-Productivity/glassfrog-clipper/pull/135),
which closed [#108](https://github.com/Integral-Productivity/glassfrog-clipper/issues/108).
Everything #135 established about *detecting* silence stands. Only what happens
on detection changes.

## Context

[#108](https://github.com/Integral-Productivity/glassfrog-clipper/issues/108)
was opened because `Claude Code Review` concluded green on every pull request
while posting nothing, across roughly $4.30 of model spend. Its stated
requirement was precise, and worth quoting rather than paraphrasing:

> the gap is that **a clean pass and a no-op are the same observable event.**
> Any acceptable fix has to make those two distinguishable

It then listed three ways to do that, of which #135 took two: make the reviewer
speak on a clean pass (`--comment`), *and* assert an artifact exists, failing
red when none does.

The first worked. PR #180 carries a real review, the first in this
repository's history.

The second has since been measured, and the measurement is
[#186](https://github.com/Integral-Productivity/glassfrog-clipper/issues/186):
**the reviewer has posted one review, ever.** It is silent on roughly seven
pull requests out of eight. Four hypotheses for why have been raised and
killed — docs-only, early bail by duration, "Claude has already commented",
and upstream plugin drift. The cause is not isolated, and isolating it needs
`show_full_output` live on `main` across an unrelated contributor's pull
request, which is a cost nobody has agreed to pay.

So the red is not a signal about the pull request it appears on. It is the same
signal on almost every pull request, about an upstream defect that no author
can act on.

## Decision

**The artifact assertion is advisory. It posts its notice and exits 0.**

`::error::` becomes `::warning::`, `exit 1` becomes `exit 0`, and the notice
text is rewritten — it previously told the reader the job was "failing red",
which beside a green check would be exactly the contradiction the notice exists
to spare them.

**The notice is now the whole guarantee, and it is load-bearing.** #108's
requirement was that a clean pass and a no-op be *distinguishable*. A comment
on the pull request reading "the diff was not reviewed" delivers that on its
own. The exit code was never what made the two distinguishable; it was what
made one of them *stop work*.

`test/review-workflow.test.ts` moves with it. The test that asserted "a silent
run fails red" now asserts the silent path still calls `notify`, and separately
that the notice does not claim a red the step no longer produces.

### What is not being decided

This is not a judgement that the review is unimportant, and it does not touch
[ADR 0012](0012-auto-merge-is-armed-by-requiring-exactly-one-check-on-main.md):
`Claude Code Review` was never a required check, so nothing about `main`'s
ruleset changes. The gate being lowered is the job's own exit code, not
anything `main` enforces.

## Consequences

**Green on this check now means "no opinion offered", not "no issues found".**
That is a genuine loss of information, and it is why the notice must say so in
the pull request itself rather than only in a run log. A reader who sees green
and no comment is entitled to read it as reviewed; a reader who sees green and
a comment saying "not reviewed" is not misled.

**Green and wordless is the state that must never return.** If the `notify`
call on the silent path is ever removed, the red has to come back with it —
that combination is #108 verbatim. The guard test says this in the assertion
message so that whoever removes the notice reads it at the moment they do.

**This trades noise for the risk of habituation.** A red on seven pull requests
out of eight teaches people to ignore it, which is how a real signal gets
missed later; an advisory notice on seven out of eight risks the same thing
more quietly. The mitigation is #186 staying open, not this ADR.

**Reversal is cheap and should happen if #186 closes.** Once the reviewer
actually reviews, silence becomes rare and therefore informative again, and a
rare red is worth stopping for. This decision is scoped to the period in which
the reviewer is known-broken, and it should be revisited the moment that stops
being true.

# Operator errands carry a runbook, not just acceptance criteria

Some issues in this repository cannot be resolved from the source tree at all.
Registering an account, paying a fee, taking screenshots in a real browser,
running a build on a device, configuring a developer portal — these are
**operator errands**, and they are finished by a person acting in the world.

This document is the convention for how such an issue is written. It applies
when the issue is filed, not only when someone comes back to retrofit it.

## The rule

An issue labelled [`operator-errand`](triage-labels.md#markers--orthogonal-any-number)
must carry, in its body:

1. **An executable runbook.** Numbered, in order, specific enough to follow
   without re-deriving anything: exact URLs, exact commands, exact field values,
   and an explicit marker on any step that is irreversible — placed in the order
   that makes the irreversibility safe.
2. **A block addressed to agents**, saying that an agent picking the issue up
   should *walk the operator through the runbook*. Not attempt the operator's
   steps; not hand the issue back as a vague "this is manual".

[#164](https://github.com/Integral-Productivity/glassfrog-clipper/issues/164)
is the worked example — written to this shape from the start, rather than
retrofitted.

## Why acceptance criteria alone are not enough

An operator issue that states only what "done" looks like makes every future
session re-derive the mechanics, and re-derivation is where the irreversible
details get lost.

[#105](https://github.com/Integral-Productivity/glassfrog-clipper/issues/105)
is the case that produced this convention. It sat open describing "a $5 fee and
a display name". What registering actually committed to was an account email
that can never be changed, a publisher believed at the time to be
one-per-lifetime, and a mandatory EU trader declaration that publishes the
company's postal address and phone number. All three change the decision. None
of them were in the issue. Two of them turned out not to survive a careful
reading of Google's own documentation — which is the other half of the point:
the mechanics were checkable, and nobody had checked them.

## A wrong runbook is worse than none, because it gets followed

Where the mechanics have not been researched, **say so in the runbook** rather
than writing a plausible one. Mark the step, state what is unverified and what
the expected shape is, and ask the operator to correct the issue afterwards from
what they observed.

A step that reads *"Unverified — this is reasoned from X, not observed"* costs
the operator one moment of care. A confidently wrong step costs them the errand,
and sometimes costs something that cannot be taken back.

The corollary: an agent walking an operator through a runbook **checks the
verifications rather than assuming them**. "Read the state back" is a step, not
a formality — a command that exits 0 has not told you the flip landed.

## `operator-errand` versus `ready-for-human`

`ready-for-human` is the wider set: it means the next step is a **decision** — a
trade-off, a naming choice, a strategy call. A code defect awaiting a design
call carries it too.

`operator-errand` means the next step is an **action**, and the decision behind
it may already be settled. The two compose: most operator errands are also
`ready-for-human` while the decision to do them is still open, and stay
`operator-errand` after it is made.

That distinction is why the label exists. Filtering on `ready-for-human` returns
the errands mixed in with every open judgment call, which is exactly the search
that made #105 easy to leave alone.

## Where this is enforced

[`.github/workflows/operator-runbook-drift.yml`](../../.github/workflows/operator-runbook-drift.yml),
nightly at 07:50 UTC and on demand. For every **open** issue carrying
`operator-errand` it asserts two things, and reopens a standing issue naming
what is missing when either fails:

1. a `## Runbook` heading with at least two numbered steps beneath it;
2. a block addressed to agents — a heading naming them, as
   [#164](https://github.com/Integral-Productivity/glassfrog-clipper/issues/164)
   has, or the instruction to *walk the operator through* it wherever it appears.

The rules are pure functions in [`scripts/operator-runbooks.ts`](../../scripts/operator-runbooks.ts)
and are exercised offline by `test/operator-runbooks.test.ts`; only
[`scripts/check-operator-runbooks.ts`](../../scripts/check-operator-runbooks.ts)
talks to GitHub.

**It reports; it does not block a pull request.** Reading issue bodies needs the
API, and a check that needed a token could not run in `npm test` — it would fail
red on a fork and on any clone without one. That is the split
[`triage-labels.md`](triage-labels.md) already describes for labels, reused here
rather than a third pattern invented. The severity is right too: a missing
runbook is a debt to schedule, and blocking somebody's pull request over
somebody else's issue body would be the wrong lever.

Two decisions worth stating rather than leaving to be inferred:

- **Open issues only.** A closed errand's runbook is history — nothing can act on
  it, and re-reporting it nightly is noise that trains people to skip the report,
  which is this check's own failure mode arrived at from the other side.
- **Structure, not a heading.** A `## Runbook` heading alone is checkable and
  gameable. A runbook is an ordered list of things to do; one that is not ordered
  is a description, so two numbered steps is the floor.

One deliberate loud edge: if **no** open issue carries `operator-errand`, the run
emits a warning rather than passing quietly. The label had zero members until
[#198](https://github.com/Integral-Productivity/glassfrog-clipper/issues/198)
pushed it to GitHub and applied it, and a green run over an empty candidate set
is exactly the shape
[`a-gate-that-fails-green-is-the-one-you-will-not-find.md`](../solutions/workflow-issues/a-gate-that-fails-green-is-the-one-you-will-not-find.md)
warns about.

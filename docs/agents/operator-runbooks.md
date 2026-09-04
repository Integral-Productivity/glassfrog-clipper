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

Nowhere automatically, today, and that is a known gap rather than an oversight:
this is a convention with an artifact and no enforcement, which is precisely what
[#46](https://github.com/Integral-Productivity/glassfrog-clipper/issues/46)
observed about the triage vocabulary one document over. The failure is the silent
kind — an `operator-errand` issue filed without a runbook produces no red signal
anywhere.

The check is tracked in
[#196](https://github.com/Integral-Productivity/glassfrog-clipper/issues/196).
It reads issue bodies, so it needs the GitHub API and therefore belongs on the
scheduled, reporting side of the split that
[`triage-labels.md`](triage-labels.md) already describes — never blocking a pull
request, the way `label-manifest.test.ts` can afford to.

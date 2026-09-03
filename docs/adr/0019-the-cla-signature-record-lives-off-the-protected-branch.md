# The CLA signature record lives off the protected branch

Date: 2026-09-03

## Status

**Accepted** 2026-09-03.

It was drafted as `Proposed` — the first ADR in this repository to carry that
status — because where a licensing record lives is not a coding detail to be
settled by whoever happens to touch the file, and one side of the collision is
[ADR 0012](0012-auto-merge-is-armed-by-requiring-exactly-one-check-on-main.md).
That status is kept in the history rather than erased: the decision was put and
taken, not assumed.

Blocks step 4 of
[ADR 0018](0018-the-cla-check-is-required-only-after-it-has-reported-once.md).

## Context

The CLA workflow has never recorded a signature. Until 2026-09-03 that was
because it never ran at all
([#179](../../issues/179)); once the organisation-level allowed-actions policy
was amended, run #164 reached the action and failed inside it:

> Error occurred when creating the signed contributors file: Repository rule
> violations found. Required status check "verify" is expected.
>
> . Make sure the branch where signatures are stored is NOT protected.

`contributor-assistant/github-action` records a signature by **committing
`.github/cla-signatures.json` to the branch named in `cla.yml`**, which is
`main`. `main`'s ruleset requires `verify`. A push from the action is not a
pull request and carries no `verify` check, so the ruleset rejects it.

Both halves are load-bearing and neither is a mistake:

- **The ruleset is ADR 0012's whole mechanism.** `verify` on `main` is what
  arms auto-merge and what stops an unreviewed commit landing.
- **Storing signatures in this repository is CLA.md's stated design.** The
  workflow header is explicit: "Signatures are stored in this repository at
  `.github/cla-signatures.json` — no external service holds them." That is a
  deliberate choice about custody of a licensing record.

So this is not a bug in either decision. It is a collision that only exists
where they meet, and it was invisible for as long as the workflow could not
start — which is the same reason #179 went unnoticed for 152 runs, arriving a
second time.

## Decision

The signature record moves to a dedicated branch that carries no
ruleset — `branch: 'cla-signatures'` in `.github/workflows/cla.yml`, replacing
`branch: 'main'`. One line.

This is the action's own documented remedy ("Make sure the branch where
signatures are stored is NOT protected"), it keeps custody of the record in
this repository as CLA.md promises, and it leaves `main`'s ruleset untouched,
so ADR 0012 needs no amendment.

### The alternative, and why it is not preferred

Add `github-actions[bot]` as a **bypass actor** on `main`'s ruleset, keeping
signatures on the default branch where they are visible.

That is genuinely better on one axis: the record stays where a reader would
look for it. It is worse on the axis that matters more here. It puts a
standing write-bypass on `main` in the hands of a third-party action — the
exact exposure the SHA pin in `cla.yml` was added to bound, whose own comment
reads "pinned by SHA because this is a third-party action holding write access
to the repository." A bypass actor widens that from *write via pull request*
to *write directly to the protected branch*, permanently, for a dependency
this repository does not control.

Trading a protected branch's integrity for the visibility of a JSON file is
the wrong side of that trade.

## Consequences

The signature record sits off `main`, so it is less discoverable: a reader
looking for who has signed will not find it in the default branch. This is
the real cost and it should be paid down by pointing at it — CLA.md gaining a
line naming `cla-signatures` as the branch of record.

`.github/cla-signatures.json` will not exist on `main`. #179 lists its
creation as an acceptance criterion; on this decision that criterion is met on
the `cla-signatures` branch instead, and #179 should be read that way rather
than treated as unmet.

**Correction, 2026-09-03.** This ADR originally said the branch is created by
the action on first signature. That was wrong, and it was never checked before
being written down — in the document whose own argument is that unverified
premises are what produced #179. `src/persistence/persistence.ts` at the pinned
SHA only ever calls `repos.createOrUpdateFileContents` with the configured
`branch:`; there is no branch-creation call anywhere in the action, and
GitHub's contents API requires the branch to exist already. So the first
signature would have failed — silently, inside the `cla` check that nothing
requires, which is #179's failure mode a third time.

`cla-signatures` is therefore **seeded**, as an orphan commit holding
`.github/cla-signatures.json` byte-identical to what the action writes on
creation (`JSON.stringify({signedContributors: []}, null, 3)`, from
`src/setupClaCheck.ts`) plus a README stating the constraint. With the file
present the action takes its `updateFile` path and never needs to create
anything.

The branch must be left out of any ruleset. A future change that protects all branches by pattern would
silently reintroduce this failure — silently, because a signature failure
appears only inside a check that nothing requires. `test/cla-signature-branch.test.ts`
carries the guards, and it is worth being exact about which of them actually
runs:

- **Always.** `cla.yml` does not point signature storage at the protected
  branch, and the branch it does name matches what `CLA.md` and this ADR tell a
  reader. Three surfaces name this branch; a rename that updates some of them
  is the drift that goes unnoticed, so the agreement is asserted rather than
  hoped for.
- **Only when asked** (`CHECK_LIVE_CLA_BRANCH=1`). The branch exists and is
  unprotected. This one needs the network, so it skips by default — which means
  it is *not* a standing guard, and saying otherwise would be the same
  overclaim this ADR was already corrected for once. The standing protection is
  the offline half above.

**This change cannot be verified on the pull request that makes it.** A
`pull_request_target` workflow is read from the *default* branch, so #180 runs
`main`'s `cla.yml` and its `cla` check stays red until this merges. The first
real exercise of the fix is the next pull request opened after that. This is
the same property that makes `pull_request_target` safe to run against
untrusted forks, met from the other side.

Should the visibility cost turn out to bite, the alternative above stays
available and this ADR gets amended rather than reversed: the two differ in
one line of `cla.yml` plus a ruleset entry.

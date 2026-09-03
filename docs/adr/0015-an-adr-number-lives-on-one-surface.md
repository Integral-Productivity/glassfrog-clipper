# An ADR number lives on one surface

Date: 2026-09-02

## Status

Accepted

Amends [An ADR number is defended at three points, not one](0013-an-adr-number-is-defended-at-three-points-not-one.md).
Its belt and suspenders stand unchanged; this replaces the third layer it
deferred. Resolves the decision [#115](../../issues/115) was opened to force.
Builds on [#42](../../pull/42) and [#54](../../pull/54), the two renumbers that
are the evidence here.

## Context

ADR 0013 shipped two layers and deliberately left a third open: *stop racing on
the number at all*. It framed that as a choice between allocating at merge time,
deriving the number from the pull request, and something date-ordered — three
ways to make a collision impossible. Issue #115 was opened to pick one.

Looking outward first changed the question. This is not a novel problem and the
prior art does not agree with the framing.

[**log4brains**](https://github.com/thomvaill/log4brains) hit exactly this and
[wrote it up](https://thomvaill.github.io/log4brains/adr/adr/20201016-use-the-adr-slug-as-its-unique-id/):
it moved from `NNNN-` to `YYYYMMDD-slug` and made the slug the identity, to end
merge conflicts. That is #115's third option, already argued and already in
production, and when a user
[asked for numbers back](https://github.com/thomvaill/log4brains/discussions/72)
the answer was that the project will not go back.

[**MADR**](https://adr.github.io/madr/), the most widely used ADR template,
kept `NNNN-` sequential numbering and has no collision crisis. What it does not
do is put the number in the heading. Its own
[ADR 0002, *Do not use numbers in headings*](https://adr.github.io/madr/decisions/0002-do-not-use-numbers-in-headings.html),
removes it, for three reasons: it matches ordinary markdown practice, it
*enables renaming easily*, and it lets an ADR be copy-pasted between
repositories without number surgery.

That second reason is the one this repository needed. Read the two incidents
again with it in hand:

- **#42** renamed the queue-health ADR `0005` → `0006` with a pure `git mv` —
  100% similarity, no content touched. That is the correct instinct and the
  cheapest possible repair. It produced a broken ADR only because *this
  repository* keeps a second copy of the number in the `# N.` heading, which the
  rename could not reach.
- **#54** then repaired that heading by hand, and `headingNumberMismatches()`
  was written to catch the next one.

So the collision was never what cost anything. **Losing the race costs one
`git mv`; it only became a defect because the number was written down twice.**
0013 counted three defence points and did not count the number's second home.
A third home was hiding as well: fifteen cross-reference link texts of the form
`[GlassFrog v5 has no role-less write path](0003-…)`, generated to mirror the
heading, each one a copy that a rename cannot reach either.

Against that, the three schemes #115 listed all buy the same thing — collision
impossibility — at prices worth naming:

- **Merge-time allocation** is the `xxxx-` placeholder pattern MADR's community
  already uses by hand, automated. It needs a bot that renames the file,
  rewrites the heading and updates inbound references during a merge; it has to
  interleave with squash auto-merge ([ADR 0012](0012-auto-merge-is-armed-by-requiring-exactly-one-check-on-main.md)),
  since a bot push re-triggers `verify`; and no ADR can cite another until after
  it merges.
- **Deriving from the pull request number** works and keeps a short handle, but
  the research found nobody doing it. No tooling, no prior art, every edge case
  ours — and the filename cannot be chosen until the pull request exists.
- **Date-ordered slugs** are proven, and cost the short stable handle. Around
  forty citations in this repository read `ADR 0006`, `ADR 9`, `docs/adr/0010`,
  in README, CONTRIBUTING, PRIVACY, nine test files and the plan documents.

Each of those pays a real, permanent price to prevent a failure whose repair,
once the number has one home, is a single command.

## Decision

**Sequential `NNNN-` allocation stays. The number lives on the filename and
nowhere else.**

Concretely:

1. **Headings carry the title only.** `# 13. An ADR number is defended…`
   becomes `# An ADR number is defended…`, for all thirteen existing ADRs and
   every future one. This adopts MADR's ADR 0002.
2. **Cross-reference link texts carry the title only**, for the same reason:
   `[GlassFrog v5 has no role-less write path](0003-…)` becomes
   `[GlassFrog v5 has no role-less write path](0003-…)`.
3. **The heading rule in `fitness/checks/adr-numbering.ts` inverts.** It used to
   require a heading to repeat its filename's number; it now fails a heading
   that carries one. A file with no heading at all is still reported — inverting
   a rule must not turn its blind spot into a pass.
4. **The collision rule is untouched, and `scripts/check-adr-claims.ts` and
   `scripts/adr-claims.ts` are kept.** #115's acceptance criteria anticipated
   deleting them as dead code guarding an impossible state. Under this decision
   the state is not impossible — it is cheap — so they remain load-bearing as
   0013's suspenders: an early warning while both branches are still open.
5. **Existing numbers are frozen.** 0001–0013 keep the numbers they have. There
   is nothing to migrate, because the allocator did not change.

This is a different answer to #115 than the one it asked for. It does not make
collision impossible. It makes collision cost a `git mv`, and it removes the two
surfaces that turned a rename into a defect twice.

## Consequences

Renumbering an ADR is now `git mv 0007-x.md 0008-x.md`, with the file itself
needing no further edit. That is the whole point, and it is what #42 attempted
before the convention made it wrong. It is not a claim that a renumber is
free: citations *by number* elsewhere — `ADR 0006`, `docs/adr/0010` — still
have to be updated, and no numeric scheme avoids that. What is gone is the
class of breakage where the file's own contents disagree with its name.

**This ADR was renumbered by its own rule before it merged, which is the
closest thing to evidence available.** It was written as 0014. Five minutes
later [#147](../../pull/147) opened, also claiming 0014 — the fourth
collision in five weeks, and the first to happen after the numbers were
surveyed and found free. `scripts/check-adr-claims.ts`, the suspenders this
decision chose to keep rather than retire, failed `verify` and named both
pull requests. #147 opened first and kept 0014. The repair here was one
`git mv` to 0015 with the heading untouched, plus ten citations by number —
against the old convention it would additionally have meant editing the
heading, and #42 is the record of what happens when that edit is forgotten.

`adr new` from adr-tools still generates a `# N. Title` heading, and this repo
is adr-tools-initialised (`.adr-dir`). Its output no longer conforms and needs
one edit — deleting `N. ` from line 1. The guard fails loudly if that edit is
forgotten, which is the intended trade: a wrong heading is caught by CI rather
than by a reader months later. Automating the generator was considered and not
done; a wrapper is a third thing to maintain to save one deletion.

A reader browsing `docs/adr/` in GitHub's web UI sees headings, not filenames,
and so no longer sees the number on the rendered page. The file list, the URL,
and every citation still carry it. This was the strongest argument for keeping
`# N.` and it is not strong enough to justify a second copy that has drifted
twice in five weeks.

The rule bans the `# N. ` form specifically rather than any leading digit, so an
ADR whose title genuinely opens with a number still reads as a title. That is
narrower than it could be, and deliberately: the banned shape is the one
`adr new` generates, so the guard cannot mistake a decision statement for a
stale number.

Inbound references are unaffected. They cite filenames and prose (`ADR 0006`,
`docs/adr/0010`), never headings, so none of the ~40 needed touching — which is
also the reason freezing 0001–0013 cost nothing.

The collision window 0013 described is still open, and this ADR does not close
it. Two pull requests opened in the same minute still race; the suspenders still
report it; the belt still stops a stale green from merging it. What changed is
that the loser now types one command.

The org-wide question 0013 scoped in
[devops-excellence#629](https://github.com/Integral-Productivity/devops-excellence/issues/629)
was settled while this was being written: #629 closed as completed on 2026-09-03,
recording
[ADR-086](https://github.com/Integral-Productivity/devops-excellence/blob/main/docs/adr/ADR-086-strict-is-a-per-repo-readiness-gate-and-claims-live-in-paths.md),
which makes strict checks a per-repo readiness gate and promotes "a claim is the
creation of a path" to the org-wide rule for `ADR-NNN`, `SAE-NNN`, `IPAT-NNN` and
bare `NNNN-` alike.

ADR-086 and this decision do not overlap, and that is the point worth carrying
across: **ADR-086 hardens how a number is allocated; this reduces what losing the
allocation costs.** Neither substitutes for the other, and the org has now
standardised the first without asking the second question — how many places the
identifier is written down. Every repo running `ADR-NNN` with a `# N.` heading
carries the same second surface this repository just removed, unmeasured. That
audit is filed as
[devops-excellence#642](https://github.com/Integral-Productivity/devops-excellence/issues/642)
rather than settled here, since it is a property of those repositories and not of
this one. A cross-repo reference, which GitHub links but never closes.

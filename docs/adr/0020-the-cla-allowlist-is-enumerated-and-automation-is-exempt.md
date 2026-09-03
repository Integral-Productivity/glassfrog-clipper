# The CLA allowlist is enumerated, and automation is exempt rather than asked to sign

Date: 2026-09-03

## Status

Accepted

Follows [0019](0019-the-cla-signature-record-lives-off-the-protected-branch.md),
which got the CLA gate recording signatures at all. This decides *whom* it asks,
which is the question the gate could not raise while it was broken.

## Context

The CLA gate started working on 2026-09-03, after
[#179](../../issues/179) and #180. The first pull request to reach it exposed
two things about the allowlist, and they point in opposite directions.

**The AI committer can never sign.** Commits authored here as
`Claude <noreply@anthropic.com>` resolve to the real GitHub account `claude`,
so the action lists it among the committers who must sign. It was not on the
allowlist. The directing human signed, which changes nothing: they were already
exempt, and a signature from one account does not satisfy another. Only `claude`
could clear the check, and `claude` will never post a comment. Every AI-authored
pull request would have failed the CLA gate permanently — which, since this
repository publishes line-level AI-authorship notes (ADR 0009), is most of them.

**And an ordinary contributor could be exempted without signing.** The allowlist
read `kraigparkinson,dependabot[bot],bot*`. The action compiles a `*` pattern to
an **unanchored** regex — `checkAllowList.ts` escapes the pattern, splits on the
escaped `*`, joins with `.*`, and calls `RegExp.test`, with no `^` and no `$`.
So `bot*` did not mean "starts with bot". It meant "contains bot". Run against
the shipped configuration:

| login | result |
|---|---|
| `kraigparkinson`, `dependabot[bot]` | exempt — intended |
| `abbott` | **exempt** |
| `robotics-inc` | **exempt** |
| `sabotage-labs` | **exempt** |
| `claude`, `alice` | must sign |

That is the inverse of #179 and it hides the same way. #179 was a gate that
never ran; this is a gate that runs and waves people through. Neither produces a
failure, and an over-broad allowlist produces less signal than a broken
workflow, because the pull request goes green. The CLA exists so one party can
license the whole work. A contributor exempted because their name contains three
particular letters defeats that silently, and the defect shipped with the
workflow's first commit.

## Decision

**The allowlist enumerates accounts. It never globs.**

`allowlist: kraigparkinson,claude,dependabot[bot]` — the accounts that actually
commit here, named. A pattern cannot be anchored from configuration, so a glob
is not a thing to use carefully; it is a thing not to use.
`test/cla-allowlist.test.ts` refuses any entry containing `*`, and separately
asserts that a set of ordinary logins is not exempt, reproducing the action's
own unanchored matcher so the test measures what the action will do rather than
what it should.

**`claude` is exempt rather than asked to sign**, alongside the bots. The CLA
assigns the rights in a contribution so Integral Productivity LLC can license
the whole work. The party those rights run to is the human directing the work,
who is separately on this list and separately bound. `claude` is the identity
that carries the commit, not a party that can hold or assign a right, and it
cannot accept an agreement — it has no capacity to be bound and no comment to
post. Asking it to sign would make the gate unsatisfiable, and a gate nobody can
satisfy is not stricter than one that works; it is just broken, which is what
this repository has spent #179 learning.

This is deliberately narrower than "AI contributions are exempt from the CLA".
The contribution is covered. The *identity* is exempt from being asked, because
the coverage comes from the human on the other side of it.

## Consequences

A bot that starts committing here must be added by name, and its first pull
request will fail the CLA check until someone does. That is the intended cost:
an explicit list fails loudly where a glob failed silently, and the failure
names itself.

Anyone removed from this list blocks every pull request they author, since
neither `claude` nor a bot account can sign. The guard asserts the three current
entries stay exempt for that reason — the failure mode of shortening this list
is as real as the failure mode of globbing it.

The historical exposure is bounded but not zero: `bot*` was live from the
workflow's creation on 2026-08-31 until today. For all but a few hours of that
window the workflow never started at all (#179), so it exempted nobody because
it asked nobody. The gap where it both ran and mis-matched is the afternoon of
2026-09-03, and every CLA run in it was on a branch authored by
`kraigparkinson` or `claude`, both now explicitly listed.

Checked rather than assumed, which is the habit #179 was about:
`git log origin/main --format='%an' | sort -u` returns only Kraig Parkinson and
`dependabot[bot]` across the whole history. No contribution from a login the
glob would have swallowed has reached `main`.

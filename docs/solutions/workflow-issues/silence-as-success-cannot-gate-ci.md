---
title: A tool whose success signal is silence cannot be a CI gate
date: 2026-09-02
category: workflow-issues
module: ci-review-automation
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - An interactive skill, slash command, or CLI is being adopted as an automated CI check
  - A review or audit job reports pass/fail purely through a check colour
  - A check is green on every run and no one can point to what it produced
  - Deciding whether an advisory check is ready to become a required check
symptoms:
  - A check completes green and the PR carries no comment, annotation, or artifact from it
  - Job logs show real work — many turns, real wall time, real cost — and no output posted
  - A run that did nothing and a run that found nothing are indistinguishable from outside
  - Searching for the bot as a commenter across the whole repo returns zero
  - Fixing an earlier skip made the check look healthier without making it informative
root_cause: design_mismatch
resolution_type: process_change
tags:
  - ci
  - code-review
  - claude-code-action
  - check-honesty
  - fitness-functions
  - adr-060
---

# A tool whose success signal is silence cannot be a CI gate

## Context

`.github/workflows/claude-code-review.yml` wires `anthropics/claude-code-action` to the
official `code-review` plugin command, passing
`/code-review:code-review <repo>/pull/<n>`. On the PR that introduced it (#78) the check
went green in 13 seconds, because the action's anti-tampering guard refuses to run a
workflow file that differs from the copy on the default branch. Issue #79 was opened to
re-verify once the file was on `main`.

The re-verification found the guard genuinely gone, and the check still meaningless.

Six runs since it landed:

| PR | Turns | Wall | Cost | Posted |
|---|---|---|---|---|
| #100 | 7 | 22s | $0.16 | nothing |
| #99 | 6 | 24s | $0.14 | nothing |
| #86 | 46 | 120s | $1.61 | nothing |
| #61 | 5 | 22s | $0.16 | nothing |
| #84 | 22 | 96s | $0.55 | nothing |
| #82 | 51 | 264s | $1.44 | nothing |

Every run `"is_error": false`. Every run ending `No buffered inline comments`. Every check
green. The #82 run did the full five-agent fan-out for four and a half minutes, spent
$1.44, and told nobody anything.

```
gh api "search/issues?q=repo:<owner>/<repo>+commenter:app/claude" --jq '.total_count'
0
```

Roughly $4.30 of model spend, zero readable output, and a PR history that reads as fully
reviewed.

### The cause is in the command's design, not the wiring

`commands/code-review.md` in `anthropics/claude-code`, step 6:

> Filter out any issues with a score less than 80. **If there are no issues that meet this
> criteria, do not proceed.**

Its output format has no "found nothing" case. **Silence is its success signal.**

That is a defensible design for the surface it was built for. A human types
`/code-review`, watches the terminal, and sees the process run; a quiet finish reads as
"clean" because the *running* was observed directly. The observation channel and the
findings channel are separate, and only one of them has to carry information.

In CI those two channels collapse into one. The only thing a reader observes is a check
colour. A tool that says nothing when healthy and nothing when broken has, in that
setting, no output at all.

## Guidance

**Before adopting an interactive tool as a CI check, ask what it emits on the happy path.**
If the answer is "nothing", it is not a gate yet, however good its findings are when it
has some.

Three properties a CI gate needs that an interactive tool is not obliged to have:

1. **A positive clean signal.** The healthy path must produce an artifact — a comment, an
   annotation, a summary line. Not because the artifact is interesting, but because its
   *absence* has to mean something.
2. **Failure that is loud where it is read.** A `::warning::` inside a green check is not a
   signal; nobody opens a green check. Fail red, or report grey, in the surface the reader
   actually looks at.
3. **No eligibility gate that excludes your population.** The same command opens with a
   step telling it to stop if the PR "is an automated pull request" — which, in a repo
   where every PR is Claude-authored on a `claude/*` branch, is every PR. A tool can be
   correctly wired, correctly authenticated, and still be configured to skip exactly what
   you installed it for.

**Fix ordering matters and is easy to get backwards.** The instinct is to add the assertion
first — "fail the job if nothing was posted". Do that before the tool speaks on a clean
pass and it fails red on every healthy PR. Make the happy path emit something, *then*
assert the emission.

### The diagnostic that actually settles it

Do not read the check colour, and do not read the job's exit code. Ask whether the
artifact exists, from outside the run:

```
gh api "search/issues?q=repo:<owner>/<repo>+commenter:app/<bot>" --jq '.total_count'
```

Zero across a repo's whole history is unambiguous in a way that a green check never is.

## Why This Matters

This is a green check asserting work that reached nobody, which is the failure mode
devops-excellence
[ADR-060](https://github.com/Integral-Productivity/devops-excellence/blob/main/docs/adr/ADR-060-honest-check-conclusions-for-structurally-tokenless-runs.md)
exists to prevent — its title is literally *"A check that asserts work must never be green
when the work did not run."* ADR-060's guards all key on GitHub structurally withholding
the token, so they cover Dependabot runs and fork PRs and miss this one: the token was
present, the work ran, and the output went nowhere.

Worse, fixing the first skip made this one harder to see. On #78 the failure was legible —
a 13-second run with an explicit validation warning in the log. Today's failure is a
51-turn, four-minute, $1.44 run that looks in every way like a working reviewer. **Moving a
defect inward can make a system look healthier while making it less honest.**

The cost is not the $4.30. It is that anyone reading this repo's PR history — a future us,
or whoever evaluates the licence sale — sees "Claude Code Review" passing on every PR and
reasonably concludes the code was reviewed.

## When to Apply

- Adopting any slash command, skill, or interactive CLI as an automated check
- Reviewing whether an advisory check is ready to be made **required** — if you cannot
  point at what it emitted on a healthy PR, it is not ready
- Auditing a repo where some check has been green on every run since it was added
- Writing a fitness function whose passing state is "no violations found"

## Related

- [Verify the event, not the artifact that implies it](verify-the-event-not-the-artifact-that-implies-it.md) — the same discipline one step earlier; this entry is what happens when the artifact you would have checked does not exist at all
- [Auto-merge is a deferral primitive](diagnose-auto-merge-at-the-base-branch-not-the-token.md) — another repo-level surface that read as configured while doing nothing
- Issue #79 — the verification that surfaced this
- Issue #108 — the defect, and the three decisions taken
- Issue #114 — the eligibility-gate half, deliberately split out
- devops-excellence #630 — the same hole in `reusable-claude-code-review.yml`
- devops-excellence #631 — proposed ADR-060 amendment covering ran-but-emitted-nothing

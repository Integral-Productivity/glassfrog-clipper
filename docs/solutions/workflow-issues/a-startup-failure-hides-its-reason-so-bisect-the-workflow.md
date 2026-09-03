---
title: A startup failure hides its reason, so bisect the workflow
date: 2026-09-03
category: workflow-issues
module: verification-discipline
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - A workflow's runs all conclude `startup_failure` and the API offers no reason
  - A guard is documented and believed to be in force, but nothing has ever gone red on its account
  - An allowed-actions policy is suspected and the repository's Actions settings cannot be read
  - A counterexample appears to clear a hypothesis, and the counterexample differs from the subject in a way nobody has checked
symptoms:
  - Every run of one workflow concludes `startup_failure`, from the first run onward
  - The run has no jobs, its check suite has no check runs, and no annotation carries the error
  - Other workflows in the same repository run green, including ones using third-party actions
  - The file parses as valid YAML and no static reading of it explains the failure
tags:
  - github-actions
  - startup-failure
  - allowed-actions
  - cla
  - bisection
  - unverified-premise
---

# A startup failure hides its reason, so bisect the workflow

## Context

`.github/workflows/cla.yml` concluded `startup_failure` 152 times out of 152
runs, from two minutes after the file was created
([#179](https://github.com/Integral-Productivity/glassfrog-clipper/issues/179)).
The CLA it was built to make unbypassable had therefore never been asked of
anyone, on a repository that had just gone public.

## The reason is not in the API

A `startup_failure` happens before the run has jobs. Confirmed on run
`33737439989`:

- `GET /actions/runs/33737439989/jobs` — `total_count: 0`
- `GET /check-suites/91427999604/check-runs` — `total_count: 0`
- `GET /actions/runs/33737439989/logs` — `404`
- the commit's own check-runs list contains no `CLA` entry at all

So there is no annotation, no failing step, and no log to read. The reason
exists only on the run page in the web UI. **Everything else has to be
established by experiment**, and the experiment is cheap: a probe workflow on
a branch, triggered by `push`, isolating one variable.

## What the bisection found

Five probes, each a `push`-triggered workflow on the working branch:

| probe | isolates | result |
|---|---|---|
| a | the folded `if:` from `cla.yml`, verbatim, on a trivial step | success |
| b | the pinned action referenced but never executed (`if: false`, no permissions) | **startup_failure** |
| c | `cla.yml` byte-identical below the trigger, `push` swapped in | **startup_failure** |
| d | `docker/login-action` — verified creator, never used here | success |
| e | `anthropics/claude-code-action@v1` through the same harness | success |

Probe b is the answer: **naming `contributor-assistant/github-action` is
enough to fail the run**, with the step skipped and the job holding no
permissions. Probe c shows nothing about `pull_request_target` or
`issue_comment` is needed to reproduce it. Probe a clears the `if:`
expression, whose more-indented continuation line survives YAML folding as a
literal newline — suspicious-looking and harmless. Probes d and e show the
harness resolves third-party actions fine, and that a verified creator the
repository has never referenced resolves on first use.

That is the signature of **"Allow \<owner\>, and select non-\<owner\>, actions
and reusable workflows"** with *actions created by GitHub* and *Marketplace
verified creators* permitted. `actions/*` passes as GitHub's. `anthropics/*`
and `docker/*` pass as verified creators. `contributor-assistant` is neither,
and is on no pattern list — so the only step the CLA workflow has is one the
policy forbids, and the run dies before it starts.

**Confirmed, and it is organisation-wide.** The repository owner amended the
allowed-actions policy on 2026-09-03 and reported that it is set at the
**organisation** level, governing every repository in the org rather than this
one. So the failure was never local: any repository under this organisation
that reaches for a non-verified third-party action gets the same silent
`startup_failure`, and the fix has to be made once, in the org's settings,
rather than per repository.

The action itself is fine, which is worth stating because it was checked
first and cost nothing:
`ca4a40a7d1004f18d9960b404b97e5f30a505a08` is exactly `refs/tags/v2.6.1` of
`contributor-assistant/github-action`, fetching that object the way a runner
would succeeds, and `action.yml` is present at that tree
(`using: node20`, `main: dist/index.js`).

## The mistake worth keeping

The first pass **cleared the allowed-actions hypothesis** — the leading
candidate in the issue — on this reasoning: `claude-code-review.yml` runs
`anthropics/claude-code-action@v1`, third-party and pinned by tag rather than
by SHA, and its recent runs are all successes; therefore third-party actions
are not blocked here.

Every clause of that is true, and the conclusion is false. Verified-creator
status is the axis the policy actually sorts on, and it was never checked.
The counterexample was real, and it was not a counterexample.

This is the failure mode of
[verify the event, not the artifact that implies it](verify-the-event-not-the-artifact-that-implies-it.md),
one turn inward: not an unobserved premise this time but an **unchecked
difference** between the subject and the case brought in to clear it. Before a
counterexample retires a hypothesis, name what makes the two comparable — and
if that property has not been observed, the counterexample has not been
observed either.

## Why nothing went red for 152 runs

Two properties held it invisible, and both are general:

1. A `startup_failure` produces no annotation and no failing step — a grey-red
   entry that does not read as a test failure.
2. CLA is not a required check. Through those 152 runs
   [ADR 0012](../../adr/0012-auto-merge-is-armed-by-requiring-exactly-one-check-on-main.md)
   required `verify` alone, and `test/branch-protection.test.ts` pinned
   `REQUIRED_CHECKS = ['verify']`. The list has since grown to three, and `cla`
   is still not on it — [ADR 0018](../../adr/0018-the-cla-check-is-required-only-after-it-has-reported-once.md)
   sets the condition it has to meet first.

Those compound in a way worth noticing. Because a startup failure emits **no
check run at all**, a required CLA check would not have gone red either — it
would have pinned every pull request at "Expected — waiting for status to be
reported", which is ADR 0012's stated failure mode arriving from an unexpected
direction. It would still have surfaced the bug on day one, loudly. A guard
that nothing observes is not a guard, and *documented* is not *in force*.

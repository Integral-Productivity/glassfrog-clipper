---
title: A convention enforced by a skip fails silently — make the skip observable
date: 2026-09-02
category: workflow-issues
module: contribution-conventions
problem_type: convention
component: development_workflow
severity: high
applies_when:
  - A contribution convention is written as a preference while a workflow, hook, or script keys off it mechanically
  - "A CI job gates on a pull-request property in a job-level if:, so a non-matching pull request produces no job and no log line"
  - A condition keys off a mutable property of a pull request that branch protection or a bot can rewrite
  - An ADR's Consequences section promises what a reader will observe when a documented behaviour does not happen
  - Two repository policies each look correct alone and cannot both be satisfied
symptoms:
  - A pull request lands with an artifact the project claims to publish quietly absent, and no check went red
  - "The workflow's ::warning:: diagnostics are unreachable on the path that actually fires, because they live inside a job that never starts"
  - An ADR's Consequences section describes a log line that this path does not emit
  - CONTRIBUTING frames the rule as taste while the machinery treats it as a boolean precondition
  - A compliance rate falls with no change in anybody's behaviour
root_cause: inadequate_documentation
resolution_type: documentation_update
related_components: [documentation, infrastructure]
tags:
  - contributing
  - conventions
  - github-actions
  - git-notes
  - squash-merge
  - silent-failure
  - observability
  - branch-protection
---

# A convention enforced by a skip fails silently — make the skip observable

## Context

This repository's headline claim is a record rather than an assurance. `README.md:87-95` says it publishes "a line-level record of that rather than asking you to take a summary on trust" — `refs/notes/ai`, git-ai authorship notes naming which lines of which files came from an AI session.

[ADR 9](../../adr/0009-ai-authorship-survives-a-squash-only-where-the-diff-is-unchanged.md) settles how that record survives a squash-merge. A note records per-file **line ranges** keyed to one commit's diff, so copying a note onto a squashed commit is sound only when the squash did not reshape the diff. The ADR sets four conditions (`0009:66-73`), and is explicit about which two carry the weight:

> Condition 4 is the actual correctness guard. The commit count is a cheap proxy; the diff comparison is the thing that establishes the line ranges still describe the code.
> — `docs/adr/0009-…:75-77`

That reasoning is sound. What this document is about is what happened to it in practice: where those two conditions ended up living in the workflow, how the resulting convention was written down, and how a second, unrelated repository policy made the convention impossible to satisfy — none of which produced a single failing check.

### The two conditions sit on opposite sides of the job boundary

`.github/workflows/ai-authorship-notes.yml` implements both conditions, in two structurally different places.

The **diff guard** — the one the ADR calls the actual correctness guard — is a step inside the job, at `:118-125`. When it fires it says so:

```
118  if ! diff -q \
119      <(git diff "${HEAD_SHA}^" "$HEAD_SHA") \
120      <(git diff "${MERGE_SHA}^" "$MERGE_SHA") >/dev/null; then
121    echo "::warning::The squashed diff differs from the head commit's diff,"
122    echo "::warning::so the note's line ranges would not describe $MERGE_SHA."
123    echo "::warning::Skipping rather than publishing wrong attribution."
124    exit 0
125  fi
```

The **commit count** — the cheap proxy — is not a step at all. It is a clause in the job-level `if:`, at `:38-41`:

```
38  if: >-
39    github.event.pull_request.merged == true
40    && github.event.pull_request.commits == 1
41    && github.event.pull_request.head.repo.full_name == github.repository
```

A job-level `if:` is evaluated before a runner is allocated. When `commits == 1` is false, **no step of the job runs**, so none of the workflow's carefully written diagnostics — the three `::warning::` lines above included — can execute. There is nothing in the log because nothing ran:

```bash
gh api repos/…/actions/runs/33705670201/jobs \
  -q '.jobs[] | "\(.name) | conclusion=\(.conclusion) | steps=\(.steps | length)"'
# copy-note | conclusion=skipped | steps=0

gh run view 33705670201 --log
# (no output)
```

And `copy-note` blocks nothing, because it is not a required check. The ruleset on `main` requires exactly one context:

```bash
gh api repos/…/rules/branches/main \
  -q '.[] | select(.type=="required_status_checks") | .parameters'
# {"do_not_enforce_on_create":false,
#  "required_status_checks":[{"context":"verify"}],
#  "strict_required_status_checks_policy":true}
```

So a non-conforming pull request merges green, with a grey `skipped` entry among its checks, and the repository's headline record quietly does not cover it.

Hold on to the last line of that response. It is the other half of the story.

### The convention: written as taste, read by a machine as a precondition

The intuitive diagnosis — "nobody wrote the consequence down" — is wrong here, and worth correcting before drawing any lesson. The consequence *is* written down, in two places, plainly.

`CONTRIBUTING.md:60-68`:

> - **One commit per pull request, where that is natural.** Not a gate — a
>   genuinely multi-commit change is fine. The reason is narrow and worth knowing:
>   this repository publishes line-level AI-authorship notes, and those notes
>   record line ranges tied to a single commit's diff. […] A multi-commit pull
>   request therefore lands without attribution rather than with wrong
>   attribution.

`README.md:101-108` says the same to a different audience. Both are accurate; both name the mechanism rather than gesturing at it. This is better documentation than most conventions get.

The gap is not that the consequence is unstated. It is that **the prose ranks the rule as taste while the machinery treats it as a precondition.** The bullet sits in a list called "What we look for," between "Conventional Commits" and "Architectural decisions get an ADR," and it opens by disclaiming force: "Not a gate." Every signal of placement and phrasing says *preference*. The one clause that says otherwise is mid-bullet, after a reassurance that the reader need not worry. A contributor scanning that list takes away "prefer one commit," not "this is the boolean that decides whether my change appears in the record this project stakes its credibility on."

`if: … github.event.pull_request.commits == 1` is not a preference. It is a precondition, expressed in a language with no word for "where that is natural."

The ADR carries a matching imprecision. `docs/adr/0009-…:97-99`:

> Multi-commit pull requests land unattributed, silently by design — the workflow
> logs a notice, but no one is blocked.

"No one is blocked" is accurate. "The workflow logs a notice" is accurate for the diff guard at `:121-123` and **false for the commit-count path**, which is the path a multi-commit pull request actually takes. That sentence sends a reader to the Actions log for an explanation and hands them an empty zero-step job. It is a small error, written by the same author who had just written both guards — which is the point. Skips *feel* like they should leave a trace.

### The turn: the convention became unsatisfiable

Everything above describes a rule that is easy to violate and expensive to violate quietly. The live state is worse than that, and it is worse for a reason nobody chose.

Return to `strict_required_status_checks_policy: true` on the `main` ruleset. That is the "require branches to be up to date before merging" setting, turned on deliberately and for good reasons ([ADR 13](../../adr/0013-an-adr-number-is-defended-at-three-points-not-one.md), issue #116). A pull request that falls behind `main` **must** be brought up to date before it can merge, and GitHub does that by pushing a `Merge branch 'main' into …` commit onto the branch.

That commit counts. `github.event.pull_request.commits` becomes 2. The job-level `if:` goes false. The note is dropped.

**A single-commit pull request is converted into a two-commit pull request by branch protection, with no author involved and no signal.** The author complied with the convention. The convention was then rewritten out from under them by a policy that has nothing to do with authorship notes and no knowledge that it interacts with them.

This is not hypothetical or occasional. It is now the dominant failure mode. Every one of the five most recent skipped runs is a compliant author:

| PR | authored commits | branch-update merges | run |
|---|---|---|---|
| #112 `docs(plan): draw the state a configured capture…` | 1 | 1 | `ddf729c9` skipped |
| #117 `ci(adr): defend an ADR number at three points…` | 1 | 2 | `28f148e4` skipped |
| #118 `docs(solutions): fit a fixture to the platform…` | 1 | 1 | `cf1ee552` skipped |
| #128 `docs(store): write the store URLs…` | 1 | 1 | `37626bc4` skipped |
| #120 `ci: prove the extension still packages…` | 1 | 2 | `0526a51e` skipped |

Every SHA in that table is a *head-branch* commit, read off the runs API and the pull requests. None is guaranteed to resolve in a clone: the head branch is deleted on merge and the squash builds a new commit, so whether `git cat-file` finds one depends on what that particular object store happens to have fetched. That is the same orphaning that made this workflow necessary in the first place. Read them from the pull request, not from `git log`.

Verified per pull request, for example:

```bash
gh pr view 118 --json commits -q '.commits[] | "\(.oid[0:8]) \(.messageHeadline)"'
# 0cc63232 docs(solutions): fit a fixture to the platform, not to the fake
# cf1ee552 Merge branch 'main' into claude/compound-fixture-fitted-to-fake
```

Contrast the three older skips, which are the failure ADR 9 *did* anticipate — genuinely multi-commit branches, with zero branch-update merges among them: #66 (4 commits), #61 (2), #86 (4).

The mode changed and nothing announced it. The first three skips were the accepted cost of a documented trade-off. The last five are a policy collision.

**What triggers it is `main` advancing while the pull request is open — not author carelessness, and not, as it first appears, how long the pull request sat.** #128 was open for two minutes and thirty-five seconds and still fell behind, because three other pull requests were merging in the same window. On a repository with several sessions merging in parallel — the normal state here — falling behind is the common case. A pull request held for a review pass loses its attribution; so does one opened during a busy stretch and merged immediately.

This conflict is filed as **#130**, "ADR 0009's single-commit rule is defeated by the up-to-date-branch requirement," open and labelled `ready-for-human`. It lists four options and deliberately does not pick one, because option 1 turns on whether ADR 9's claimed independence of condition 4 actually holds, and options 3 and 4 are policy calls about what the notes are worth. **That decision belongs to #130, not to this document.**

### Nothing outside that workflow observes the convention

```bash
grep -rln "ai-authorship\|refs/notes/ai\|authorship" test/ fitness/ features/ scripts/ docs/ .github/
# docs/adr/0009-ai-authorship-survives-a-squash-only-where-the-diff-is-unchanged.md
# .github/workflows/ai-authorship-notes.yml
```

The ADR and the workflow. No test, no fitness function, no BDD feature, no script — in a repository that has and uses all four directories. (Run today the same command returns a third hit: this document. That is the only thing that changed, and prose is not a check.)

### Measured

Read off the tree and the API on 2026-09-02 Pacific (2026-09-03 UTC), with `origin/main` then at `ccec3ae`. `main` moved several times during the measurement — sibling sessions were merging throughout — so treat these as a dated sample rather than a constant, and re-derive them with the commands below before citing them:

| surface | value |
|---|---|
| notes on `refs/notes/ai` | 110 |
| naming commits reachable from `origin/main` | 20 |
| naming commits **not** on `main` | 90 |
| commits on `main` since the workflow landed (`4e97d13`, #84) | 17 |
| of those 17, carrying a note | **7** |
| `AI authorship notes` runs | 18 |
| runs whose `copy-note` job was **skipped outright** | **8** |
| skips that were genuinely multi-commit branches (#66, #61, #86) | 3 |
| skips that were one authored commit plus a branch update (#112, #117, #118, #128, #120) | **5** |
| runs whose job actually executed | 10 |
| executed jobs that carried a note | 7 |

ADR 9 measured the prior state on 2026-09-01 — 74 notes, 12 reachable from `main`, 62 orphaned — and sampled 23 recently merged pull requests: 16 one commit, 6 two, one sixteen. Those are its numbers at its date, not current state.

The workflow does work: reachable coverage went 12 → 20. But ADR 9 projected "16 of the last 23, and higher as the norm takes hold" — about 70%. Observed post-workflow coverage is **7 of 17**, about 41%, and **the last six merges to `main` carried zero notes between them**: five skipped outright, and #121, whose job ran and found no note on the head commit at all (`No authorship note on 93d0701… — nothing to copy`; that SHA is another orphaned head-branch commit). The norm did not take hold. It could not; the machinery stopped accepting it.

## Guidance

**A convention is load-bearing if ignoring it changes what the project produces. Write it as a precondition when the machinery reads it as one — and when the mechanism that enforces it is a skip rather than a check, give the skip its own voice, because otherwise the only evidence of the loss is an absence nobody is watching.**

### Tell the three kinds apart

Conventions written as prose preferences fall into three groups, and prose rarely distinguishes them:

1. **Enforced by a failing check.** Ignoring it turns something red. The cost is immediate, attributed to the change that caused it, and impossible to miss.
2. **Enforced by a skip.** Ignoring it removes a behaviour. Nothing fails. The cost is real, deferred, and unattributed — it surfaces later as an absence in an artifact nobody was watching.
3. **Genuinely style.** Ignoring it costs nothing mechanical. Someone may dislike it in review.

The test is one question: **if I ignore this, what changes in the artifacts the project produces?** A check fails (1); an artifact the project claims to produce is not produced (2); nothing (3). Category 2 is load-bearing *regardless of how the prose ranks it*, and "Not a gate" is not evidence of category 3 — here it sat directly above a boolean precondition.

Auditing an existing repo, run the test from the other end: for each convention stated as a preference, find the code that reads it. Nothing reads it — category 3. A guard *inside* a running job — category 1, or a loud 2. A job-level `if:`, a `paths:` filter, `continue-on-error`, `--if-present`, or an early `exit 0` before any diagnostic — a silent 2, and the one worth writing down.

### Ask what else can rewrite the input the condition reads

The commit-count check does not read the author's intent. It reads a field on the pull request, and **anything with write access to the branch can change that field.** Branch protection's up-to-date requirement does exactly that, from a completely different part of the repository's configuration, for reasons that have nothing to do with notes.

That is the generalisable question, and it is not the same as the observability question. For any condition keyed to a mutable property of a pull request, a branch, or a build:

- **who else writes this property?** Branch-update merges, bots that amend or sign commits, auto-formatters, merge queues, `Update branch` clicks, dependency bots pushing to open branches.
- **can the project's own policies put it in a state its own conventions forbid?** Two settings can each be correct alone and jointly unsatisfiable. Read on its own, ADR 13's strictness decision is plainly right. Read on its own, ADR 9's single-commit condition is plainly right. Nothing in either says the other exists.
- **when they collide, which one tells anybody?** Here: neither.

A convention that a contributor cannot satisfy by following it is not a convention. It is a coin flip whose odds are set by unrelated traffic.

### Give the skip a voice — and do not confuse that with fixing the conflict

Two separable problems, two separable remedies. Only the second is contested.

**Observability** is uncontested and cheap. Move the proxy inside the job so it can speak: drop `commits == 1` from the job-level `if:` at `:40`, and check it as the script's first guard, next to the diff guard's existing `::warning::` block:

```bash
if [ "$PR_COMMITS" -ne 1 ]; then
  echo "::warning::This pull request has $PR_COMMITS commits, so the note's line"
  echo "::warning::ranges cannot be carried onto $MERGE_SHA. It lands unattributed."
  exit 0
fi
```

Cost: one runner-minute per multi-commit merge. Buys: a visible annotation on every dropped attribution, an Actions log that matches what ADR 9 already claims it says, and — the part that matters most here — the fact that five consecutive compliant pull requests were being silently disqualified would have surfaced on the first one rather than the fifth.

Note carefully that this changes *what is said*, not *what is carried*. It does not resolve the collision.

**The collision itself belongs to #130.** Its four options range from dropping the commit-count precondition and trusting the diff guard alone, through re-deriving the note after a branch update, to turning the strictness requirement off, to documenting attribution as best-effort. Do not pre-empt that choice here, and in particular **do not reach for "make it a hard gate."** ADR 9 chose partial coverage over wrong attribution deliberately and argues it properly at `0009:50-59`: on a repository whose claim is a record you can check, wrong attribution is worse than absent attribution. Hardening the gate fixes the symptom by discarding the decision — and would now block compliant authors for a commit they did not write.

Two smaller things worth doing regardless of #130's outcome:

- **State the consequence where the decision is made.** CONTRIBUTING is read once, at onboarding; the shape of the branch is decided at every push and re-decided by every branch update. A pull-request template line reaches the author while the choice is live.
- **Measure the absence.** The repository already knows this pattern — `test/branch-protection.test.ts:248` routes a load-bearing premise through a live check rather than through remembering. The equivalent is four commands, and turns silent drift into a number:

  ```bash
  git fetch origin '+refs/notes/ai:refs/notes/ai'
  git notes --ref=ai list | awk '{print $2}' | sort > noted.txt
  git rev-list origin/main | sort > main.txt
  comm -12 noted.txt main.txt | wc -l   # 20 of 110
  ```

- **Correct `0009:99`.** An ADR's Consequences section is where the next reader learns what to look for when something goes quiet. This one currently promises a notice that the live path does not emit.

## Why This Matters

Of the seventeen commits on `main` since the workflow landed, seven carry a note. The last six merges carry none. Eight runs were skipped before a runner started, producing no failed check, no annotation, no log line, no comment — and five of those eight were pull requests whose authors had done exactly what CONTRIBUTING asked.

That is worse than a convention being ignored. A convention being ignored is a human problem with a human remedy. This is a convention that **cannot be complied with** in the repository's normal operating mode, presented to contributors as a matter of taste, enforced by a mechanism that says nothing when it fires, and described by an ADR that promises it says something.

The inversion is the part that generalises. The pull requests that lose attribution are disproportionately the ones that were held open — for a review pass, for a validation step, for a second opinion — and the ones opened while several sessions are merging in parallel. #128 fell behind inside two minutes and thirty-five seconds. Care and throughput both cost you the record. The pull requests that keep it are the ones that got in before anything else moved.

Ordinary review cannot catch any of this. Reviewers look at diffs and at red checks; this produces a clean diff and no red check. The workflow is not defective — it does precisely what it was written to do, correctly. What is missing is any event marking that a documented behaviour did not happen.

Two smaller observations the record supports:

- **The imprecision propagated into the ADR by the same route.** Whoever wrote `0009:99` had just written both guards and still assumed the skip would log something. If the author of the mechanism gets the observability claim wrong inside the document that specifies the mechanism, a reader six months out has no chance.
- **PR #118 is the case in miniature.** It added `docs/solutions/best-practices/test-fixture-fitted-to-fake-not-platform-behaviour.md` — a document about a green suite that was an artifact of a fake. It was a one-commit pull request. Branch protection made it two. Its `copy-note` job was skipped, and it landed unattributed, silently.

That pairing is worth naming, because the two failures look identical from the dashboard and need opposite fixes. A check that passes for the wrong reason has to be made *harder to satisfy*. A check that never runs has to be made *audible*. Both are green.

## When to Apply

- **Writing or reviewing a CONTRIBUTING, style guide, or team norm.** For each item, ask what breaks if it is ignored. If the answer is "an artifact we claim to produce is not produced," write that in the same sentence as the rule, and drop the softening clause — "not a gate" is a claim about consequences, and it was false here.
- **Reading a job-level `if:`, a `paths:` filter, `continue-on-error`, or an early `exit 0`.** These are the syntax of silent enforcement. Whatever they gate is a convention with teeth and no bark. Ask what the author sees when the condition is false; if the answer is "a grey square," add the annotation.
- **Whenever a condition keys off a mutable property of a pull request or branch.** Enumerate everything that can write that property — merge queues, `Update branch`, signing bots, formatters, dependency bots — and ask whether any of them can push the pull request into a shape the convention forbids.
- **When adopting a branch-protection or merge-queue setting.** Ask what else in the repository reads the shape of a pull request. Strictness, merge queues, and required linear history all rewrite branches; conventions keyed to commit count, commit message, or authorship are all exposed to them, and none of the interactions announce themselves.
- **Writing an ADR's Consequences section.** That section is a promise about what the reader will observe. Check the observability claim the way you would check a behavioural one — run the path and read the log.
- **When a documented coverage figure has not been re-measured since it was projected.** ADR 9's "16 of the last 23, and higher as the norm takes hold" was a forecast written as a consequence. Forecasts in ADRs age into facts unless something measures them; this one is now 7 of 17 and falling.

## Related

- **#130** — "ADR 0009's single-commit rule is defeated by the up-to-date-branch requirement." The open decision on the collision described above, with four options and none chosen. This document explains the shape; #130 owns the fix.
- **#126** — "Strict checks are on with no way for a behind PR to converge unattended." The same collision seen from the other side: not "the note is lost" but "the pull request cannot get itself current without help." Two symptoms, one interaction.
- **#155** — "Five commits from one session carry no `refs/notes/ai` note." A *third*, independent way the record loses coverage, and it is worth keeping separate from the two above: the note is never written on the head commit at all, because whatever writes them lives in the operator's environment rather than in this repository. That issue also records the gate ordering precisely — the head-commit note check fires regardless of the commit count, so for a pull request whose head carries no note, squashing to one commit changes nothing. Not every gap in the measured coverage above is the branch-update mechanism; some of it is this.
- `docs/solutions/workflow-issues/verify-the-event-not-the-artifact-that-implies-it.md` — the natural pairing on method, and the discipline that produced every number here: the run conclusions, the ruleset, and `refs/notes/ai` were read live rather than inferred from the ADR. It carries the read-back practices in full; this document does not restate them. The learnings differ at the root: that one is about *how a claim was checked*, this one about *a convention whose enforcement cannot be observed at all and whose compliance was made impossible by a second policy*.
- `docs/solutions/workflow-issues/diagnose-auto-merge-at-the-base-branch-not-the-token.md` — adjacent, the same silence on a different surface: a GitHub feature that is *missing rather than erroring*. Read together, the two describe a platform where "nothing happened" is a common and undiagnosable outcome.
- `docs/solutions/workflow-issues/npm-ci-deletes-node-modules-before-it-fails.md` — the same silence with the fault on the other side of the boundary. Here a convention this repository wrote is enforced by a mechanism that says nothing; there a third-party tool destroys local state and then reports a failure about something else. This one's remedy is to give the silence a voice; that one's is to check the precondition before the destruction. Neither substitutes for the other.
- `docs/solutions/best-practices/test-fixture-fitted-to-fake-not-platform-behaviour.md` — the sibling on the other half of the problem: a check that passes for the wrong reason, versus a check that never runs. It is also the concrete casualty above; the pull request that landed it lost its own attribution to the mechanism described here.
- `docs/adr/0009-ai-authorship-survives-a-squash-only-where-the-diff-is-unchanged.md` — the decision this concerns. Sound reasoning; one imprecise sentence at `:99`; a precondition it did not know a second policy would violate.
- `docs/adr/0013-an-adr-number-is-defended-at-three-points-not-one.md` — the decision that turned on `strict_required_status_checks_policy`, the other half of the collision. Read on its own it is plainly correct, which is exactly why the interaction went unnoticed.
- `CONTRIBUTING.md:56-68`, `README.md:97-113` — where the convention is stated accurately and framed as taste.
- `.github/workflows/ai-authorship-notes.yml:38-41` (the silent skip) and `:118-125` (the loud guard).
- `test/branch-protection.test.ts` — the repository's own precedent for routing a load-bearing premise through a live check.
- Related issues: #119 (this doc), #71 and #48 (the ADR's antecedents — the orphaned notes, and the decision to publish the ref), #116 (the strictness requirement), #113 (nothing points a fresh agent at `docs/solutions/`, the same failure one level up: a body of guidance with no mechanism that makes anyone read it).

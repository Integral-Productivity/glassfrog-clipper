---
title: Auto-merge is a deferral primitive — diagnose it at the base branch, not the token
date: 2026-09-02
category: workflow-issues
module: merge-automation
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "\"Auto-merge when ready\" cannot be enabled on a PR even though the repo, the PR, and the viewer's permissions all look correct"
  - "GitHub returns viewerCanEnableAutoMerge false while allow_auto_merge is true on the repository"
  - A branch-naming or CI convention promises that green PRs merge themselves
  - Auditing a repo or org for whether documented auto-merge behavior actually works
symptoms:
  - "GraphQL reports viewerCanEnableAutoMerge: false on a PR that is MERGEABLE, ready for review, and fully green"
  - The auto-merge control is absent in the PR UI despite allow_auto_merge=true on the repository
  - The viewer holds admin on the repository, so the failure reads as a token scope or auth problem
  - "GET /repos/{owner}/{repo}/branches/main/protection returns 404 Branch not protected"
  - "GET /repos/{owner}/{repo}/rules/branches/main returns an empty array"
root_cause: incomplete_setup
resolution_type: config_change
tags:
  - auto-merge
  - github
  - branch-protection
  - rulesets
  - ci
  - diagnosis
---

# Auto-merge is a deferral primitive — diagnose it at the base branch, not the token

## Context

"Auto-merge when ready" could not be enabled on any pull request in this repository — not by anyone, including a repo admin. The button was absent in the UI and `gh pr merge --auto` failed.

Measured on PR #61 while it was open, green and mergeable:

| surface | value |
|---|---|
| `allow_auto_merge` (REST) | `true` |
| `repository.autoMergeAllowed` (GraphQL) | `true` |
| viewer permission | `admin` |
| `isDraft` | `false` |
| `mergeable` | `MERGEABLE` |
| checks | 7 `SUCCESS`, 1 `SKIPPED` |
| `GET /repos/{}/branches/main/protection` | `404 Branch not protected` |
| `GET /repos/{}/rules/branches/main` | `[]` |
| `pullRequest.viewerCanEnableAutoMerge` | **`false`** |

Every documented gate passed except the base branch. `GET /repos/{}/rules/branches/{branch}` returns rules contributed by org-level rulesets as well as repo-level ones, so `[]` was conclusive: nothing anywhere required anything on `main`.

That is the whole mechanism. **GitHub offers auto-merge only when something would otherwise delay the merge.** It is a deferral primitive, not a merge primitive. With no required status checks and no required reviews on the base branch, a mergeable PR can be merged right now — there is nothing to wait for — so GitHub withholds the feature entirely.

### First, establish which auto-merge you are even debugging

There is a prior question, and getting it wrong wastes the whole investigation. **This org has two unrelated things called "auto-merge"** (session history):

1. **GitHub's native feature** — the deferral primitive this document is about, armed per PR, gated on the base branch.
2. **A GitHub Actions workflow** — `auto-merge.yml`, a thin caller for a shared reusable in `Integral-Productivity/reusable-workflows`, scoped to `claude/*` branches, which runs `gh pr merge --squash` itself under a GitHub App identity. It does not use the native feature at all, and its gating dependency is an org secret with a per-repo access list rather than anything on the branch.

Most plugin repos are on path 2. **This repository is on neither** — it has no `auto-merge.yml` caller, while `.github/workflows/claude-code-review.yml` allowlists `ip-automerge` and `ip-automerge-bot` as expected PR actors, so it was configured as if the App drives its pull requests. That mismatch is what left native auto-merge as the only available path here, and native auto-merge was unarmed. The workflow-caller half is tracked separately in #67.

The failure modes look identical from the PR page — a green PR that sits there — but the diagnosis diverges immediately. A prior session (session history, 2026-07-21) hit the path-2 version three times: `marketplace`, `model-framework-integration`, and `ip-agent-teams` all had PRs sit green and `MERGEABLE` indefinitely and were merged by hand. The cause there was a missing caller workflow and a missing org-secret grant, not branch protection. Nothing on the base branch would have explained it.

## Guidance

**When auto-merge cannot be enabled, first establish which mechanism the repo is on; then, for the native feature, diagnose at the base branch, not at the token or the role.** The single field that settles the native case is `viewerCanEnableAutoMerge` on the pull request, cross-checked with `GET /repos/{}/rules/branches/{branch}`.

Five concrete practices:

1. **Check for a workflow-based merger before touching branch settings.** `ls .github/workflows/ | grep -i auto-merge`. If a caller exists, the native feature is probably not the mechanism and the base branch is probably not the cause — look at the workflow's own gating (identity, secrets, branch-name scope) instead.

2. **Read `viewerCanEnableAutoMerge` before anything else.** `allow_auto_merge: true` and `autoMergeAllowed: true` describe the *repository setting*, not whether this viewer can arm it on this PR. Only the PR-level field accounts for the base branch.

3. **Probe the base branch with the rules endpoint, not the protection endpoint.** `GET /repos/{}/branches/{branch}/protection` returns `404 Branch not protected` when the branch is governed by a ruleset rather than a classic rule, which reads as "no protection" and is not the same claim. `GET /repos/{}/rules/branches/{branch}` returns the effective rules from every source, including org-level rulesets, and returns `[]` only when there genuinely are none.

4. **Arm it with exactly one required check.** Here the fix was a ruleset on `main` (`~DEFAULT_BRANCH`) requiring a single status check, `verify` — the sole job in `.github/workflows/ci.yml`. Applied via `POST /repos/{}/rulesets`. One required check is enough.

5. **Verify by watching the field flip — and expect it to flip back.** After the ruleset was created, `viewerCanEnableAutoMerge` went `false` → `true` and `mergeStateStatus` became `BLOCKED` pending `verify`. That is the proof the fix worked.

   What it is *not* proof of is that anything auto-merged. The mechanism bites a second time, in the opposite direction: **once the required check goes green, there is nothing left to defer, so auto-merge stops being armable again.** On PR #90, `verify` completed at 22:10:06Z and `gh pr merge --auto --squash` ran at 22:18 — by then the PR was immediately mergeable, no `AutoMergeEnabledEvent` was ever recorded, and `gh` fell through to a direct merge (`mergedBy` is a human, with a plain `MergedEvent`).

   So `--auto` is not idempotent in the way it looks. Arm auto-merge *while the check is still running*, or you get a straight merge and no signal that you did. If you need to know which happened, the `AutoMergeEnabledEvent` timeline item is the only reliable tell — it persists after the merge, so its absence is conclusive.

   The decision is recorded in `docs/adr/0012-auto-merge-is-armed-by-requiring-exactly-one-check-on-main.md` and guarded by `test/branch-protection.test.ts`.

### The trap when fixing it

**Do not reflexively require more checks.** A required status check that never reports does *not* fail a pull request. It pins it at "Expected — waiting for status to be reported", and nothing times out.

`.github/workflows/apple.yml` triggers on `pull_request` with `paths: *apple-paths`, an anchor covering `apple/**`, `src/**`, `public/**` and a handful of named files. So requiring its `Swift core` or `Xcode targets` checks would hang every pull request touching nothing under those paths — while looking like a diligent hardening step.

A related trap runs the other way: **a check name is not owned by the workflow whose name resembles it.** `codeql.yml` has no `pull_request` trigger, yet `CodeQL` / `Analyze (…)` checks still arrive on PRs here, because code-scanning **default setup** is configured on the repository and runs independently of that file. Reasoning from the filename produced a confidently wrong conclusion during this very investigation — it was written into an ADR, a commit message and a PR body before live CI output contradicted it. Confirm where a check actually comes from (`gh api repos/{}/code-scanning/default-setup`) before requiring it or ruling it out.

The guard in `test/branch-protection.test.ts` encodes the rule as two declared lists — `REQUIRED_CHECKS` and `CHECK_SOURCES` — and fails if a required check maps to a workflow that is path-filtered or has no `pull_request` trigger at all.

## Why This Matters

The failure presents as a permissions or auth problem. The repo setting reads `true`, the user is an admin, and the button simply is not there — so the reflex is to check the token, the scopes, or the role. Every one of those investigations returns "fine", and none of them touches the actual cause.

The scale is what makes it worth writing down. Per this session's measurement on 2026-09-02, scanning all non-archived `Integral-Productivity` repos via `GET /repos/{slug}/rules/branches/{default}`: **104 repos probed, 57 with no rules at all on the default branch, 47 of those with `allow_auto_merge: true`**. Tracked as `Integral-Productivity/devops-excellence#625`, where the caveat above is also recorded: some of those 47 are on the workflow path and are working as intended, so the number needs partitioning before anyone acts on it.

That matters because the org's global agent instructions state that Claude-authored branches use `claude/<slug>` because that "enables auto-merge on green CI", and that draft PRs are avoided because "auto-merge only fires on ready-for-review PRs". Both sentences are true only on the workflow path, and only where the org secret is granted. An agent session relying on the convention elsewhere will either wait for an auto-merge that can never arm, or fall back to merging with no gate at all.

There is a second-order consequence that outlives the auto-merge question. "No rules on the default branch" also means **CI is advisory there** — a red build does not stop a merge. Those repos were not only missing a convenience; they were missing the gate.

## When to Apply

- Any time "Enable auto-merge" is absent or `gh pr merge --auto` fails — after checking which merge mechanism the repo uses, and before looking at tokens, scopes, or org policy.
- When onboarding a repo to an agent workflow that assumes auto-merge on green CI: check the base branch's rules, not the repository's `allow_auto_merge` flag.
- When hardening a repo's default branch: require the checks that report on *every* pull request, and treat any path-filtered or non-`pull_request` workflow as ineligible.
- Whenever a GitHub feature is **missing rather than erroring**. A withheld feature and a denied permission look identical from the UI, and the API field that distinguishes them is usually scoped to the object the feature acts on — here, the pull request, not the repository.

## Related

- `docs/adr/0012-auto-merge-is-armed-by-requiring-exactly-one-check-on-main.md` — the decision, with the measured evidence table
- `test/branch-protection.test.ts` — the executable half of the rule
- `docs/solutions/workflow-issues/verify-sibling-repo-facts-against-origin-main.md` — different problem, adjacent habit: establish an artifact's provenance before reasoning from it
- Related: #90 (the fix), #91 (two guards now pin two different rulesets), #89 (are the CodeQL checks requirable), #67 (the workflow-caller path and its scoped secrets)
- Related: `Integral-Productivity/devops-excellence#625` (org-wide measurement), `Integral-Productivity/devops-excellence#626` (the `gh` sandbox failure every measurement here worked around)

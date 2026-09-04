---
title: Verify the event, not the artifact that implies it
date: 2026-09-02
category: workflow-issues
module: verification-discipline
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - About to assert what CI, a merge, or a deployment actually did, based on a config file, a script, or a command's exit status
  - A workflow file's triggers appear to rule out a check that the repository could still supply through another mechanism
  - A command that arms a deferred action exits cleanly and the deferred behaviour is assumed to have been armed
  - Writing an ADR, commit message, PR body, or issue whose premise is a claim about live repository or CI state
  - Reviewing your own reasoning for a conclusion that reads as sound but was never checked against the system it describes
symptoms:
  - A confident, internally consistent conclusion is contradicted the first time live CI or an API is queried
  - The same wrong premise appears in several artifacts because each was written from the previous one
  - Re-reading the reasoning finds no flaw, because the flaw is in an unobserved premise rather than the inference
  - A workflow file explains the absence of a check that is in fact present on the pull request
  - A merge is attributed to automation although the timeline carries no enabling event and a human is recorded as the merger
tags:
  - verification
  - unverified-premise
  - ci
  - auto-merge
  - github
  - code-scanning
  - ground-truth
---

# Verify the event, not the artifact that implies it

## Context

> **On the repository slug below.** The two command blocks in this document are
> transcripts, pasted with the output they actually produced. The repository was
> renamed to `glassfrog-clipper` on 2026-09-02
> ([#62](https://github.com/Integral-Productivity/glassfrog-clipper/issues/62)) and
> the slug was deliberately **not** rewritten here: editing a command so that it
> no longer matches the output shown under it would fabricate the evidence, in
> the one document arguing against exactly that. Both commands still run — the
> REST API and GraphQL each resolve the old name through the rename redirect
> (verified on 2026-09-02).
>
> This blockquote is not the enforcement. A sweep run as
> `grep -rl <old> | xargs sed -i` never reads prose, so both occurrences below
> are registered in [`docs/agents/rewrite-exceptions.json`](../../agents/rewrite-exceptions.json)
> and held there by `test/rewrite-exceptions.test.ts` (#160).

Two claims were written into durable artifacts during this session — an ADR, a commit message, a PR body, a GitHub issue. Both were false. Both were reached by *valid* reasoning from a real artifact that was sitting right there locally. In neither case was the artifact an observation of the state being claimed.

### Instance 1 — a workflow file was read for its triggers, not its content

`.github/workflows/codeql.yml:58-64` declares exactly two triggers, `schedule` (weekly cron) and `workflow_dispatch`. There is no `pull_request`. The conclusion followed cleanly: requiring the `CodeQL` / `Analyze (…)` checks on `main` would pin every pull request at "Expected — waiting for status to be reported", because that workflow can never report on a PR.

False. Code-scanning **default setup** is configured on this repository and runs CodeQL on pull requests independently of any workflow file:

```bash
gh api repos/Integral-Productivity/glassfrog-clipper-chrome-extension/code-scanning/default-setup
# {"state":"configured","query_suite":"extended","schedule":"weekly",
#  "languages":["actions","javascript","javascript-typescript","python","swift","typescript"], …}
```

The part worth sitting with is where the refutation was. Not in the API, not on the PR page — **in the same file, nine lines above the trigger block that was read**:

```
49 # NOTE — GHAS default setup is ALREADY `configured` on this repo (weekly,
50 # extended suite, javascript-typescript among its languages), so CodeQL is
51 # already scanning push/PR here.
```

That is not a hint requiring inference. It is a direct statement, in capitals, of exactly the fact being got wrong — and it has been in the file since its only commit (`33fe2d2`, 2026-08-31), unchanged. The file also explains at `:26-30` that default setup owning push/PR-time CodeQL is *the reason* it deliberately carries no `push` and no `pull_request` trigger. So the `on:` block was not merely incomplete evidence; it was evidence whose own explanation, written directly above it, said the opposite of the conclusion drawn.

It was in a third place too. Issue #76, open at the time, is titled "Verify the advanced CodeQL workflow coexists with GHAS default setup (**already configured here**)". The fact was in the file, in the file's explanation of the block being read, and in an open issue's title.

The `on:` block was read. The forty-eight lines of comment above it were not, and neither was the issue tracker.

Cost of the correct check: nine lines of scrolling, or one API call. Cost of skipping it: a wrong premise carried into four drafts.

### Instance 2 — a command's clean exit implied an event that never happened

`gh pr merge 90 --auto --squash` was run. It returned without error. PR #90 merged moments later. Conclusion: the PR merged via auto-merge, which proved the branch-protection fix end-to-end.

False. `verify` completed SUCCESS at 22:10:06Z; the command ran at roughly 22:18. By then the PR was *immediately* mergeable — so, by exactly the mechanism documented in `docs/solutions/workflow-issues/diagnose-auto-merge-at-the-base-branch-not-the-token.md`, there was nothing left to defer, auto-merge was not armable, and `gh` fell through to a **direct** merge:

```bash
gh api graphql -f query='query { repository(owner:"Integral-Productivity",
  name:"glassfrog-clipper-chrome-extension") { pullRequest(number:90) {
    mergedAt mergedBy{login}
    timelineItems(last:20, itemTypes:[AUTO_MERGE_ENABLED_EVENT, MERGED_EVENT]) {
      nodes { __typename } } } } }'
# mergedAt 2026-09-02T22:18:04Z · mergedBy kraigparkinson · nodes: [MergedEvent]
```

No `AutoMergeEnabledEvent`. That item persists after a merge, so its absence is conclusive, not merely unrecorded. `mergedBy` is a human user with a plain `MergedEvent`.

The claim was asserted twice in conversation and once in a written doc before an independent grounding validator caught it.

### A near-miss of the same shape

Worth naming because it was navigated correctly, and because it shows the shape is not specific to Actions or to files.

`GET /repos/{}/branches/{branch}/protection` returned `404 Branch not protected`. Read as "this branch has nothing governing it", that is wrong: the endpoint only knows *classic* branch protection and returns 404 for a branch governed by a ruleset. The question asked was "what governs this branch?"; the endpoint answers "does this branch have a classic protection rule?"

At the time the two happened to agree — the branch genuinely had nothing on it — so the wrong reading would have produced the right answer. The distinction is now directly observable, since `main` is ruleset-governed:

```bash
gh api repos/…/branches/main/protection   # {"message":"Branch not protected","status":"404"}
gh api repos/…/rules/branches/main        # [{"type":"required_status_checks", …
                                          #   "ruleset_source_type":"Repository","ruleset_id":22147354}]
```

Same branch, same moment: one endpoint says "not protected", the other returns the rule that is protecting it.

### The shape

Two failures and a near-miss, in one session, by the same reasoner, on unrelated surfaces. The common move is **treating an artifact as the state it merely bears on**.

A configuration file is evidence of *intent*. A command's clean exit is evidence that *the command ran*. An endpoint's answer is evidence about *the question it actually answers*. None of the three is an observation of the state being claimed.

In every case the inference from the artifact was sound — `codeql.yml` really does lack a `pull_request` trigger, `gh` really did exit zero, the protection endpoint really did return 404. The premise was simply not the thing being claimed. That is precisely why re-reading does not catch it: re-reading re-checks the inference, and the inference was fine.

Note what did catch each. Instance 1 was caught by querying the `code-scanning/default-setup` API — a live read of the surface the file was standing in for. Instance 2 was caught by an adversarial validator dispatched specifically to check claims against live state. Neither was caught by the author reviewing their own work.

## Guidance

**Before asserting that something happened or is true, name the observation that would show it, and go get that observation. A file that would cause the state, and a command that would produce the event, are neither of them the state or the event.**

Four concrete practices:

1. **Ask what the artifact is authoritative *for*.** `codeql.yml` is authoritative for what that workflow does. It is not authoritative for what checks appear on a pull request, because the repository has a second contributor to that set that lives in settings and appears in no file. Before reasoning from a config file, ask whether it is the *sole* source for the state in question or one contributor among several. When it is one of several, the file cannot settle the question no matter how carefully it is read.

2. **Read the whole artifact, not the stanza that answers your question.** The refutation in instance 1 was in the same file, above the block being read, stated plainly. Skimming to the structurally relevant part is the efficient move and it is exactly what failed — the comment block was where the author of that file had recorded the very thing that made the trigger list misleading.

3. **For any claim about an event, find the ledger entry, not the trigger.** GitHub records `AutoMergeEnabledEvent` on the PR timeline and it persists past the merge, so its presence or absence answers "did auto-merge fire?" directly. `gh`'s exit code answers "did the CLI succeed?", which is a different question and, here, had a different answer. Treat a clean exit as ambiguous whenever the command has more than one success path: `gh pr merge --auto` merges directly when it cannot arm auto-merge, without warning and without failing.

4. **Route the check through something that reads live state, not through re-reading.** The catches in this session were an API query and a dispatched validator. Both were external. Self-review confirmed the reasoning every time and was silent on the premise every time.

   This repository already states the principle in another context. `docs/agents/triage-labels.md:15` opens its guard section with **"Nothing here is maintained by remembering to."** and then names the two automated checks that catch drift instead. The same standard applies to premises: a claim about live state that is maintained by remembering to verify it is not maintained. `test/branch-protection.test.ts:248` does it properly for this repo's required-checks list, with an opt-in live check comparing the declared set against the actual ruleset.

### The fair counter-case: when the artifact *is* the observation

Do not over-correct into distrusting config files. `.github/workflows/apple.yml:11-24` declares `pull_request: paths: *apple-paths`, an anchor covering `apple/**`, `src/**`, `public/**` and eight named files. That path filter genuinely does determine whether that workflow reports on a given PR, and reading the file *is* the right check there. Nothing else contributes to it.

The distinction is not "files versus APIs" — instance 3 was an API. It is whether the artifact is the sole authority for the state being claimed.

## Why This Matters

The failure is invisible from the inside, which is what makes it expensive. Both claims were confidently written, internally consistent, and grounded in something real that had actually been read. There was no moment of guessing to notice and no hedge to walk back. They read as well-sourced because they *were* sourced — to the wrong object.

Concretely, without the catches:

- Issue #89 would have stood on a false premise, and an ADR would carry a permanent rationale for never requiring checks that in fact report on every pull request — narrowing the branch-protection ruleset for a reason that does not exist.
- A solutions doc would state that PR #90 merged via auto-merge, which is the opposite of the mechanism that same doc exists to explain. That doc's core claim — auto-merge stops being armable once the last check goes green — is *demonstrated* by PR #90 merging directly. Reporting it as an auto-merge would have inverted the evidence into a refutation of the finding it supports.

**What the record shows about propagation is more encouraging than the instinct suggests, and worth stating precisely.** The wrong CodeQL premise reached four drafts. It hardened into none of them: the offending commit was force-pushed out of the branch, the landed ADR and squash commit carry the corrected text, PR #90's body carries an explicit self-correction, and issue #89 opens with a correction banner. Exactly one artifact was publicly visible with the error, for about eighteen minutes. The lesson is not that a premise error inevitably propagates — it is that catching it required an external check, and the window in which it was cheap to fix was short.

This document is itself the strongest evidence for its own thesis. Its first draft contained seven unverified or overstated claims, including two contradicted outright by the record — among them a claim about *where* instance 1 was caught, and a claim that the four drafts "outlive the session and reach readers who cannot ask what was meant", which the history refutes. All seven were found by the same kind of external validator prescribed in practice 4, not by re-reading. A document arguing that premises must be observed rather than inferred did not exempt itself from the failure, and had no way to notice from the inside.

## When to Apply

- Any time a claim about system state rests on a file that *configures* that state. Config files describe intent; platforms accumulate settings that live nowhere in the tree — code-scanning default setup, org-level rulesets, repository toggles, App installations.
- Any time a claim about an event rests on a command exiting cleanly, especially where the command has a documented fallback path.
- Any time an endpoint's answer is read as answering a broader question than it does.
- When writing an ADR, PR body, commit message, or solutions doc — these are exactly the artifacts where an unverified premise hardens into a cited fact. Verify before the artifact, not before the merge.
- When a conclusion feels solid *and* was reached without any live query. That combination is the tell: confidence sourced entirely from local reading. The question to ask is not "is my reasoning right?" but "what did I actually observe?"

## Related

- `docs/solutions/workflow-issues/diagnose-auto-merge-at-the-base-branch-not-the-token.md` — the sibling learning. All three cases here arose while producing it, and it carries the full evidence for the auto-merge mechanics; this doc cites it rather than restating them.
- `docs/solutions/workflow-issues/verify-sibling-repo-facts-against-origin-main.md` — adjacent but a different failure. There the artifact was the right *kind* of object and merely stale; here the artifact is a different kind of object from the claim, and the error is categorical rather than temporal.
- `docs/agents/triage-labels.md` — the repo's existing statement of the corrective ("Nothing here is maintained by remembering to.")
- `test/branch-protection.test.ts` — a working instance of routing a load-bearing premise through a live check
- Related: #93 (this doc), #92 (the sibling), #90 (where all three cases arose), #91 (two guards pin two different rulesets on main), #89 (filed on the premise instance 1 got wrong, since corrected), #76 (whether the advanced CodeQL workflow coexists with default setup — the open question the same file comment records)

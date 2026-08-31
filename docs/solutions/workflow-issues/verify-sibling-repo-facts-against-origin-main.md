---
title: Verify sibling-repo facts against origin/main, not the local working tree
date: 2026-08-28
last_updated: 2026-08-31
category: workflow-issues
module: planning-research
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - A plan or ADR depends on the API surface of a package maintained in a sibling local repo
  - Research subagents are dispatched with read access to sibling checkouts
  - Two research agents return contradictory facts about the same dependency
tags: [research, sibling-repos, sdk, dependency-pinning, subagents, glassfrog]
---

# Verify sibling-repo facts against origin/main, not the local working tree

## Context

Planning the GlassFrog Clipper capture path required knowing the exact surface of `@integral-productivity/glassfrog`, a shared SDK maintained in the sibling repo `glassfrog-sdk-ts` and consumed by `glassfrog-mcp-server` and OrgOps.

Two research subagents were dispatched in parallel with read access to that checkout. They returned **directly contradictory** claims about whether the SDK retries HTTP 429 responses internally — a fact that determines the extension's retry policy and its time-to-capture budget.

Neither agent was careless. They read different things:

- One read `origin/main` — version `0.6.0`, which has a retry loop at `src/client.ts:239`.
- One read the working tree — branch `claude/sync-v5-spec-2026-05`, version `0.1.0`, last committed 2026-05-21, with **no** retry loop anywhere in `src/`.

The local checkout was three months and five minor versions behind its own remote, sitting on an unmerged feature branch.

## Guidance

**When a plan depends on a sibling repo's API surface, read `git show origin/main:<path>` rather than the working tree — and state the version the plan targets as an explicit assumption.**

Three concrete practices:

1. **Check the checkout's position before trusting it.** `git branch --show-current` and comparing `package.json` version against `git show origin/main:package.json` takes seconds and is the difference between reading the library and reading someone's in-progress branch.

2. **Pass the resolution rule to research subagents.** A subagent given a sibling path will read what is on disk. Tell it which ref is authoritative.

3. **Record the target version as a named assumption in the plan**, so the implementation session inherits the resolution rather than rediscovering the contradiction.

## Why This Matters

An unresolved contradiction between two research agents is the good case — it is loud. The dangerous case is a **single** agent reading a stale tree and reporting confidently, because nothing signals the discrepancy.

In this session the stale tree would have produced concrete wrong decisions:

- A retry policy written against an SDK that does not retry, when the pinned version does.
- Call shapes using `private_to_circle`, a parameter removed in 0.6.0 that now returns HTTP 422.
- No awareness of the 60-second default timeout, `getLastRateLimit()`, or 422 field-error rendering.

There is a second-order trap. The repo's own `package.json` pinned `^0.1.0`, which under npm's 0.x caret rule resolves to `>=0.1.0 <0.2.0`. So the stale tree and the stale pin agreed with each other, and agreeing looks like corroboration. The version the project *should* consume was in neither place. (The pin has since been corrected to `^0.6.0`; the sibling checkout is still on the stale branch.)

## When to Apply

- Any monorepo-adjacent layout where shared libraries live in sibling directories rather than being consumed only as published packages.
- Any planning or ADR work whose decisions turn on a dependency's exact signatures, error shapes, or defaults.
- Whenever two agents disagree on a fact that should be objective — treat the disagreement as evidence that they read different sources, and find the difference before picking a side.

## Examples

Checking a sibling checkout's position before reading it:

```bash
cd ~/GitHub/<sibling-repo>
git branch --show-current                       # claude/sync-v5-spec-2026-05
node -p "require('./package.json').version"     # 0.1.0
git show origin/main:package.json | node -p \
  "JSON.parse(require('fs').readFileSync(0,'utf8')).version"   # 0.6.0
```

Reading an authoritative fact rather than a working-tree one:

```bash
git show origin/main:src/client.ts | grep -n 'for (let attempt'
# 239:    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
```

How the resolution was recorded so it survives the session — from the plan's Assumptions:

> A4. The `@integral-productivity/glassfrog` SDK at `^0.6.0` is the version the extension builds against. The local `glassfrog-sdk-ts` working copy is on a stale May branch at 0.1.0 with different signatures — read `origin/main`, not the working tree. `origin/main` also carries an unreleased BREAKING change wrapping `me.get()` in a `data` envelope, shipping in 0.7.0. Against the pinned `^0.6.0`, read roles from the bare `{ actor, organization, membership, roles? }` shape, not `result.data.roles`.

That second sentence was added by a later review pass, and it sharpens the rule: read `origin/main` for signatures, then confirm the change you are relying on has actually shipped in the version the project pins. `origin/main` is authoritative for *what the library looks like*, not for *what you will install*.

## Related

- `docs/plans/2026-08-28-1123-feat-zero-decision-capture-path-plan.md` — Assumptions A4, KTD7, KTD9
- `docs/adr/0002-glassfrog-authentication-and-write-path-for-the-browser-extension.md` — the decision to consume the SDK directly
- Org standard: repos consuming `@integral-productivity/*` from GitHub Packages use npm rather than pnpm (`devops-excellence` ADR-016)

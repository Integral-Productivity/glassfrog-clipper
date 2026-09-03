---
title: A failing command blocks a phase, not a capability
date: 2026-09-02
category: workflow-issues
module: verification-discipline
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - About to write "blocked on X" or "this cannot be done without Y" into an issue, PR body, plan, or handoff note
  - A dispatch prompt or a prior artifact hands you a blocker you have not personally reproduced
  - One step of a pipeline fails and the reflex is to conclude the pipeline is unavailable
  - An auth, network, or credential error arrives and the next sentence you write generalises past the request that failed
  - Deciding whether to attempt a task that an existing artifact says is impossible
symptoms:
  - An issue carries a hard blocker that a single directory listing would have refuted
  - Work is routed around a documented obstacle that no one has retested since it was written
  - The error message names one phase (install, fetch, authenticate) and the written claim names the whole toolchain
  - A blocker written by the same author an hour earlier is quoted back as settled fact
  - The refutation, once found, required no network access, no credential, and no more than a second of work
related_components: [tooling, authentication, documentation]
tags:
  - blockers
  - scope-of-claim
  - overgeneralisation
  - unverified-premise
  - issue-hygiene
  - dispatch-prompts
  - npm
  - verification
---


# A failing command blocks a phase, not a capability

## Context

Issue [#142](https://github.com/Integral-Productivity/glassfrog-clipper/issues/142) — "Load the packaged zip in Chrome, not just build it" — was filed with a section headed **Note on running it**. Its first sentence read, verbatim:

> This cannot be done from a session without a `read:packages` token SAML-authorised for the org: `npm ci` 403s on `@integral-productivity/glassfrog`, so there is no `node_modules`, no `tsup`, and no build to load. CI builds it but uploads no artifact, so the zip is not retrievable after the run either.

A session was later dispatched to do the work that note declared impossible. The blocker turned out to be false, and the shape of its falsity is the whole of this document.

### What was true

Nearly all of it. `npm ci` really does fail here without a token: `.npmrc` routes `@integral-productivity/*` to `npm.pkg.github.com`, and that request needs `read:packages`, SAML-authorised for the org.

One qualification, and it is not a small one for a document with this thesis. **This session never ran `npm ci`.** The `403` in the blocker was itself inherited, and `CONTRIBUTING.md` documents a different code: "expect `npm ci` to fail with a 401 — that is this project's problem, not yours." Both are plausible against GitHub Packages, and they are not the same failure — 401 is unauthenticated, 403 is authenticated but not permitted, which is what an un-SSO'd token produces. Neither was reproduced here. The install requirement is real and documented; the specific status code in the blocker is an inherited detail this document is in no position to confirm, and says so rather than repeating it as fact.

The second sentence was true when it was written, and half of it still is. CI uploads no build artifact: the only `actions/upload-artifact` step anywhere in `.github/workflows/` on `main` is the fitness report at `bdd-and-fitness.yml:149`. So the zip is genuinely not retrievable after a run, and that part of the blocker stands.

The other half expired **during the session that refuted the first half**. When #142 was filed, no workflow invoked `scripts/package-chrome.mjs`. [PR #120](https://github.com/Integral-Productivity/glassfrog-clipper/pull/120) merged a few hours later and added two steps to the `verify` job — `ci.yml:115` runs `node scripts/package-chrome.mjs`, and `ci.yml:122` runs `sha256sum release/*.zip`. CI now builds the zip and prints its digest on every pull request.

This document was drafted from a worktree nine commits behind `origin/main` and initially asserted the expired version — "no workflow in this tree invokes `scripts/package-chrome.mjs` at all" — which was true of that checkout and false of the project. It is recorded rather than quietly corrected because it is the same error the document is about, committed while writing the document about it, from the same cause: a claim measured in one vantage point and written down as a property of the whole.

### What was false, and how cheaply

The false part is one word long. It is **"so."**

`npm ci` failing is a fact about *installing*. "There is no `node_modules`" is a fact about *a directory*. Those are different claims, and the second does not follow from the first — it depends on whether some `node_modules` already exists, which is not a question about tokens at all.

It did exist. The main clone one directory up carried a complete install:

```
$ ls -d ~/GitHub/glassfrog-clipper-chrome-extension/node_modules/{tsup,typescript,@integral-productivity/glassfrog}
…/node_modules/@integral-productivity/glassfrog
…/node_modules/tsup
…/node_modules/typescript
```

Three paths. No network, no token, under a second. The blocker's chain was `no token → no install → no node_modules → no tsup → no build`, and the third link was simply not there.

The recovery the session then ran was four commands:

```sh
ln -s ~/GitHub/glassfrog-clipper-chrome-extension/node_modules node_modules
npm run build                      # tsup; the session recorded 35 ms
node scripts/package-chrome.mjs
rm node_modules
```

`package.json:14` defines `build` as `tsup && cp -R public/. dist/ && rm -f dist/manifest.safari.json`, and `package.json:20` defines `package` as `npm run build && node scripts/package-chrome.mjs` — so those two commands are exactly `npm run package`, split so the borrowed `node_modules` is only in place for the half that needs it. `package.json:36` pins `engines.node` to `>=22.18`, so a Node 22-or-newer binary must be the one on `PATH`.

The result: `release/glassfrog-clipper-0.1.0.zip`, 87942 bytes, 10 entries. The session then loaded it in Chrome for Testing — reported as 151.0.7922.34, headless — both as unpacked `dist/` and as the unzipped release zip, and recorded an MV3 service worker registering and the popup and options pages rendering in both cases. Those browser observations are the session's; they are not checkable from the tree, and this document does not restate them as tree-verified facts.

### The `rm node_modules` at the end is not tidiness

It is a hazard removal, and it is worth its own paragraph because the reason is counterintuitive.

`.gitignore:1` is:

```
node_modules/
```

The trailing slash makes that pattern **directory-only**. A symlink named `node_modules` is not a directory, so it is not matched. Demonstrated in a scratch repository with only that one ignore line:

```
$ ln -s real_modules node_modules && git status --porcelain
?? .gitignore
?? node_modules            # ← the symlink, untracked and NOT ignored
?? real_modules/
$ git check-ignore -v node_modules; echo "exit=$?"
exit=1                     # ← "not ignored"

$ rm node_modules && mkdir node_modules && touch node_modules/y && git status --porcelain
?? .gitignore
?? real_modules/           # ← as a real directory, correctly ignored
```

So for as long as that symlink sits in the worktree, `git add -A` would commit a link whose target is an absolute path inside one person's home directory. Tracked as [#171](https://github.com/Integral-Productivity/glassfrog-clipper/issues/171).

### An aside that turned out to be the same lesson again

`scripts/package-chrome.mjs:23-26` claims, in its header comment:

> The zip is written deterministically: entries in sorted order, every timestamp pinned to the DOS epoch. Two runs from the same tree produce byte-identical archives, so "did this change?" is answerable with a checksum rather than by unzipping and diffing.

The session reported running the full cycle twice and getting byte-identical archives, sha256 `cb36eb3bfc831694b8d7201ee493fc9841ab737756f181ae190b5285392b4145` both times — the first time anyone had exercised the claim rather than restating it.

That checksum reproduces. The script imports only `node:zlib`, `node:fs/promises`, `node:path` and `node:url` (`:28-31`), so it runs with no `node_modules` at all — which makes it cheap to re-run against the unchanged `dist/` on several runtimes:

| node | `process.versions.zlib` | sha256 (first 16) | bytes |
|---|---|---|---|
| 20.20.2 | 1.3.1-e00f703 | `cb36eb3bfc831694` | 87942 |
| 22.22.3 | 1.3.1-e00f703 | `cb36eb3bfc831694` | 87942 |
| 22.23.2 | 1.3.1-e00f703 | `cb36eb3bfc831694` | 87942 |
| 25.9.0  | 1.3.1-e00f703 | `cb36eb3bfc831694` | 87942 |
| 26.7.0  | 1.2.12        | `491727b0e0eeb574` | 87697 |

Ten entries, same order, same uncompressed lengths, same DOS-epoch timestamps in every row. The compression level is not the variable either — `:142` pins `deflateRawSync(data, { level: 9 })`. What moves is the bundled zlib.

The structural determinism the script implements is real and does its job. Its header sentence just states one scope wider than the evidence supports: the invariant is "two runs from the same tree **on the same zlib**." Same defect as the blocker, in a comment written with care, by someone who had built the mechanism they were describing.

It has a live consumer. `docs/store/chrome-web-store-listing.md:354` on `main` carries the submission-checklist line — "`npm run package` clean against the real bundle — `verify` does this on every PR (#103); take the SHA-256 from that run's log" — which points a submitter at a digest produced by CI's runtime and invites them to treat it as the artifact's identity. Anyone re-deriving it locally on a different bundled zlib gets different bytes and has no way to tell a toolchain difference from a tampered package. Nothing automated compares the two: `ci.yml:122` *prints* the digest, it does not check it against anything, and `test/store-package.test.ts` deliberately imports only the rule constants so it can run without a build. The disagreement surfaces as a confused person, not a red check. Tracked as [#174](https://github.com/Integral-Productivity/glassfrog-clipper/issues/174).

### The detail this document could not confirm

The session's account says the default `node` on this machine is v20, so Node 22 had to be put on `PATH` deliberately. Measured here, `node` resolves to v26.7.0 from Homebrew, with nvm's 20.20.2, 22.22.3, 22.23.2 and 25.9.0 also installed. The operative constraint — `engines.node >= 22.18`, and `PATH` order deciding which binary answers — holds; the specific version does not, and is recorded here as the session's, not as fact.

Worth noting where that claim came from: the **same dispatch note** that carried the blocker, in the same list of environment facts — "Default node is v20, below the 22.18 floor." Two inherited environment claims arrived together, neither was reproduced, and both were wrong in the same direction: each described a constraint tighter than the one that actually existed. That is the argument of this document appearing twice in its own source material.

## Guidance

**Before writing a blocker into an artifact, name the phase your evidence actually covers, then write the narrowest claim that evidence supports. An error is authoritative about the operation that produced it and about nothing downstream of it.**

### The mechanical version

Take the sentence you are about to write and split it at the "so", the "therefore", the "which means", the "hence". Each side is a separate claim needing separate evidence.

| what you observed | what it licenses | what it does not |
|---|---|---|
| `npm ci` fails to authenticate | "installing from the registry fails without a token" | "there is no `node_modules`" |
| `node_modules` is absent | "commands that resolve from it fail here" | "the build cannot be produced" |
| CI uploads no artifact | "the zip is not retrievable from a run" | "the zip cannot be obtained" |

Every right-hand cell is a claim about a *state* or a *capability*. Every left-hand cell is a claim about a *command*. A command failing tells you about that command.

### Three questions, in order

1. **Which phase does the error name?** `npm ci`'s auth failure names install. Not build, not package, not load. The blocker promoted a fact about phase 1 to a fact about phases 1 through 4, and the promotion happened silently, inside a conjunction.

2. **What is the cheapest observation that would refute the broad claim?** Here: `ls`. If the refutation costs a second and needs no credentials, run it before writing the blocker — not after someone is dispatched against it. The asymmetry is the point: writing "blocked on X" costs one sentence; un-writing it requires a later reader to actively doubt a documented claim and spend effort retesting something already marked impossible.

3. **Is the artifact I am about to write load-bearing?** A blocker in an issue is not a note. It is routing. Later readers, human and agent, treat it as settled and plan *around* it. Nobody re-runs a check that a written artifact says will fail — that is precisely the check a blocker is for.

### Write the phase into the sentence

The fix is not hedging. It is naming the scope, which is more informative than the overreach was:

- ~~"This cannot be done without a `read:packages` token."~~
- "`npm ci` needs a `read:packages` token SAML-authorised for the org, so a fresh install will fail here. **Not checked:** whether an existing `node_modules` is available from another checkout, which is all `npm run build` needs."

The second version is longer and strictly better. It states the true blocker, states its phase, and hands the next reader the exact question to answer — instead of handing them a wall.

### Where the blocker came from is the part worth noticing

It did not come from a teammate, and it did not come from a failed attempt. It came from a note in a dispatch prompt, was written into a **new** issue by the same agent, and was quoted back as settled an hour later by that agent's own successor. There was no moment where anyone decided to trust it, because there was no moment where it looked like a claim rather than a fact.

Inherited claims do not arrive labelled. If a blocker appears in your context and you did not personally produce the error, it is unverified regardless of how authoritative the artifact carrying it looks — and an issue you filed yourself is not corroboration.

## Why This Matters

A true observation and a false generalisation cost different amounts, and this pair shows the gap.

The true half — `npm ci` cannot install without an authorised token — is genuinely useful. It is documented in `CONTRIBUTING.md` (as a 401), it is guarded in CI by a step that fails loudly when the token resolves empty (`.github/workflows/ci.yml:57-66`), and it is the subject of its own solutions doc on the branch behind [PR #168](https://github.com/Integral-Productivity/glassfrog-clipper/pull/168). Nobody is worse off for knowing it.

The false half made [#103](https://github.com/Integral-Productivity/glassfrog-clipper/issues/103) and #142 look like they needed an operator with credentials nobody in the session had. Both are now closed, and the work took four commands. Had the blocker gone unchallenged, the visible cost would have been zero — the issues would simply have sat, correctly labelled, waiting for a prerequisite that was never required. That invisibility is the whole problem. A wrong blocker does not fail; it just quietly stops things.

The generalisation is also the *harder* thing to catch, because it is the part that never gets tested. Someone will eventually rerun `npm ci` and see the auth failure again. Nobody reruns "and therefore there is no build," because it is not a command. It is a conclusion, and conclusions written into issues do not expire.

And it recurs in careful hands. The `package-chrome.mjs` header states a determinism guarantee one scope wider than it holds, in a comment written by whoever built the mechanism. The same failure — an accurate narrow observation stated as a broad invariant — shows up in a blocker written under time pressure and in a design comment written with evident care. It is not a symptom of haste.

## When to Apply

- **Any time you are about to write "blocked", "cannot", "requires", or "not possible" into a durable artifact** — an issue, a PR body, a plan, a handoff note, a `## Note on running it` section. Split the sentence at its "so" and check both halves.
- **When a credential, network, or permission error arrives.** These generalise most easily because they feel categorical: "no access" sounds like a property of the environment rather than of one request. It is a property of one request.
- **When a blocker reaches you from a prompt, a plan, or an issue rather than from your own terminal.** Reproduce it, or write it down as unverified. Inheriting a claim is not evidence.
- **Before routing around a documented obstacle.** Routing around is the expensive response and the one that leaves no trace if the obstacle was imaginary. Spend the second on `ls` first.
- **When writing an invariant into a code comment.** Say what it is invariant *across*. "Two runs from the same tree" and "two runs from the same tree on the same zlib" differ by four words and by whether the sentence is true.
- **When a chain of reasoning has three or more links and only the first was observed.** `no token → no install → no node_modules → no tsup → no build` is five nodes and one measurement.

## Related

- `docs/solutions/workflow-issues/verify-the-event-not-the-artifact-that-implies-it.md` — the closest sibling, and worth reading alongside this one because the two failures are mirror images. That one is about **positive** claims inferred from an artifact that merely bears on the state ("the config says no `pull_request` trigger, therefore no CodeQL on PRs"). This one is about the **scope of a negative** claim, where the observation was of exactly the right kind and simply covered less ground than the sentence written from it. Its practice 1 — "ask what the artifact is authoritative *for*" — has a direct analogue here: ask what the *error* is authoritative for.
- `docs/solutions/workflow-issues/npm-ci-deletes-node-modules-before-it-fails.md` (on the branch behind [PR #168](https://github.com/Integral-Productivity/glassfrog-clipper/pull/168), not yet in `main`) — same subject area, different lesson, and the two compose. That doc explains what `npm ci` destroys before it fails and prescribes a read-only probe (`npm view`) instead; this one is about what you may write down once it has failed. Read it for the ordering defect; do not read this one as restating it.
- `docs/solutions/workflow-issues/verify-sibling-repo-facts-against-origin-main.md` — a third variety: the claim was the right kind and the right scope, and merely stale.
- [#171](https://github.com/Integral-Productivity/glassfrog-clipper/issues/171) — the symlinked `node_modules` escaping `.gitignore`'s trailing slash, demonstrated above. Open.
- [#174](https://github.com/Integral-Productivity/glassfrog-clipper/issues/174) — `package-chrome.mjs`'s determinism claim holding per-zlib rather than per-tree, with the cross-runtime measurements. Filed while writing this document. Open.
- [#142](https://github.com/Integral-Productivity/glassfrog-clipper/issues/142) (closed) and [#103](https://github.com/Integral-Productivity/glassfrog-clipper/issues/103) (closed) — where the blocker was written and where it was refuted.
- `scripts/package-chrome.mjs:23-26` and `:142`; `package.json:14`, `:20`, `:36`; `.gitignore:1`; `.github/workflows/ci.yml:57-85`; `.github/workflows/bdd-and-fitness.yml:147-154` — the lines this document's factual claims were read from.

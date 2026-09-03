---
title: "`npm ci` deletes node_modules before it fails — check the precondition before the destruction"
date: 2026-09-02
category: workflow-issues
module: dependency-install
problem_type: developer_experience
component: development_workflow
severity: high
applies_when:
  - "About to run `npm ci`, or any command documented to delete and recreate a directory"
  - Dependencies resolve through a private registry that needs a token the local shell may not hold
  - The repository is checked out in several worktrees or driven by more than one concurrent session
  - Reaching for a destructive command to verify something, where a read-only form of the same check exists
  - Writing a runbook or an agent prompt that tells someone to run an install as a preflight step
symptoms:
  - "`npm ci` exits non-zero on a registry 401/403 and node_modules is already gone"
  - The install cannot be retried offline, because the tree it would have reused was removed first
  - Recovery is blocked on an out-of-band step (authorizing a token for SAML SSO), not on anything in the repo
  - A sibling session sharing the checkout loses its installed dependencies without having run anything
  - The failure reads as an auth problem while the damage is a destroyed local tree
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components: [tooling, authentication]
tags:
  - npm
  - npm-ci
  - node-modules
  - destructive-commands
  - precondition-check
  - github-packages
  - node-auth-token
  - local-environment
---

# `npm ci` deletes `node_modules` before it fails — check the precondition before the destruction

## Context

The trigger was mundane. One package was missing — `@cucumber/cucumber`, so `npm run bdd` could not start — and an install command felt cheap. The install command was `npm ci`.

It failed on authentication, as this repository's own `CONTRIBUTING.md` says it will. What `CONTRIBUTING.md` does not say is that by the time the 401 is printed, `node_modules` is already gone. The error names the network. The damage was local, silent, and had happened several seconds earlier.

### The ordering, read out of npm's own source

`npm ci` is 129 lines. Read them in order — the sequence is the whole finding.

`$HOME/.nvm/versions/node/v22.23.2/lib/node_modules/npm/lib/commands/ci.js`:

| lines | what happens | can it fail here? |
|---|---|---|
| `:49-56` | `arb.loadVirtual()` — read `package-lock.json` | yes: no lockfile |
| `:59-63` | snapshot the lockfile inventory, `buildIdealTree()` | yes |
| `:68-77` | `validateLockfile()` — lockfile vs `package.json` | yes: out of sync |
| `:80-98` | **remove every entry in `node_modules`** | no |
| `:100` | `arb.reify(opts)` — contact the registry, fetch tarballs | **yes: 401 / 403 / offline** |

The removal at `:88-97` is real and recursive:

```
 86      // Only remove node_modules after we've successfully loaded the virtual
 87      // tree and validated the lockfile
 88      await time.start('npm-ci:rm', async () => {
 89        return await Promise.all([...workspacePaths.values()].map(async modulePath => {
 90          const fullPath = path.join(modulePath, 'node_modules')
 91          // get the list of entries so we can skip the glob for performance
 92          const entries = await fs.readdir(fullPath, null).catch(() => [])
 93          return Promise.all(entries.map(folder => {
 94            return fs.rm(path.join(fullPath, folder), { force: true, recursive: true })
 95          }))
 96        }))
 97      })
 98    }
 99
100    await arb.reify(opts)
```

The sharp version of the finding is in that comment at `:86-87`. **npm does check preconditions before destroying. It checks every precondition except the one that fails.** Both guarded conditions — "a lockfile exists", "the lockfile matches `package.json`" — are local, cheap, and answerable without a socket. Neither of them is *can I actually reach the registry and authenticate to it*. That question is answered at `:100`, one line after the tree is gone.

The comment is not wrong. It is scoped to the two things its author was thinking about. The failure it does not cover is the one that fires here on every run.

### `npm ci --dry-run` does not catch it

This is the correction that matters most, because "dry-run it first" is the remedy a reader would otherwise take away, and it is a false friend.

`--dry-run` is not a rehearsal of the failure. It is `if (!dryRun)` at `:80` — it skips the *deletion* and then runs `reify` in dry-run mode, which resolves the tree from the lockfile and reports what it would install without fetching tarballs. In this worktree, with no `NODE_AUTH_TOKEN` and no `node_modules`:

```
$ npm ci --dry-run
...
add @cucumber/cucumber 13.2.1
add @babel/code-frame 7.29.7

added 193 packages in 758ms

$ echo $?
0
$ ls -d node_modules
ls: node_modules: No such file or directory
```

Exit 0. "added 193 packages." Nothing was added; nothing could have been. The dry run validated the lockfile — the two things npm already checks before deleting — and told the operator nothing about the credential that is about to fail. A reader who dry-runs, sees green, and then runs the real command has performed a ritual that confirmed exactly the preconditions that were never in doubt.

### A probe that does exercise auth

What separates a real check from a ritual one is whether it touches the thing that fails. `npm view` does:

```
$ npm view @integral-productivity/glassfrog version
npm error code E401
npm error 401 Unauthorized - GET https://npm.pkg.github.com/@integral-productivity%2fglassfrog - unauthenticated: User cannot be authenticated with the token provided.
```

It is read-only, takes about a second, and destroys nothing. It is the precondition `npm ci` never checks, asked before `npm ci` runs.

`.npmrc` at the repository root explains why the request goes where it goes, and states the requirement in a comment:

```
# @integral-productivity/* resolves from GitHub Packages.
# Requires NODE_AUTH_TOKEN with read:packages, SAML-SSO-authorized for the org.
@integral-productivity:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Note that this scope route is why a `--registry=https://registry.npmjs.org` override on the command line does not reach public npm for this package: a scoped registry setting wins over the flag, and the request still lands on `npm.pkg.github.com`.

### `gh auth token` is not a substitute

The obvious next move — the local `gh` is authenticated, so borrow its token — swaps a 401 for a 403. `gh auth status` reports the scopes, and `read:packages` is not among them:

```
$ gh auth status
  ✓ Logged in to github.com account kraigparkinson (keyring)
  …
  - Token scopes: 'admin:org', 'gist', 'project', 'repo', 'workflow'
```

Used as `NODE_AUTH_TOKEN`, that produces:

```
npm error code E403
npm error 403 403 Forbidden - GET https://npm.pkg.github.com/@integral-productivity%2fglassfrog - Permission permission_denied: The token provided does not match expected scopes.
```

Different code, same position in the sequence: `reify` at `:100`, after the deletion. A wrong token destroys the tree exactly as thoroughly as no token.

### What the deletion actually costs here

`CONTRIBUTING.md:32-39` already warns about this install:

> Until it lands, expect `npm ci` to fail with a 401 — that is this project's problem, not yours.

Read that sentence for what it promises. It warns about the **failure**. It says nothing about the **deletion that precedes it**, and the natural reading of "expect it to fail" is that nothing happened. That gap is this document's whole opening: the project's own documentation set the expectation that the command is a no-op on failure, and the command is not a no-op on failure.

The blast radius recorded by the original session was: `npm test`, the six fitness checks, and `npm run bdd` all unrunnable; `swift test`, `swift build`, `xcodebuild` for the six Apple targets, `git`, `gh`, and the Python scripts all unaffected.

Re-measured here, with `node_modules` genuinely absent, the loss is narrower than that and worth stating precisely, because "everything Node is dead" and "the specific things that import from `node_modules` are dead" lead to different recovery decisions:

| command | what it is | without `node_modules` |
|---|---|---|
| `npm test` | `node --test 'test/**/*.test.ts'` | **runs, fully green** — 368 tests, 367 pass, 1 skipped, 0 fail, with no `node_modules` at all (measured against the tree this document landed on; the count grows). Run inside a sandbox that blocks binding `127.0.0.1`, about 22 of those fail on `listen EPERM` — a sandbox artifact, not a missing module. Zero `MODULE_NOT_FOUND` either way. |
| `npm run fitness:self` | `node fitness/self/cli.ts` | **runs** — 5 of 6 checks pass; `bundle-shape` fails on `dist/background.js — not found`, i.e. on the missing build, not the missing dependency |
| `npm run bdd` | `node node_modules/@cucumber/cucumber/bin/cucumber` | **dead**: `Error: Cannot find module '…/node_modules/@cucumber/cucumber/bin/cucumber'` |
| `npm run build`, `dev`, `package`, `typecheck` | `tsup`, `tsc` | dead — both are devDependencies |

`npm test` is dependency-free by construction: Node 22's own test runner, over TypeScript that Node 22.18+ strips natively. `package.json` pins `"node": ">=22.18"` under `engines` and `.nvmrc` says `22.18`, which is what makes that possible. `npm run bdd` is the opposite — it names a path inside `node_modules` explicitly, so it is the first thing to die and, on this session's evidence, the thing whose absence sends someone reaching for an install command.

The recovery, from the original session: `node_modules` was copied read-only from a sibling worktree, after two probes established that the sibling's `package-lock.json` was byte-identical and its install complete. That route exists only in a repository with several worktrees checked out. A developer with one clone has no donor, and their recovery is "obtain a `read:packages` token" — which is the thing that was already missing.

## Guidance

**Order a destructive operation so that everything that can fail is checked before anything is destroyed. When the tool owns the ordering and got it wrong, establish the missing precondition yourself, with a non-destructive probe, before you invoke the tool.**

### The shape, stated generally

Any command that **clears state as its first act and validates its ability to rebuild that state as its second** has this defect, whatever it is called:

- a migration runner that drops and recreates before it can connect to the target database
- a formatter or codegen step that truncates the output file before it can parse the input
- `git clean -fdx` ahead of a fetch that turns out to fail
- a build script whose first line is `rm -rf dist/` and whose second line needs a credential
- a deploy that removes the previous release directory before the artifact download is authorised

The tell is structural, not textual: find the first irreversible write, and list every failure mode that lives *after* it. Anything on that list is a way to lose state for a reason the tool never checked.

### The diagnostic tell

**The error message names the second step, so it tells you nothing about the first.** `401 Unauthorized` is a complete, accurate description of what went wrong at `:100`. It is also a complete description of a run in which nothing was lost. The two are indistinguishable from the output.

A reader who reads only the error concludes "auth problem", fixes or defers the token, and does not learn until their next command that the tree is empty. That delay is the cost. The state loss is discovered by a *later, unrelated* failure — `npm run bdd` cannot find a module, `tsc` cannot find its own binary — and the second failure does not obviously belong to the first.

### The asymmetry worth naming

The destructive step is silent and the diagnostic step is loud. That is the exact inverse of what you want, and it is what makes this cost disproportionate to its size.

The loss here is **recoverable** — reinstall with a valid token, or copy a matching tree — but it presents as an **unrecoverable-looking error**, because the message is about a credential the operator may not be able to obtain. Nothing in the output says "and by the way, your working tree is now empty and would have been fine if you had checked first." So the operator spends their time on the credential, which is the hard problem, while the easy problem sits unnamed.

### What to do instead

1. **Probe the failing precondition first, with something read-only.** Here that is `npm view <scoped-package> version`: one second, no writes, exercises the exact registry and the exact credential. Generally: hit the remote's cheapest authenticated endpoint before running anything that mutates.
2. **Do not accept `--dry-run` as that probe unless you have checked what it actually skips.** `--dry-run` is a flag on the destruction, not a rehearsal of the whole pipeline. Read the branch it guards. Here it guards `:80-98` and leaves `:100` in dry-run mode, so it validates the lockfile and never reaches the credential — it returns exit 0 with the very failure it was invoked to predict still latent.
3. **When you cannot verify the precondition, prefer the non-destructive sibling.** `npm install` adds to an existing tree; `npm ci` empties it first. Reach for `ci` when reproducibility is the point and the environment is known good — which is CI, where the tree is empty anyway and the deletion costs nothing. On a populated developer tree it is all downside.
4. **Make the state cheap to restore before you touch it.** A copy of `node_modules`, a database dump, a `git stash` of generated files — taken *before*, not after the error has been read.

### This repository already does exactly that — in CI, and only in CI

`.github/workflows/ci.yml:57-70` puts a step named **"Check the registry token resolved"** immediately before its `npm ci`, and it fails loudly with the remedy spelled out:

```yaml
      - name: Check the registry token resolved
        run: |
          if [ -z "${NODE_AUTH_TOKEN}" ]; then
            echo "::error::NODE_AUTH_TOKEN resolved empty."
            echo "::error::@integral-productivity/glassfrog installs from GitHub Packages and needs a"
            echo "::error::read:packages token, SAML-SSO-authorized for the Integral-Productivity org."
            …
            exit 1
          fi
```

The precondition-before-destruction discipline is already understood here. It is just not available at a developer's prompt, where the same `npm ci` runs against a populated tree instead of an empty runner.

Two things about that guard are worth reading carefully rather than copying. It checks **presence**, not **authorisation** — `-z` catches an empty token and would not have caught the `gh auth token` case above, which is a non-empty token with the wrong scopes. And it exists because of a *different* failure: Dependabot-triggered runs cannot read Actions secrets, so the token had to be duplicated into the Dependabot store, and without the guard every Dependabot pull request failed at `npm ci` with a 401 that did not name its own cause. The guard was written to make a confusing error legible. That it also happens to sit before the destruction is a side effect of CI's ordering, not an intent — which is why the local path never inherited it.

## Why This Matters

The failure this repository documents is the 401. The failure that costs time is the deletion, and no artifact in the repository mentions it. `CONTRIBUTING.md:32-39` warns about the 401 in a note set apart for emphasis, and the sentence it ends on — "expect `npm ci` to fail with a 401" — reads as reassurance that failing is harmless. A contributor following the documented setup path (`nvm use`, `npm ci`, `npm test`) without a token gets exactly the failure the document predicts, plus an emptied tree the document does not predict.

The reason it is worth writing down rather than filing as a one-line note is the inversion. Every guard `npm ci` runs before deleting is a guard against a *local* problem — a missing file, a mismatched lockfile — and those are the problems whose fix is cheapest and whose diagnosis is clearest. The one failure it does not guard against is the *remote* one, which is the least controllable, the most common in a private-registry repository, and the only one whose consequence is destructive. The protection is real, careful, commented, and pointed at the wrong risk.

Two smaller observations the record supports:

- **The trigger was a small missing thing.** One package. `npm run bdd` names a path inside `node_modules` directly, so it fails loudly and specifically the moment that package is absent, and the obvious response to "one package is missing" is an install command. `ci` was reached for over `install` because it is the reproducible one — the more disciplined-sounding choice was the destructive one.
- **`npm test` survived, and that is the fact most likely to be misremembered.** The original session recorded the whole Node toolchain as unrunnable; measured, the entire unit suite still runs with no `node_modules` at all and every test in it passes bar one deliberate skip; a sandboxed run adds `EPERM` failures on `127.0.0.1` that are an artifact of the sandbox, not of the missing dependencies. Blast radius estimated in the moment of a failure runs wide. Measure it before you plan the recovery — the recovery for "the BDD gate and the build are down" is smaller than for "Node is down."

## When to Apply

- **Before running any command that starts by clearing state.** Find its first irreversible write and list what can still fail after it. `npm ci`, `terraform destroy`/`apply -replace`, `git clean`, `rm -rf dist && build`, migration runners, cache-clearing deploy steps.
- **Whenever a tool documents its safety checks.** Read what they cover, then ask what they *don't*. A comment like `// Only remove node_modules after we've successfully loaded the virtual tree and validated the lockfile` is a precise statement of two checks and silent about a third. Precision about what is guarded is not a claim that everything is.
- **Before treating `--dry-run`, `--check`, `--plan`, or `--noop` as a safety rehearsal.** Ask which specific branch the flag skips, and whether the step that actually fails is inside it. A dry run that exits 0 while the real run will fail is worse than no dry run, because it converts uncertainty into false confidence.
- **On any repository whose install requires a credential.** Private registries, SSO-gated packages, internal proxies, artifact stores. The install is the step most likely to fail on auth and most likely to be destructive first.
- **When an error names a remote failure and you have not confirmed local state.** Before acting on the message, check what the command touched on the way to producing it. `git status`, `ls`, a directory count — the cheap read that distinguishes "nothing happened" from "something happened and then this."
- **Reading a session's own account of a blast radius.** Estimated-in-the-moment scope runs wide. Re-run the commands before deciding what to restore.

## Related

- `docs/solutions/workflow-issues/a-convention-enforced-by-a-skip-fails-silently.md` — a genuine sibling on silence, from the opposite direction: there, a step that should have spoken did not; here, a step that destroyed said nothing while a later step spoke loudly about something else. The distinction worth holding on to is whose machinery is at fault. That one is a convention this repository wrote, whose enforcement cannot be observed; this one is a third-party tool whose destructive step precedes the check that fails. Its remedy adds a voice; this one reorders. Neither rule implies the other.
- **#142** — and the closed #103 before it. The auth barrier is not only an external-contributor problem, which is how `CONTRIBUTING.md` frames it: a worktree that has never been installed into has no `node_modules`, so no `tsup`, so no build output for the unpacked extension to load from. That is a property of the worktree rather than the repository — the main clone holds an installed tree, and borrowing it builds without a token — but a session that does not know this reads the 403 as a hard stop, and #142 was filed saying exactly that. Worth knowing before treating this as a courtesy issue for outsiders.
- `CONTRIBUTING.md:32-39` — warns that `npm ci` will 401 for anyone without a token; does not mention that the tree is emptied first. That note points at **#2** and **ADR 0005** as the tracking pair; **#2** is now closed as completed (2026-08-31) while the 401 reproduces today against the current `.npmrc` routing, so a contributor who follows the link lands on a closed issue. #2 closing recorded a *decision* rather than a shipment: it was closed by merged PR **#39**, `docs(adr): settle the open-source path on a public SDK, not a vendored fork` — the pull request that landed ADR 0005, a documentation change. The package is still absent from the public registry (`curl https://registry.npmjs.org/@integral-productivity%2Fglassfrog` returns `404 {"error":"Not found"}`). Tracked as **#162**.
- `.npmrc` — the scope route to `npm.pkg.github.com` and the `read:packages` + SAML-SSO requirement, in a comment. Also the reason a `--registry` override on the command line does not reroute this package.
- `docs/adr/0005-the-open-source-path-runs-through-a-public-sdk.md` and **#2** — the standing "the SDK is not public yet" problem this failure mode rides on. Publishing the SDK would dissolve the auth precondition for *this* repository entirely, and with it this specific instance. That is worth saying plainly: **the instance here is temporary; the general rule is not.** Any tool that destroys before it validates its ability to rebuild will do this again, on a different precondition, in a repository with no ADR about it.
- `package.json` (`engines: node >=22.18`, `test`, `bdd`, `fitness:self`) and `.nvmrc` (`22.18`) — why `npm test` is dependency-free and `npm run bdd` is not.
- **#119** — the issue tracking this document.

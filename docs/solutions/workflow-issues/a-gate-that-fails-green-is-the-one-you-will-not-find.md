---
title: A gate that fails green is the one you will not find
date: 2026-09-03
category: workflow-issues
module: verification-discipline
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - Fixing a guard that has never worked, where each repair can expose the next failure rather than finish the job
  - Writing a correction to a document, and about to state a fact about the tool being corrected
  - Reviewing an allowlist, exclusion list, or skip condition that uses a wildcard
  - A gate is reported working because the pipeline went green, without checking which of its outcomes the green represents
  - Reading a passing check on a mechanism nobody has watched succeed
symptoms:
  - A guard is fixed, and the next run fails somewhere later in the same guard, for an unrelated reason
  - An allowlist entry matches more accounts than its author intended, and nothing anywhere reports it
  - A decision record asserts how a third-party tool behaves, and the assertion was never run
  - A green check on a pull request whose subject was never actually examined
  - Two successes are cited as proof, and neither ran against the change they are said to prove
tags:
  - verification
  - unverified-premise
  - ci
  - cla
  - allowlist
  - github-actions
  - fail-open
---

# A gate that fails green is the one you will not find

## Context

`.github/workflows/cla.yml` had never once run
([#179](../../issues/179)). Fixing that took four repairs, and the shape of the
sequence is the lesson: **each fix exposed the next failure, and every one of
them was invisible for the same reason.**

1. The workflow never started — the pinned action is not a Marketplace verified
   creator, and an organisation-level allowed-actions policy refused it. 152
   runs, no jobs, no annotations. Written up in
   [a startup failure hides its reason, so bisect the workflow](a-startup-failure-hides-its-reason-so-bisect-the-workflow.md).
2. The signature push was rejected — the action records a signature by pushing
   to the branch named in `cla.yml`, that branch was `main`, and `main`'s
   ruleset requires `verify`, which the push cannot carry.
   [ADR 0019](../../adr/0019-the-cla-signature-record-lives-off-the-protected-branch.md).
3. **The storage branch did not exist, and nothing creates it.**
4. **The allowlist exempted people nobody meant to exempt.**
   [ADR 0020](../../adr/0020-the-cla-allowlist-is-enumerated-and-automation-is-exempt.md).

The ADRs record what was decided. This records how 3 and 4 were found, because
they were found by different means and only one of them could have been found by
waiting.

## 3. The correction that carried its own unverified premise

ADR 0019 moved the signature record to a `cla-signatures` branch and stated, in
its consequences:

> The branch is created by the action on first signature and must be left out of
> any ruleset.

Nobody had checked it. It is false.
`src/persistence/persistence.ts` at the pinned SHA calls
`repos.createOrUpdateFileContents` and nothing else; there is no
branch-creation call anywhere in the action, and GitHub's contents API requires
the branch to exist. The first signature would have failed with a 422.

The check that found it cost one HTTP request — `GET /branches/cla-signatures`,
404 — and one `git show` of the action's source. It was run only because
somebody asked "what happens on the *first* signature?" rather than "is the
config right?".

What makes this worth keeping is where the sentence was. ADR 0019 exists
because #179 was caused by unverified premises. Its argument is that you must
check. And the paragraph stating the remedy asserted an unchecked fact about
the very tool it was correcting. **Writing the rule down does not exempt the
document from it**, and the moment of greatest risk is the confident sentence
in the fix, not the original mistake.

The branch is now seeded rather than assumed, and the ADR carries the
correction — the wrong sentence and why it was wrong both stay, because a
decision record that hides its own repair is worth less than one that shows it.

## 4. The failure that goes green

The allowlist read:

```yaml
allowlist: kraigparkinson,dependabot[bot],bot*
```

`contributor-assistant/github-action` compiles a `*` pattern to an
**unanchored** regex. `checkAllowList.ts` escapes the pattern, splits on the
escaped `*`, joins the parts with `.*`, and calls `RegExp.test`. No `^`. No `$`.

So `bot*` did not mean "starts with bot". It meant "contains bot":

| login | result |
|---|---|
| `kraigparkinson`, `dependabot[bot]` | exempt — intended |
| `abbott` | **exempt** |
| `robotics-inc` | **exempt** |
| `sabotage-labs` | **exempt** |
| `claude`, `alice` | must sign |

**This one could not have been found by waiting**, and that is the whole point.
Failures 1 to 3 all went red somewhere — a grey-red run, a failed check, a 422.
Red is slow to notice but it accumulates. An over-broad allowlist produces the
opposite: the contributor is waved through, the check reports success, the pull
request merges, and the repository quietly loses the ability to license the
whole work. There is no artifact to find later. The only way to see it is to
**run the matcher yourself against inputs you chose**, which is eight lines:

```js
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matches = (patterns, login) => patterns.some(p =>
  p.includes('*')
    ? new RegExp(escapeRegExp(p).split('\\*').join('.*')).test(login)
    : p === login);
matches(['bot*'], 'abbott');  // true
```

The guard that now exists (`test/cla-allowlist.test.ts`) is that snippet plus a
list of ordinary logins. It reproduces the upstream matcher deliberately,
including the missing anchors, so it measures what the action *will* do rather
than what it ought to.

**A pattern cannot be anchored from configuration.** So the rule is not "write
careful globs" — it is enumerate, and let a test refuse the glob.

## The generalisation

Two directions of failure, and they are not symmetrical:

| | what it does | how you find it |
|---|---|---|
| **fails red** | blocks work that should pass | someone complains; it accumulates |
| **fails green** | permits work that should be blocked | nothing happens, ever |

A guard is not verified by watching it pass. It is verified by watching it
**refuse something you know it should refuse** — which is why every guard added
across #179 ships with its red half in the suite, and why each was confirmed by
reintroducing the real fault on purpose and reverting it before committing.

And one corollary worth stating on its own, because it caught this session
twice: **a green check is evidence about the thing it actually ran against.**
Two CLA runs went green on AI-named branches minutes before the allowlist fix
merged, and briefly looked like proof it worked. They were not: their committer
was already exempt for other reasons, and both predated the change. That is the
same error as clearing the allowed-actions hypothesis on a third-party action
that happened to be a verified creator — see
[verify the event, not the artifact that implies it](verify-the-event-not-the-artifact-that-implies-it.md).
Before a success counts as evidence, say what it ran against and what would have
made it fail.

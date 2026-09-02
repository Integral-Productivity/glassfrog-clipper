# 9. AI authorship survives a squash only where the diff is unchanged

Date: 2026-09-01

## Status

Accepted

Settles [#71](../../issues/71). Implements the publication position taken in
[#48](../../issues/48) and stated in [README.md](../../README.md).

Numbered 9 rather than 7 deliberately: [#61](../../pull/61) and
[#66](../../pull/66) are both open and both claim `0007`, so 0007 and 0008 are
spoken for until that is resolved. See [#83](../../issues/83).

## Context

This repository publishes `refs/notes/ai` — [git-ai](https://usegitai.com)
authorship notes recording, per file, which lines came from an AI session and
which from a human. #48 decided that publication is deliberate rather than an
artifact of the tooling pushing the ref.

The record did not survive contact with the merge workflow. Squash-merging
builds a **new** commit server-side and leaves the commit the note was attached
to unreachable from `main`. The note does not follow the change.

Measured against `origin/main` on 2026-09-01:

| | count |
|---|---|
| notes on `refs/notes/ai` | 74 |
| naming commits reachable from `main` | 12 |
| naming commits **not** on `main` | 62 |

All 12 that resolve are dated 2026-08-28 — the bootstrap commits, made directly
on `main` before the pull-request workflow began. **Nothing merged through a
pull request carries attribution.** Confirmed on this repository's own history:
`f6b582a7`, the squash of #73, has no note; the note stayed on the orphaned
branch commit `abf728dd`.

So the published record was not thin, it was frozen at day one, and the gap
widened with every merge.

Git's own remedy does not reach this. `notes.rewriteRef` makes
`git notes copy --for-rewrite` fire on *local* rewrites — amend, rebase,
cherry-pick. GitHub performs the squash on its servers, so no local hook ever
sees it. git-ai 1.7.0 ships nothing for this either: its configuration has no
rewrite or squash handling, and its CLI offers only `fetch-notes`.

The tempting fix — copy the note onto the squashed commit — is unsound in
general. A note records per-file **line ranges** keyed to one commit's diff.
Squashing several commits collapses the intermediate states, so ranges from
several notes do not compose onto the squashed diff; they would point at the
wrong lines. Across 23 recently merged pull requests: 16 were a single commit,
6 were two, and one was sixteen. A naive copy would therefore publish incorrect
attribution on roughly 30% of merges.

On a repository whose entire claim is a record you can check rather than trust,
wrong attribution is worse than absent attribution.

## Decision

A note is carried onto the squashed commit **only where the transfer is provably
sound**, and nothing is recorded otherwise.

`.github/workflows/ai-authorship-notes.yml` runs on a merged pull request and
copies the note when all of the following hold:

1. the pull request has exactly one commit;
2. it came from a branch in this repository, not a fork — a fork's notes live in
   the fork and never reach this repository's `refs/notes/ai`;
3. the head commit still carries a note, and the squashed commit does not;
4. **the head commit's diff is byte-identical to the squashed commit's diff.**

Condition 4 is the actual correctness guard. The commit count is a cheap
proxy; the diff comparison is the thing that establishes the line ranges still
describe the code. It is checked independently, so a wrong commit count cannot
by itself produce a bad note. Verified against the multi-commit #57: the diffs
differ and the guard blocks the copy.

`base_commit_sha` is rewritten to the squashed SHA on copy, so the note does not
name a commit absent from `main`. Nothing else in the note is altered.

To make the sound case the normal case, **a pull request should be a single
commit** unless there is a reason for more. This is written into
[CONTRIBUTING.md](../../CONTRIBUTING.md). It is a preference, not a gate: a
genuinely multi-commit change is still fine, it simply lands without
line-level attribution.

## Consequences

Attribution coverage of merged work goes from none to the share of pull requests
that are a single commit — 16 of the last 23, and higher as the norm takes hold.
Squash-merge and the linear history it produces are unaffected, so the
repository keeps the convention used across Integral Productivity.

Coverage is deliberately partial, and the README says so rather than implying a
complete record. Multi-commit pull requests land unattributed, silently by
design — the workflow logs a notice, but no one is blocked.

The 62 notes already orphaned are **not** recovered by this and are not deleted.
Their commits remain fetchable from `origin` by explicit SHA even though the
branches were auto-deleted, so the data is not lost, merely absent from a normal
clone. Pruning them would destroy a recoverable record to make a cosmetic point.

The workflow needs `contents: write` to push `refs/notes/ai`, and serializes on
a single concurrency group because all merges contend for one ref. A push that
loses the race is retried three times against a re-fetched ref; if it still
fails the job fails loudly with the command to repair it by hand, rather than
dropping the attribution quietly.

Rejected alternatives:

- **Switch to merge commits.** Preserves the branch commits' SHAs, so every note
  resolves with no tooling at all — the only complete fix. Rejected because it
  trades an org-wide squash convention for a transparency feature that is not
  load-bearing enough to justify it.
- **Recompute line ranges against the squashed diff.** Would give full coverage,
  but git-ai does not support it and it would have to be built and maintained
  here. Disproportionate to the benefit.
- **Prune the orphaned notes.** Rejected above — destructive, and it would leave
  a published record covering a single day in August.
- **Accept the gap and only document it.** The honest minimum, and what the
  README already does. Rejected as the whole answer because the claim to publish
  a line-level record weakens with every merge that is not covered by it.

# 14. Code-scanning default setup is the sole CodeQL owner

Date: 2026-09-02

## Status

Accepted

Numbered 14 rather than 13: `0013` landed on `main` with
[#117](../../pull/117) while this was being written. Listing `docs/adr/` from a
stale worktree showed 0013 free; it is not. The claim guard that now reports
this while both branches are still open is
[`scripts/adr-claims.ts`](../../scripts/adr-claims.ts), from
[#83](../../issues/83).

Decides [#111](../../issues/111), on the evidence gathered by
[#76](../../issues/76). Relates to [#68](../../pull/68) (the pull request that
shipped the deleted workflow), [#89](../../issues/89) (whether the CodeQL checks
become required on `main`), and ADR [0012](0012-auto-merge-is-armed-by-requiring-exactly-one-check-on-main.md).

## Context

This repository has had **two** CodeQL configurations since 2026-08-31. They are
told apart by their `path`, not their name — `gh workflow list` shows two
entries both called "CodeQL":

| workflow id | `path` | what it is | created |
|---|---|---|---|
| `344825302` | `dynamic/github-code-scanning/codeql` | GHAS **default setup**'s managed analysis. The `dynamic/` prefix is not a file in this repo; it is GitHub's synthetic path. | 2026-08-28 |
| `347239297` | `.github/workflows/codeql.yml` | The **advanced** workflow shipped by [#68](../../pull/68). A real file on `main`. | 2026-08-31 |

Default setup, measured 2026-09-02:

```
gh api repos/.../code-scanning/default-setup
{"state":"configured",
 "languages":["actions","javascript","javascript-typescript","python","swift","typescript"],
 "query_suite":"extended","threat_model":"remote","schedule":"weekly"}
```

The advanced workflow declared one language, `javascript-typescript`, and the
same category default setup uses for it, `/language:javascript-typescript`.

### The advanced workflow has never produced an analysis

[#76](../../issues/76) settled this with a single `workflow_dispatch` on
`ed10b64e` — [run 33700923292](../../actions/runs/33700923292), `conclusion:
failure`. The analysis itself ran fine; the **server-side processing** rejected
it:

```
CodeQL scanned 67 out of 67 TypeScript files, 8 out of 8 GitHub Actions files
and 7 out of 7 JavaScript files in this invocation.
Uploading results
Successfully uploaded results
...
Waiting for processing to finish
Analysis upload status is failed.
##[error]Code Scanning could not process the submitted SARIF file:
CodeQL analyses from advanced configurations cannot be processed when the
default setup is enabled
```

That sequence is worth reading twice. **"Successfully uploaded results" is the
transport succeeding**; the rejection lands about nine seconds later at
`Analysis upload status is failed`. Reading only the tick — or only the upload
line — produces the opposite conclusion.

Corroborated from the analyses endpoint rather than from the log alone:

```
gh api repos/.../code-scanning/analyses?per_page=100 --jq '[.[] | .analysis_key] | unique'
["dynamic/github-code-scanning/codeql:analyze","dynamic/github-code-scanning/codeql:upload"]
```

Every analysis on this repository belongs to default setup. The advanced
configuration has produced **zero**, across its entire lifetime.

So the two configurations cannot produce duplicate findings — but not because
they coexist cleanly. They cannot duplicate because one of them is discarded in
full. There has only ever been one scanner here.

### Why the schedule-only trigger did not prevent this

devops-excellence ADR-035 prescribes exactly the shape `codeql.yml` had —
standalone, `schedule` + `workflow_dispatch`, never bundled into `ci.yml` — and
claims that shape makes the collision structurally impossible:

> SARIF collision (mode 1) becomes structurally impossible — the advanced
> analyzer never fires on a push/PR SHA that default setup also scans.

**That reasoning does not hold where default setup scans push to `main`.**
`main`'s HEAD is then, by construction, always a SHA default setup has already
scanned — so a weekly cron run of `main`, or any manual dispatch of it, lands on
precisely that SHA. `ed10b64e` was scanned by default setup at `00:27:37Z` and
rejected the advanced upload at `00:48:08Z`: same ref, same SHA, same category.
The schedule-only trigger narrows *how often* the collision occurs. It does not
make it impossible.

The half of ADR-035 that did hold is its actual decision — standalone, not
bundled. The run went red and took nothing with it; `ci.yml`'s `verify` gate was
untouched, exactly as [#68](../../pull/68) predicted. Containment worked. The
mechanism claimed for it was wrong.

## Decision

**Code-scanning default setup is the sole owner of CodeQL on this repository.**
`.github/workflows/codeql.yml` is deleted.

And, because deleting a file does not stop it being re-created: **an advanced
CodeQL configuration is not to be added back while default setup reports
`state: configured`.** That includes Stage 4 of the tier-3 → tier-1 transition,
where the canonical tier-1 caller —

```yaml
uses: Integral-Productivity/devops-excellence/.github/workflows/reusable-codeql.yml@v1
```

— *is* an advanced configuration, and would reproduce this failure on arrival.
Adopting it here requires turning default setup off first, which is a separate
decision with its own costs (below). Tracked as [#143](../../issues/143) so the
swap meets a written trigger rather than a deleted file.

## Consequences

**No scan coverage is lost.** The comparison is not close:

| | default setup | the deleted `codeql.yml` |
|---|---|---|
| languages | actions, javascript, javascript-typescript, python, swift, typescript | javascript-typescript |
| query suite | extended | default |
| triggers | push, pull request, weekly | weekly, manual |
| analyses ever produced | all of them | **none** |

**The standing red goes away.** The workflow was scheduled for Monday 08:00 UTC
and would have failed every week, indefinitely, while scanning nothing.

**The ruleset is untouched, and `#89` is unaffected.** `main` requires exactly
one check — `verify` — per ADR 0012, verified against the live ruleset on
2026-09-02. No CodeQL check is required today, so nothing about this deletion
can pin or gate a pull request. The `CodeQL` / `Analyze (…)` checks that
[#89](../../issues/89) is deciding about come from default setup and continue to
arrive on every pull request exactly as before; this ADR neither helps nor
hinders that decision. Making a CodeQL check required remains #89's call.

**[#77](../../issues/77) is moot as written.** It tracks extending the advanced
workflow's matrix to Swift once the Xcode project lands. There is no matrix to
extend, and default setup already lists `swift` among its languages. The
remaining question — whether Swift is actually *analyzed* rather than merely
listed — is a question about default setup, not about a workflow file.

**ADR 0012's table row citing `codeql.yml` is now historical.** It reads
`CodeQL`, `Analyze (…)` → "code-scanning **default setup** (not `codeql.yml`)",
which was the correct disambiguation at the time and stays accurate about where
the checks come from. ADRs are not edited after acceptance; this one supersedes
that row's premise, not its conclusion.

**Comments in [`test/branch-protection.test.ts`](../../test/branch-protection.test.ts)
now cite a file that does not exist.** They use `codeql.yml` as the worked
example of "a check name is not owned by the workflow whose name resembles it" —
a lesson that survives its example. The tests themselves are unaffected: they
assert against a **fixture** rather than the real file, deliberately, so that no
assertion depended on the deleted workflow. Left to [#144](../../issues/144)
rather than fixed here, because three sibling efforts hold that file.

**Upstream, ADR-035 needs a correction.** Its structural-impossibility claim is
false for any repo where default setup scans push to a branch the cron also
runs on, and its praxis exemplar is stale — praxis's own `codeql.yml` shows 20
consecutive failed runs, the newest schedule-triggered and after the fix that
was supposed to make it immune. That is
[devops-excellence#187](https://github.com/Integral-Productivity/devops-excellence/issues/187),
which already asks this exact question; this repo is now its worked answer.

## The rule this generalises to

ADR 0012 landed "a check name is not owned by the workflow whose name resembles
it." This one adds its sibling: **a workflow that runs is not a workflow that
reports.** `codeql.yml` was green-lit at every step a workflow file can be
judged by — valid syntax, correct triggers, real analysis over the whole tree, a
successful upload — and produced nothing, for its entire life, because the
rejection happened on a server after the last step it controlled. Judge a
security control by the artifact it lands, not by the run it completes.

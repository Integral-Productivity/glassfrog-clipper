# Auto-merge is armed by requiring exactly one check on main

Date: 2026-09-02

## Status

Accepted

Numbered 12 rather than 10 deliberately: `0007` landed on `main` with
[#61](../../pull/61) while this was being written, and [#86](../../pull/86) is
still open claiming both `0010` and `0011`. Listing `docs/adr/` would have shown
0010 free; it is not. See [#83](../../issues/83) and the guard in
[`test/adr-numbering.test.ts`](../../test/adr-numbering.test.ts).

Relates to [#67](../../issues/67) (Stage 0 of the tier-1 transition) and
[#69](../../issues/69) (the tier-1 gates).

## Context

`CLAUDE.md` says Claude-authored branches are named `claude/<slug>` because that
"enables auto-merge on green CI", and that draft PRs are avoided because
"auto-merge only fires on ready-for-review PRs". Both sentences assume auto-merge
is available on this repository. It was not.

The repository setting was never the problem. Measured on 2026-09-02:

| surface | value |
|---|---|
| `allow_auto_merge` (REST) | `true` |
| `repository.autoMergeAllowed` (GraphQL) | `true` |
| viewer permission | `admin` |
| `GET /repos/.../branches/main/protection` | `404 Branch not protected` |
| `GET /repos/.../rules/branches/main` | `[]` |
| `pullRequest(61).viewerCanEnableAutoMerge` | **`false`** |

PR #61 at the time was `MERGEABLE`, not a draft, with all seven checks green.
Every gate GitHub documents passed except one: `main` had no branch protection
rule and no ruleset, and no org-level ruleset applied to it either.

That is sufficient on its own. **Auto-merge is a deferral primitive, not a merge
primitive.** GitHub offers it only when something would otherwise delay the
merge. With nothing required on the base branch, a mergeable PR can be merged
right now, so there is nothing to defer and GitHub declines to arm the feature.
The button is absent in the UI and `gh pr merge --auto` fails.

The trap is that the failure looks like a permissions or auth problem, so the
instinct is to check the token — which is the wrong surface entirely.

## Decision

`main` requires exactly one status check: **`verify`**, the sole job in
[`ci.yml`](../../.github/workflows/ci.yml).

Requiring one check is enough to arm auto-merge. Requiring *more* is where this
gets dangerous, and the danger is not symmetric with the benefit:

| check | source | reports on every PR? | required? |
|---|---|---|---|
| `verify` | `ci.yml`, `pull_request`, unfiltered | yes | **yes** |
| `Swift core`, `Xcode targets` | `apple.yml`, `pull_request` **filtered** to `apple/**` &c. | **no** — silent unless the PR touches those paths | no |
| `CodeQL` (rollup) | code-scanning **default setup**, GHAS app `integration_id 57789` (not `codeql.yml`) | yes — 18 of 18 PR heads, in 2–4s | **decided yes**, gated — [#89](../../issues/89) |
| `Analyze (…)` | code-scanning **default setup**, one job per configured language | yes *today*, but the name set is mutable — see below | **no** — [#89](../../issues/89) |

A required check that never reports does not fail the PR; it pins it at
"Expected — waiting for status to be reported", forever. Requiring the Apple
checks would do exactly that to every PR that does not touch Apple paths.

The CodeQL row is the one worth reading twice, because the obvious reasoning
about it is wrong. `codeql.yml` really does trigger only on `schedule` and
`workflow_dispatch` — but the `CodeQL` and `Analyze (…)` checks appear on pull
requests regardless, because **code-scanning default setup is configured on this
repository** and runs independently of that workflow file. So "requiring CodeQL
would deadlock every PR" is false; the checks do arrive. Whether they are
*requirable* was left open here and settled by [#89](../../issues/89), which
measured them rather than reasoning about them. Two results change this table.

**The rollup is requirable; the per-language jobs are not.** `Analyze (swift)`
runs on `macos-latest` and took 10m37s–16m52s across thirteen pull requests that
touch no Swift at all, against 22–32s for `verify`. Requiring it would move
time-to-merge by 25–45× and bill a macOS runner, unfiltered, on every pull
request — the cost `apple.yml` path-filters precisely to avoid.

**A default-setup check name is not a stable surface to require.** The rule below
asks whether a check reports on every pull request. `Analyze (swift)` satisfies
that rule today and did not exist yesterday: default setup's language list gained
`swift` and `python` at `2026-09-02T21:55:08Z`, taking the `Analyze (…)` set from
two names to four *underneath open pull requests*. Those names derive from a
mutable repository setting, not from any file in `.github/workflows/`, so a
required one can lose its source with nothing in the repository to explain the
resulting deadlock. The rollup's name does not vary with that list.

So the row above splits. This is the sharper form of the lesson: a check name is
not owned by the workflow whose name resembles it — and where it is owned by a
*setting* rather than a file, satisfying the rule today is not evidence it will
satisfy the rule tomorrow.

The lesson generalises past this repo: **a check name is not owned by the
workflow whose name resembles it.** Verify where a check actually comes from
before reasoning about its trigger.

So the rule is not "require the important checks". It is: **a check may be
required only if it reports on every pull request.** Importance is not the
criterion; reporting reliably is.

## Consequences

Auto-merge becomes armable, which is what `CLAUDE.md` already assumed.

`verify` becomes genuinely blocking. That is the point, but it is a real change:
a red `verify` now stops a merge rather than merely embarrassing it.

CodeQL remains unenforced at the merge boundary as of this ADR. The evidence it
asked for arrived under [#89](../../issues/89): the `CodeQL` rollup is to become
a second required check, and no `Analyze (…)` job is. That change is **not
applied here** and is gated on [#111](../../issues/111) choosing a CodeQL owner,
because one of its options turns default setup off and would leave the rollup
with no source — requiring a check whose publisher has been removed is the
deadlock this ADR exists to prevent.

One caveat belongs on the record rather than in the commit message that
eventually applies it. The rollup returned `neutral` on 3 of 18 heads, with the
output `1 configuration not found` — it compares the head's analyses against
`main`'s, and cannot compute "alerts introduced by this pull request" when the
two carry different language sets. GitHub scores `neutral` as a pass. So the
required check will go green in exactly the case where it is reporting that it
could not do the comparison, and it re-fires on every open pull request each time
the language list changes. That is still strictly more enforcement than none, and
it is the shape devops-excellence ADR-024 / ADR-037 already mandate fleet-wide —
but a green `CodeQL` means "no new alerts *or* no comparison made", and the
ruleset cannot say which.

The rule above is executable rather than advisory:
[`test/branch-protection.test.ts`](../../test/branch-protection.test.ts) fails if
a required check is drawn from a workflow that cannot report on every PR. The
offline half runs in `npm test`. The half that reads live GitHub state is opt-in
behind `CHECK_LIVE_BRANCH_PROTECTION=1`, because CI's token has only
`contents: read` and cannot read rulesets — a check that cannot run in CI is
better declared opt-in than left to fail confusingly.

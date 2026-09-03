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
| `CodeQL`, `Analyze (…)` | code-scanning **default setup** (not `codeql.yml`) | yes, but see below | not yet — [#89](../../issues/89) |

A required check that never reports does not fail the PR; it pins it at
"Expected — waiting for status to be reported", forever. Requiring the Apple
checks would do exactly that to every PR that does not touch Apple paths.

The CodeQL row is the one worth reading twice, because the obvious reasoning
about it is wrong. `codeql.yml` really does trigger only on `schedule` and
`workflow_dispatch` — but the `CodeQL` and `Analyze (…)` checks appear on pull
requests regardless, because **code-scanning default setup is configured on this
repository** and runs independently of that workflow file. So "requiring CodeQL
would deadlock every PR" is false; the checks do arrive. They are left
unrequired for the ordinary reason instead — nobody has confirmed they report
consistently enough to gate on, and `Analyze (swift)` in particular is slow. That
is [#89](../../issues/89), not this ADR.

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

CodeQL remains unenforced at the merge boundary even though it does report on
pull requests. Requiring it is a reasonable follow-up and is deliberately not
bundled here: it needs evidence that every configured language reports reliably
and promptly on an ordinary PR, which is a separate question from arming
auto-merge. Tracked in [#89](../../issues/89).

The rule above is executable rather than advisory:
[`test/branch-protection.test.ts`](../../test/branch-protection.test.ts) fails if
a required check is drawn from a workflow that cannot report on every PR. The
offline half runs in `npm test`. The half that reads live GitHub state is opt-in
behind `CHECK_LIVE_BRANCH_PROTECTION=1`, because CI's token has only
`contents: read` and cannot read rulesets — a check that cannot run in CI is
better declared opt-in than left to fail confusingly.

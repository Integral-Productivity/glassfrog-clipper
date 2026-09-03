/**
 * What `main` requires at the merge boundary, declared once.
 *
 * These live outside `branch-protection.test.ts` — which is where they were
 * written and where their reasoning still reads — because two suites need them
 * and importing one test module into another duplicates its tests. `node --test`
 * runs each file in its own process, so an `import` of a `.test.ts` re-registers
 * everything in it: a two-test module imported by one other file reports four
 * tests, and the opt-in live check at the bottom of `branch-protection.test.ts`
 * would be registered twice over. Measured before moving them, not assumed.
 *
 * `branch-protection.test.ts` re-exports all three, so nothing that already
 * imported them from there had to change.
 */

/**
 * What `main`'s ruleset requires. Changing this line without changing the
 * ruleset — or the reverse — is what the live check in
 * `test/branch-protection.test.ts` catches.
 *
 * It caught it. On 2026-09-03 the live ruleset required all three of these while
 * this list still read `['verify']` alone, and nothing went red, because the
 * check that compares them is opt-in behind `CHECK_LIVE_BRANCH_PROTECTION=1`
 * and CI does not set it. The two tier-1 contexts were added to the ruleset under
 * [#194](../../issues/194); this list is the half of that change that lands in
 * the repository. Read the gap as evidence about the guard, not only about the
 * drift: a guard whose only teeth are behind an environment variable is a guard
 * nobody is standing behind.
 *
 * Each of these has been observed reporting on a pull request's head under the
 * name it is required by, which is ADR 0018's precondition rather than a
 * courtesy — on #193's head `1467da71`, `verify`, `BDD / Scenarios` and
 * `Software Fitness / Self-compliance` all recorded `success`. Reading the
 * trigger out of the workflow file answers *would it be silent by
 * configuration*; only a pull request answers *is it silent by failure*.
 */
export const REQUIRED_CHECKS = ['verify', 'BDD / Scenarios', 'Software Fitness / Self-compliance'];

/**
 * Whether `main` requires a pull request to be up to date with it before merging
 * — GitHub's `strict_required_status_checks_policy`.
 *
 * This is the half of the collision defence that #83 exposed, and it is worth
 * being precise about what was actually wrong, because the obvious diagnosis is
 * not it. `test/adr-numbering.test.ts` was never the gap: it runs on the *merged*
 * tree GitHub builds from head plus base, so it does see `main`'s ADRs, exactly
 * as its own header claims.
 *
 * The gap was that a green it produced could go stale and still merge. Checks
 * are recorded against a head SHA, and a base-branch move is not a
 * `synchronize` event, so nothing re-runs when `main` gains an ADR underneath an
 * open pull request. With this policy off, that stale pass stays mergeable:
 *
 *   1. #66 merges `docs/adr/0007-*.md`.
 *   2. #61's `verify` is already green — against a tree where 0007 was free.
 *   3. Nothing re-runs. #61 merges. `main` now holds two `0007-*.md`.
 *
 * Turning it on does not make the guard smarter; it makes the guard *binding*,
 * by forcing the merge tree to be rebuilt against a `main` that has moved. It is
 * also why `allow_update_branch` belongs on with it — auto-merge (ADR 0012)
 * needs a way to bring a stale branch forward without a human rebase.
 *
 * This is orthogonal to how many checks are required, which is why `main` going
 * from one required check to three left it untouched: strictness is a property
 * of *when* a required check is evaluated, not of how many there are.
 */
export const REQUIRE_UP_TO_DATE_BRANCHES = true;

/**
 * Which workflow each required check reports from. Declared rather than
 * inferred: mapping a check-run name back to its job would mean parsing job
 * ids, `name:` overrides and matrix expansions, and a parser that gets that
 * subtly wrong fails open — it would find no problem and report green.
 */
export const CHECK_SOURCES: Record<string, string> = {
  verify: 'ci.yml',
  // Both from one workflow, and both carrying a slash that is load-bearing
  // rather than decorative: a caller of a reusable workflow emits
  // `<caller job> / <called job>`, and reproducing the org-canonical context
  // from a local job means putting the whole string in `name:`.
  // `test/workflow-contexts.test.ts` holds that reasoning and pins the names.
  'BDD / Scenarios': 'bdd-and-fitness.yml',
  'Software Fitness / Self-compliance': 'bdd-and-fitness.yml',
};

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { repoSlug } from '../scripts/repo-slug.ts';

/**
 * A fitness function for what `main` is allowed to require.
 *
 * On 2026-09-02 auto-merge could not be armed on any PR in this repository.
 * The repository setting was fine — `allow_auto_merge` was `true` and the
 * viewer held `admin` — but `main` carried no branch protection rule and no
 * ruleset, so `viewerCanEnableAutoMerge` came back `false` on a PR that was
 * mergeable, undrafted and fully green. Auto-merge is a *deferral* primitive:
 * GitHub offers it only when something would otherwise delay the merge, and
 * with nothing required there was nothing to defer. ADR 0012 records the fix.
 *
 * The fix is one line of configuration, so it is not what this guard protects.
 * What it protects is the *next* change to that configuration.
 *
 * A required check whose workflow never reports on a pull request does not fail
 * that pull request. It pins it at "Expected — waiting for status to be
 * reported", and nothing times out. `apple.yml` is the live example here: it is
 * path-filtered to `apple/**`, so requiring `Swift core` would hang every pull
 * request that touches nothing under that path, while looking like a diligent
 * hardening step.
 *
 * Note what this guard deliberately does NOT claim. `codeql.yml` also has no
 * `pull_request` trigger, but the `CodeQL` / `Analyze (…)` checks still appear on
 * pull requests here — they come from code-scanning **default setup**, which is
 * configured on this repository and runs independently of that workflow file.
 * A check name is not owned by the workflow whose name resembles it. That is why
 * `CHECK_SOURCES` is a declared mapping rather than something inferred: mapping a
 * name to the wrong file would make this guard reason confidently about the wrong
 * trigger. Only names actually required on `main` need an entry.
 *
 * So the rule is not "require the important checks". It is: a check may be
 * required only if its workflow runs on *every* pull request. That is a property
 * of the workflow files, which is why it can be checked here rather than trusted
 * to whoever next edits the ruleset.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What `main`'s ruleset requires. Changing this line without changing the
 * ruleset — or the reverse — is what the live check below catches.
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
 * Strictness is a property of *when* a required check is evaluated, not of how
 * many are required, so ADR 0012's reasoning is untouched by the two contexts
 * that joined `verify` in #88.
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
  'BDD / Scenarios': 'bdd-and-fitness.yml',
  'Software Fitness / Self-compliance': 'bdd-and-fitness.yml',
};

export interface PullRequestTrigger {
  /** The workflow has a `pull_request:` trigger at all. */
  runsOnPullRequest: boolean;
  /** That trigger is narrowed by `paths:` / `paths-ignore:`. */
  pathFiltered: boolean;
}

/**
 * Read the pull-request trigger shape out of a workflow's `on:` block.
 *
 * Deliberately a line scan and not a YAML parse: the repo carries no YAML
 * dependency, and the two facts needed here sit at fixed, shallow positions.
 * The limits are real and worth naming — this understands neither `on:` written
 * as a flow mapping (`on: {pull_request: ...}`) nor a `paths` key reached only
 * through an anchor defined in another document. Both are absent here, and
 * `every required check has a workflow whose trigger this can read` below fails
 * loudly if one appears, rather than quietly reading such a file as untriggered.
 */
export function pullRequestTrigger(source: string): PullRequestTrigger {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^on:\s*$/.test(line));
  if (start === -1) return { runsOnPullRequest: false, pathFiltered: false };

  let inPullRequest = false;
  let runsOnPullRequest = false;
  let pathFiltered = false;

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    // A new top-level key ends the `on:` block.
    if (/^\S/.test(line)) break;

    // `pull_request_target:` is a different trigger and must not match here.
    if (/^\s{2}pull_request:\s*$/.test(line)) {
      inPullRequest = true;
      runsOnPullRequest = true;
      continue;
    }
    if (/^\s{2}\S/.test(line)) {
      inPullRequest = false;
      continue;
    }
    if (inPullRequest && /^\s{4}paths(-ignore)?:/.test(line)) pathFiltered = true;
  }

  return { runsOnPullRequest, pathFiltered };
}

export interface UnreliableCheck {
  check: string;
  workflow: string;
  reason: 'no pull_request trigger' | 'path-filtered' | 'workflow missing';
}

/**
 * Every required check that cannot be relied on to report against an arbitrary
 * pull request — which is to say, every one that would hang PRs rather than
 * gate them.
 */
export function unreliablyRequiredChecks(
  required: string[],
  sources: Record<string, string>,
  workflows: Record<string, string>,
): UnreliableCheck[] {
  const problems: UnreliableCheck[] = [];

  for (const check of required) {
    const workflow = sources[check];
    if (workflow === undefined || workflows[workflow] === undefined) {
      problems.push({ check, workflow: workflow ?? '(unmapped)', reason: 'workflow missing' });
      continue;
    }

    const trigger = pullRequestTrigger(workflows[workflow]);
    if (!trigger.runsOnPullRequest) problems.push({ check, workflow, reason: 'no pull_request trigger' });
    else if (trigger.pathFiltered) problems.push({ check, workflow, reason: 'path-filtered' });
  }

  return problems.sort((a, b) => a.check.localeCompare(b.check));
}

async function workflowSources(): Promise<Record<string, string>> {
  const dir = join(root, '.github', 'workflows');
  const names = (await readdir(dir)).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));

  return Object.fromEntries(
    await Promise.all(names.map(async (name) => [name, await readFile(join(dir, name), 'utf8')] as const)),
  );
}

test('every required check reports on every pull request', async () => {
  const problems = unreliablyRequiredChecks(REQUIRED_CHECKS, CHECK_SOURCES, await workflowSources());

  assert.deepEqual(
    problems,
    [],
    'a required check cannot report on every PR — it will pin pull requests at "waiting for status" rather than gate them; see ADR 0012',
  );
});

test('the guard is looking at real workflows, not an empty set', async () => {
  // A moved directory would throw, but a filter that stopped matching would
  // not: it would map no workflows, find every check "missing", and — worse in
  // the other direction — a future refactor that fed it `{}` would report every
  // check unreliable rather than green. Pin the corpus so neither drifts silently.
  const workflows = await workflowSources();

  assert.ok(
    Object.keys(workflows).length >= 5,
    `expected the workflow corpus to be present, read ${Object.keys(workflows).length} files`,
  );
  for (const workflow of Object.values(CHECK_SOURCES)) {
    assert.ok(workflow in workflows, `${workflow} is mapped by CHECK_SOURCES but absent from .github/workflows`);
  }
});

test('the guard detects a path-filtered check being required', async () => {
  // The red half of red-then-green, kept in the suite rather than performed once
  // by hand. `apple.yml` is real and really is path-filtered, so requiring
  // `Swift core` really would hang PRs that touch nothing under `apple/**`.
  // If `unreliablyRequiredChecks` ever regressed to returning `[]`, this fails
  // rather than the green test passing forever over a guard that had stopped
  // guarding.
  const problems = unreliablyRequiredChecks(
    ['Swift core', 'verify'],
    { 'Swift core': 'apple.yml', verify: 'ci.yml' },
    await workflowSources(),
  );

  assert.deepEqual(problems, [{ check: 'Swift core', workflow: 'apple.yml', reason: 'path-filtered' }]);
});

test('the guard detects a workflow that cannot report on a pull request', () => {
  // A fixture rather than a real file on purpose. The obvious candidate,
  // `codeql.yml`, is a trap: it has no `pull_request` trigger, but its check
  // names arrive on PRs anyway via code-scanning default setup. Asserting
  // against it would tie this red half to a premise that is already false, and
  // would go red the day someone gives that workflow a trigger it never needed.
  const scheduledOnly = 'on:\n  schedule:\n    - cron: \'0 8 * * 1\'\n  workflow_dispatch:\n\njobs:\n';

  assert.deepEqual(unreliablyRequiredChecks(['Nightly'], { Nightly: 'nightly.yml' }, { 'nightly.yml': scheduledOnly }), [
    { check: 'Nightly', workflow: 'nightly.yml', reason: 'no pull_request trigger' },
  ]);
});

test('pull_request_target is not read as a pull_request trigger', () => {
  // cla.yml triggers on `pull_request_target`. A prefix match would read that
  // as a pull-request trigger and wave through a check that reports under
  // different conditions than the guard assumes.
  assert.deepEqual(pullRequestTrigger('on:\n  pull_request_target:\n    types: [opened]\n\njobs:\n'), {
    runsOnPullRequest: false,
    pathFiltered: false,
  });
});

test('a trigger with types but no paths is not read as filtered', () => {
  // claude-code-review.yml narrows by `types:`, which does not stop it
  // reporting on an ordinary PR. Only `paths:` / `paths-ignore:` do.
  assert.deepEqual(
    pullRequestTrigger('on:\n  pull_request:\n    types: [opened, synchronize]\n\npermissions:\n  contents: read\n'),
    { runsOnPullRequest: true, pathFiltered: false },
  );
});

test('an unmapped check is a failure, not a skip', () => {
  // A check required on main that nothing in CHECK_SOURCES accounts for is
  // exactly the state this guard exists to fail on. Skipping it would let the
  // guard pass over precisely the check it can no longer see.
  assert.deepEqual(unreliablyRequiredChecks(['mystery'], {}, { 'ci.yml': 'on:\n  pull_request:\n' }), [
    { check: 'mystery', workflow: '(unmapped)', reason: 'workflow missing' },
  ]);
});

/**
 * The live half.
 *
 * Opt-in rather than always-on, because CI's `GITHUB_TOKEN` carries only
 * `contents: read` and cannot read rulesets — an always-on version would fail
 * in CI for a reason that has nothing to do with the invariant. Run it with a
 * token that can:
 *
 *     CHECK_LIVE_BRANCH_PROTECTION=1 GITHUB_TOKEN=$(gh auth token) npm test
 */
const LIVE = process.env.CHECK_LIVE_BRANCH_PROTECTION === '1';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
/**
 * Which repository the live check reads. Derived from `package.json` rather
 * than written out again: this test is skipped in every ordinary run, so a
 * literal here would be a copy of the repository's name that nothing reads
 * until someone runs the opt-in check by hand — exactly how #62's rename could
 * have left it stale and green. `repo-identity.test.ts` holds the two copies
 * that genuinely must exist separately against each other.
 */
const SLUG = repoSlug();

test('main actually requires the checks REQUIRED_CHECKS names', { skip: !LIVE || !TOKEN }, async () => {
  const response = await fetch(`https://api.github.com/repos/${SLUG}/rules/branches/main`, {
    headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json' },
  });
  assert.ok(response.ok, `GitHub returned ${response.status} reading the rules on main`);

  const rules = (await response.json()) as Array<{
    type: string;
    parameters?: {
      required_status_checks?: Array<{ context: string }>;
      strict_required_status_checks_policy?: boolean;
    };
  }>;

  const live = rules
    .filter((rule) => rule.type === 'required_status_checks')
    .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
    .map((check) => check.context)
    .sort();

  assert.deepEqual(
    live,
    [...REQUIRED_CHECKS].sort(),
    'main’s ruleset and REQUIRED_CHECKS disagree — one of them was changed without the other',
  );

  const strict = rules
    .filter((rule) => rule.type === 'required_status_checks')
    .map((rule) => rule.parameters?.strict_required_status_checks_policy === true);

  assert.deepEqual(
    strict,
    [REQUIRE_UP_TO_DATE_BRANCHES],
    'main’s up-to-date-branch policy and REQUIRE_UP_TO_DATE_BRANCHES disagree — with it off, a check that passed against an older main stays green and can merge a duplicate anyway; see #83',
  );
});

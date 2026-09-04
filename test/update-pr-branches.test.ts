import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  AGENT_BRANCH_PREFIX,
  HOLD_LABELS,
  hasFailingChecks,
  selectStalePrs,
  skipReason,
} from '../scripts/select-stale-prs.ts';

/**
 * A guard for the one workflow in this repository that rewrites branches.
 *
 * `gh pr update-branch --rebase` replaces every commit SHA on a pull request's
 * head. That is the point — the bare form reconciles with a merge commit, which
 * makes a one-commit pull request into a two-commit one and silently forfeits
 * its AI-authorship note (ADR 0009, #130, #163). But it also means selecting
 * the wrong pull request force-pushes over somebody's work.
 *
 * So the selection is a pure function and this is where it is exercised. The
 * workflow calls the same module, rather than restating the rule in `jq`, which
 * is the only reason these fixtures are evidence about what actually runs.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = '.github/workflows/update-pr-branches.yml';

/** A pull request as `gh pr list --json` returns it, with the fields that matter. */
const pr = (overrides: Record<string, unknown> = {}) => ({
  number: 1,
  mergeStateStatus: 'BEHIND',
  isDraft: false,
  labels: [],
  headRefName: 'claude/some-work',
  autoMergeRequest: null,
  statusCheckRollup: [],
  ...overrides,
});

test('a behind agent-owned pull request with clean checks is selected', () => {
  assert.equal(skipReason(pr()), null);
  assert.deepEqual(selectStalePrs([pr()]), [1]);
});

test('a behind pull request with auto-merge armed is selected even off an agent branch', () => {
  const armed = pr({ number: 2, headRefName: 'feature/hand-written', autoMergeRequest: { enabledAt: 'now' } });

  assert.equal(skipReason(armed), null);
  assert.deepEqual(selectStalePrs([armed]), [2]);
});

test('everything the workflow must not touch is refused, with its reason', () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ mergeStateStatus: 'CLEAN' }, /not behind \(CLEAN\)/],
    [{ mergeStateStatus: 'DIRTY' }, /not behind \(DIRTY\)/],
    [{ isDraft: true }, /draft/],
    [{ labels: [{ name: 'hold-for-review' }] }, /held by hold-for-review/],
    [{ labels: [{ name: 'Ready-For-Human' }] }, /held by ready-for-human/],
    [{ headRefName: 'someone-elses-branch' }, /no auto-merge and not an agent branch/],
    [{ statusCheckRollup: [{ conclusion: 'FAILURE' }] }, /checks are failing/],
    [{ statusCheckRollup: [{ state: 'FAILURE' }] }, /checks are failing/],
  ];

  for (const [overrides, expected] of cases) {
    const reason = skipReason(pr(overrides));
    assert.ok(reason !== null, `expected ${JSON.stringify(overrides)} to be refused`);
    assert.match(reason, expected);
  }

  assert.deepEqual(selectStalePrs(cases.map(([overrides], i) => pr({ ...overrides, number: 100 + i }))), []);
});

test('a queued check does not block an update', () => {
  // PENDING is the ordinary state right after a push. Refusing to update a
  // pull request with a check in flight would make this workflow fire almost
  // never, which is the failure #126 is about.
  const queued = pr({ statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }] });

  assert.equal(hasFailingChecks(queued), false);
  assert.equal(skipReason(queued), null);
});

test('the guard detects a selector that stopped refusing anything', () => {
  // The red half of red-then-green. Every case above asserts something is
  // refused, so a `skipReason` that returned null unconditionally would fail
  // them — but `selectStalePrs` returning everything is the shape that would
  // actually force-push over somebody's branch, so pin it directly.
  const dangerous = [
    pr({ number: 10, isDraft: true }),
    pr({ number: 11, mergeStateStatus: 'CLEAN' }),
    pr({ number: 12, headRefName: 'human/wip' }),
  ];

  assert.deepEqual(selectStalePrs(dangerous), [], 'the selector must refuse all three');
  assert.notDeepEqual(selectStalePrs(dangerous), [10, 11, 12]);
});

test('the workflow rebases rather than merging, and calls the tested selector', async () => {
  // The two facts that make the fixtures above evidence about production.
  // Without the first, this workflow would industrialise #130; without the
  // second, the selection tested here would not be the selection that runs.
  const workflow = await readFile(join(root, WORKFLOW), 'utf8');
  const steps = workflow.slice(workflow.indexOf('    steps:'));

  assert.match(steps, /gh pr update-branch --rebase/, 'the bare form reconciles with a merge commit — see ADR 0009');
  assert.doesNotMatch(
    steps,
    /gh pr update-branch(?! --rebase)/,
    'every update-branch call must pass --rebase',
  );
  assert.match(steps, /node scripts\/select-stale-prs\.ts/, 'the workflow must use the tested selector');
});

test('the constants the workflow depends on are still the ones tested', () => {
  // A rename here without a matching fixture would leave the tests above
  // green while the workflow selected a different population.
  assert.ok(HOLD_LABELS.includes('hold-for-review'));
  assert.ok(HOLD_LABELS.includes('ready-for-human'));
  assert.equal(AGENT_BRANCH_PREFIX, 'claude/');
});

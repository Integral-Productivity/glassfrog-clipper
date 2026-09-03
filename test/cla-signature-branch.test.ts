import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * The CLA workflow must not store signatures on the branch this repository
 * protects.
 *
 * `contributor-assistant/github-action` records a signature by *pushing*
 * `.github/cla-signatures.json` to the branch named by its `branch:` input.
 * `main`'s ruleset requires `verify` (ADR 0012), and that push is not a pull
 * request, so it carries no `verify` and the ruleset rejects it:
 *
 *   Error occurred when creating the signed contributors file: Repository rule
 *   violations found. Required status check "verify" is expected.
 *
 * Nobody can then sign, ever. That is not hypothetical — it is what run #164
 * did on 2026-09-03, the first CLA run in this repository's history to get far
 * enough to fail for a reason of its own (#179). ADR 0019 moved the record to
 * `cla-signatures`.
 *
 * WHY A TEST AND NOT A COMMENT. The failure is silent in the way that matters:
 * it appears only inside the `cla` check, which nothing requires, so reverting
 * `branch:` to `main` would go red nowhere. That is the same shape as #179
 * itself, where 152 startup failures raised nothing. A guard that runs under
 * `verify` is the one place this can go red.
 *
 * What this does NOT cover: a ruleset later grown to match `cla-signatures` by
 * pattern would reintroduce the failure with this file unchanged and green.
 * That needs a live API check, in the shape of `branch-protection.test.ts`'s
 * `CHECK_LIVE_BRANCH_PROTECTION` half. It is not built yet — this guard is the
 * offline half, and saying so is better than implying cover it does not give.
 */

const WORKFLOW = '.github/workflows/cla.yml';

/** The branch whose ruleset would reject the action's push. See ADR 0012. */
const PROTECTED_BRANCH = 'main';

/**
 * The `branch:` input of the CLA step — the branch signatures are pushed to.
 *
 * Matched on its own line rather than parsed as YAML so this test needs no
 * dependency. `path-to-signatures` also contains the word "signatures", hence
 * the anchored `branch:` key rather than a substring search.
 */
export const signatureBranch = (source: string): string | undefined =>
  source.match(/^\s+branch:\s*'([^']+)'/m)?.[1];

test('the CLA workflow declares a signature branch', async () => {
  const branch = signatureBranch(await readFile(WORKFLOW, 'utf8'));

  assert.ok(
    branch,
    `no \`branch:\` input found in ${WORKFLOW} — the action would fall back to its own default, ` +
      'and this guard would pass while knowing nothing',
  );
});

test('signatures are not stored on the protected branch', async () => {
  const branch = signatureBranch(await readFile(WORKFLOW, 'utf8'));

  assert.notEqual(
    branch,
    PROTECTED_BRANCH,
    `${WORKFLOW} stores CLA signatures on '${PROTECTED_BRANCH}', whose ruleset requires a check ` +
      'the action\'s push cannot carry. No contributor would be able to sign, and nothing would ' +
      'go red except the `cla` check, which is not required. See docs/adr/0019.',
  );
});

test('the guard detects the branch it exists to catch', () => {
  // The red half of red-then-green, kept in the suite rather than performed
  // once by hand. Without it, `signatureBranch` could return undefined
  // unconditionally and the test above would pass forever.
  const planted = ["jobs:", "  cla:", "    steps:", "      - with:", "          branch: 'main'"].join('\n');

  assert.equal(signatureBranch(planted), PROTECTED_BRANCH);
});

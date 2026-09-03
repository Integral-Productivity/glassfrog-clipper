import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { repoSlug } from '../scripts/repo-slug.ts';

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
 * WHAT RUNS, AND WHAT DOES NOT. The offline tests below always run. The live
 * one — the branch exists and is unprotected — needs the network and skips
 * unless `CHECK_LIVE_CLA_BRANCH=1`, so it is not a standing guard. That
 * distinction is stated rather than blurred, because ADR 0019 already had to be
 * corrected once for asserting something about this action nobody had checked:
 * it claimed the action creates the branch on first signature. It does not.
 * `src/persistence/persistence.ts` only calls `createOrUpdateFileContents`, and
 * GitHub's contents API needs the branch to exist, so `cla-signatures` is
 * seeded rather than assumed into being.
 *
 * Hence the second offline test. Three surfaces name this branch — `cla.yml`,
 * `CLA.md`, and ADR 0019 — and a rename that updates some of them is exactly
 * the drift nobody notices, because the only thing that would go red is the
 * `cla` check, which nothing requires.
 */

const WORKFLOW = '.github/workflows/cla.yml';

/** The other two places the branch of record is named to a reader. */
const AGREEMENT = 'CLA.md';
const DECISION = 'docs/adr/0019-the-cla-signature-record-lives-off-the-protected-branch.md';

/** Set `CHECK_LIVE_CLA_BRANCH=1` to also assert the branch exists and is unprotected. */
const LIVE = process.env.CHECK_LIVE_CLA_BRANCH === '1';

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

test('every surface that names the signature branch names the same one', async () => {
  const branch = signatureBranch(await readFile(WORKFLOW, 'utf8'));
  assert.ok(branch, `no \`branch:\` input in ${WORKFLOW}`);

  for (const path of [AGREEMENT, DECISION]) {
    assert.ok(
      (await readFile(path, 'utf8')).includes(branch),
      `${path} never names '${branch}', the branch ${WORKFLOW} stores signatures on. ` +
        'One of them was renamed without the others, and the only thing that would go red is the ' +
        '`cla` check, which nothing requires. See docs/adr/0019.',
    );
  }
});

/**
 * A plain git branch name: path segments of word characters, dots and dashes.
 *
 * Narrower than git allows, on purpose. Both halves of the URL below are read
 * out of files in the tree, and CodeQL is right that file data reaching an
 * outbound request is worth a second look: a `branch:` of `../../elsewhere`
 * would point this request at another repository and the assertion would then
 * be about something else entirely. Validating is also a real assertion in its
 * own right — a signature branch whose name is not a branch name is a bug
 * whatever the network says.
 */
const BRANCH_NAME = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/** `owner/repo`, the only shape this URL can safely take. */
const REPO_SLUG = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

test('the signature branch exists and is unprotected', { skip: !LIVE }, async () => {
  const branch = signatureBranch(await readFile(WORKFLOW, 'utf8'));
  const slug = repoSlug();

  assert.match(
    branch ?? '',
    BRANCH_NAME,
    `${WORKFLOW} names a signature branch that is not a plain branch name; refusing to build a ` +
      'request URL from it',
  );
  assert.match(slug, REPO_SLUG, 'package.json does not yield an owner/repo slug');

  const path = [slug, 'branches', branch ?? ''].flatMap((part) => part.split('/'));
  const response = await fetch(
    `https://api.github.com/repos/${path.map(encodeURIComponent).join('/')}`,
    { headers: { accept: 'application/vnd.github+json' } },
  );

  // 404 is the finding. Anything else non-200 means the question was not
  // answered — a proxy, a rate limit, a revoked token — and reporting that as
  // "the branch is missing" would be a confident wrong diagnosis, which is the
  // failure this whole guard descends from. Inconclusive still fails, because
  // this test is opt-in and a silent pass would be worse; it just fails saying
  // what actually happened.
  assert.notEqual(
    response.status,
    404,
    `branch '${branch}' does not exist. The action does not create it — it only calls ` +
      'createOrUpdateFileContents, and the contents API needs the branch already there. ' +
      'Nobody can sign until it is seeded. See docs/adr/0019.',
  );

  assert.equal(
    response.status,
    200,
    `could not determine whether branch '${branch}' exists — GitHub answered HTTP ` +
      `${response.status}, which is neither the branch nor its absence. This says nothing about ` +
      'the branch; check network, proxy, or rate limiting before reading anything into it.',
  );

  assert.equal(
    ((await response.json()) as { protected: boolean }).protected,
    false,
    `branch '${branch}' is protected. The action records a signature by pushing to it, and that ` +
      'push carries no status check, so a ruleset rejects it and signing stops silently.',
  );
});

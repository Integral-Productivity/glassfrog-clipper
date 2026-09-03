import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { repoSlug, slugFromRepositoryUrl } from '../scripts/repo-slug.ts';

/**
 * A fitness function for one fact written down more than once.
 *
 * Which repository this is has to live in `package.json`'s `repository.url`,
 * because npm reads it, and in `docs/agents/labels.json`'s `repo`, because
 * `check-labels.mjs` passes it to `gh --repo` from a scheduled workflow that
 * never sees `package.json`. Neither can be deleted in favour of the other.
 *
 * Nothing held them together, and there was a third copy besides: a literal
 * `SLUG` in `branch-protection.test.ts`. That one is now derived rather than
 * declared — the cheapest guard for a duplicate fact is not having it — but
 * these two remain, so something has to compare them.
 *
 * The gap this closes is specific. `label-manifest.test.ts` compares the
 * manifest's label groups against the prose document and never reads its
 * `repo`. The live ruleset check that consumed `SLUG` is skipped unless
 * `CHECK_LIVE_BRANCH_PROTECTION=1` and a ruleset-capable token are both set,
 * which is never during `npm test` or CI. So a rename that updated one copy
 * and missed the other was green, and stayed green until someone ran the
 * opt-in check by hand or the scheduled label workflow quietly reconciled some
 * other repository's labels.
 *
 * That is not hypothetical: #62 renamed this repository, and this file is the
 * guard that rename should have had. It needs no network and no token, so
 * unlike the live check it can be always-on, and it fails on the commit that
 * introduces the drift rather than whenever someone next happens to look.
 *
 * `package.json` is the anchor because it is the copy npm itself reads.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('slugFromRepositoryUrl reads both remote URL forms', () => {
  assert.equal(slugFromRepositoryUrl('git+https://github.com/o/n.git'), 'o/n');
  assert.equal(slugFromRepositoryUrl('https://github.com/o/n'), 'o/n');
  assert.equal(slugFromRepositoryUrl('git@github.com:o/n.git'), 'o/n');
  assert.throws(() => slugFromRepositoryUrl('https://gitlab.com/o/n.git'), /cannot read a GitHub slug/);
});

test('the label manifest names the repository package.json declares', async () => {
  const labels = JSON.parse(await readFile(join(root, 'docs', 'agents', 'labels.json'), 'utf8')) as {
    repo: string;
  };

  assert.equal(
    labels.repo,
    repoSlug(),
    'docs/agents/labels.json "repo" disagrees with package.json — the label-drift guard would reconcile the wrong repository',
  );
});

/**
 * The copies above are the ones that must exist. This catches a new one.
 *
 * While #62 was in flight, #117 added a fourth: a hard-coded fallback slug in
 * `scripts/check-adr-claims.ts`, already naming the old repository the same day
 * it was renamed. Nothing was wrong with that commit — the copy was simply
 * invisible, which is the whole failure mode. So rather than list the copies we
 * know about, refuse a `<owner>/<name>` literal in the two directories that run
 * against the live repository, and point the next author at `repoSlug()`.
 *
 * `docs/` is deliberately out of scope: prose cites the repository by name all
 * the time, and an ADR that records a rename has to name both sides of it.
 */
test('no script or test hard-codes the repository slug', async () => {
  const dirs = ['scripts', 'test'];
  const literal = /['"`]Integral-Productivity\/[A-Za-z0-9._-]+['"`]/;
  const offenders: string[] = [];

  for (const dir of dirs) {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|mjs|js)$/.test(entry.name)) continue;
      const source = await readFile(join(root, dir, entry.name), 'utf8');
      source.split('\n').forEach((line, index) => {
        if (literal.test(line)) offenders.push(`${dir}/${entry.name}:${index + 1}: ${line.trim()}`);
      });
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `hard-coded repository slug — import repoSlug() from scripts/repo-slug.ts instead:\n${offenders.join('\n')}`,
  );
});

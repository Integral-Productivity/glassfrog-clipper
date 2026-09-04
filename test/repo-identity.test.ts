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

/**
 * Every `<owner>/<name>` this project could be, as named in a prose document.
 *
 * Scoped to the owner deliberately. A document naming
 * `anthropics/claude-code` is citing somebody else's repository, which is
 * ordinary; a document naming a *different* `Integral-Productivity/…` where it
 * means this one is the drift worth catching.
 *
 * Returned in file order with duplicates collapsed, so the assertion below can
 * report what it actually found rather than only that something was wrong.
 */
export function ownedSlugsNamedIn(markdown: string): string[] {
  const found = [...markdown.matchAll(/\bIntegral-Productivity\/[A-Za-z0-9._-]+/g)].map((match) => match[0]);
  return [...new Set(found)];
}

test('the agent-facing identity note names the repository package.json declares', async () => {
  const doc = await readFile(join(root, 'docs', 'agents', 'repo-identity.md'), 'utf8');
  const named = ownedSlugsNamedIn(doc);

  // Reading the corpus, not an empty string: a moved or renamed file would
  // throw above, but a document that stopped naming the repository at all would
  // otherwise satisfy "names no wrong slug" vacuously.
  assert.ok(named.length > 0, 'docs/agents/repo-identity.md names no repository at all');

  assert.deepEqual(
    named,
    [repoSlug()],
    `docs/agents/repo-identity.md names a repository package.json does not: ${named.join(', ')}`,
  );
});

test('the guard detects an identity note naming the wrong repository', () => {
  // The red half of red-then-green. Without it, `ownedSlugsNamedIn` could
  // return [] unconditionally and the test above would pass forever over a
  // document that had gone stale — which is the #62 failure mode exactly.
  //
  // The fixture is built from `repoSlug()`'s owner rather than written out,
  // because `no script or test hard-codes the repository slug` below refuses a
  // literal here too. It caught the first draft of this very test, which is a
  // fair demonstration that it works.
  const owner = repoSlug().split('/')[0];
  const wrong = `${owner}/glassfrog-clip`;
  const stale = `The slug is \`${wrong}\`, renamed from something else.`;

  assert.deepEqual(ownedSlugsNamedIn(stale), [wrong]);
  assert.notDeepEqual(ownedSlugsNamedIn(stale), [repoSlug()]);
});

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

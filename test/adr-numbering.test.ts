import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * A fitness function for ADR filename numbering.
 *
 * On 2026-08-31 two ADRs both claimed `0005`, written by concurrent sessions
 * whose PRs merged two minutes apart. The number was genuinely free when each
 * was written, so neither author was careless. The pre-claim check that missed
 * it searched PR titles and bodies; the colliding PR carried the number only in
 * a file path, which that search does not index. Listing `docs/adr/` could not
 * have helped either — the other PR was still unmerged. #42 renumbered the
 * later one to 0006.
 *
 * No pre-claim search can close that window, because the collision does not
 * exist until both branches meet. A check that runs on the merged tree can:
 * the second PR goes red on `main`'s content, before the duplicate lands rather
 * than after. This is that check. CI already runs `npm test`, so this file is
 * the guard — there is deliberately no separate workflow step to drift from it.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The collision rule, as a pure function over filenames so it can be exercised
 * against a fixture as well as against the real directory. A guard whose red
 * path is never taken is an assertion, not a test.
 *
 * Returns each duplicated number with the files claiming it, sorted, so a
 * failure message names the files to fix rather than only the count.
 */
export function duplicateAdrNumbers(filenames: string[]): Array<{ number: string; files: string[] }> {
  const byNumber = new Map<string, string[]>();

  for (const filename of filenames) {
    const number = /^(\d{4})-.+\.md$/.exec(filename)?.[1];
    if (number === undefined) continue;
    const claimed = byNumber.get(number) ?? [];
    claimed.push(filename);
    byNumber.set(number, claimed);
  }

  return [...byNumber.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([number, files]) => ({ number, files: [...files].sort() }))
    .sort((a, b) => a.number.localeCompare(b.number));
}

async function adrFilenames(): Promise<string[]> {
  return (await readdir(join(root, 'docs', 'adr'))).filter((name) => name.endsWith('.md'));
}

test('no two ADRs claim the same number', async () => {
  const duplicates = duplicateAdrNumbers(await adrFilenames());

  assert.deepEqual(
    duplicates,
    [],
    'two ADRs share a number — renumber the later one to the next free slot and update any references to it',
  );
});

test('the guard detects a collision it is shown', () => {
  // The red half of red-then-green, kept in the suite rather than performed
  // once by hand. Without it, `duplicateAdrNumbers` could return `[]`
  // unconditionally and the test above would still pass forever.
  const colliding = [
    '0001-record-architecture-decisions.md',
    '0005-the-open-source-path-runs-through-a-public-sdk.md',
    '0005-queue-health-is-measured-from-capture-not-from-last-touch.md',
  ];

  assert.deepEqual(duplicateAdrNumbers(colliding), [
    {
      number: '0005',
      files: [
        '0005-queue-health-is-measured-from-capture-not-from-last-touch.md',
        '0005-the-open-source-path-runs-through-a-public-sdk.md',
      ],
    },
  ]);
});

test('the guard is looking at real ADRs, not at an empty list', async () => {
  // `readdir` on a moved directory would throw, but a filter that stopped
  // matching would not — it would parse no filenames, find no duplicates, and
  // report green over a guard that had quietly stopped guarding.
  const filenames = await adrFilenames();
  const numbered = filenames.filter((name) => /^\d{4}-.+\.md$/.test(name));

  assert.ok(numbered.length >= 6, `expected the ADR corpus to be present, parsed ${numbered.length} numbered files`);
  assert.deepEqual(
    filenames.filter((name) => !numbered.includes(name)),
    [],
    'every .md in docs/adr must carry a NNNN- prefix, or the guard cannot see it',
  );
});

test('an unnumbered filename is not read as claiming a number', () => {
  // Two files with no numeric prefix are not a collision, and must not be
  // reported as one — a guard that cries wolf on `README.md` gets disabled.
  assert.deepEqual(duplicateAdrNumbers(['README.md', 'template.md', 'notes.md']), []);
});

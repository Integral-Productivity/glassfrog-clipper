import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * A fitness function for the Definition of Done's first global clause:
 *
 *   "All 22 requirements are implemented or explicitly deferred in writing."
 *
 * Stated as prose, that is a claim someone has to re-audit by hand every time
 * the code moves. Stated here, it fails the moment a requirement loses its last
 * reference — which is how a requirement quietly stops being satisfied while
 * everything still passes.
 *
 * This checks traceability, not correctness: the behavioural assertions live in
 * the other suites. What it prevents is a requirement going *unclaimed*.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const TOTAL_REQUIREMENTS = 22;

/**
 * Requirements deliberately not implemented here, each with the issue that
 * carries it. The plan's Scope Boundaries defer these; this is that deferral
 * made executable, so "deferred" cannot silently become "forgotten".
 *
 * Empty since issue #3 landed telemetry: R13 was the only entry, and it is now
 * implemented in src/telemetry.ts and enforced by test/telemetry.test.ts and
 * test/telemetry-ownership.test.ts. The list stays because the mechanism is
 * what matters — the next deferral has somewhere to be written down.
 */
const DEFERRED: Record<number, string> = {};

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...(await filesUnder(join(dir, entry.name))));
    else if (entry.name.endsWith('.ts')) out.push(join(dir, entry.name));
  }
  return out;
}

test('every requirement is traceable to source, to a test, or to a written deferral', async () => {
  const paths = [...(await filesUnder('src')), ...(await filesUnder('test'))];
  const corpus = (await Promise.all(paths.map((p) => readFile(join(root, p), 'utf8')))).join('\n');

  const referenced = new Set<number>();
  for (const match of corpus.matchAll(/\bR(\d{1,2})\b/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= TOTAL_REQUIREMENTS) referenced.add(n);
  }

  const unclaimed: string[] = [];
  for (let n = 1; n <= TOTAL_REQUIREMENTS; n += 1) {
    if (referenced.has(n) || n in DEFERRED) continue;
    unclaimed.push(`R${n}`);
  }

  assert.deepEqual(
    unclaimed,
    [],
    'each requirement must be cited where it is implemented or tested, or listed in DEFERRED with its issue',
  );
});

test('every deferred requirement names the issue that carries it', () => {
  for (const [requirement, issue] of Object.entries(DEFERRED)) {
    assert.match(issue, /^https:\/\/github\.com\/.+\/issues\/\d+$/, `R${requirement} needs a real issue link`);
  }
});

test('the deferral list has not quietly grown', () => {
  // A requirement moving from implemented to deferred is a scope change, and
  // scope changes belong in a conversation rather than in a diff.
  assert.deepEqual(Object.keys(DEFERRED).map(Number), []);
});

test('every requirement is now implemented, none merely deferred', () => {
  // The state issue #3 was filed to reach. Reverting it should cost a
  // deliberate edit to this assertion, not a quiet re-entry in DEFERRED.
  assert.equal(Object.keys(DEFERRED).length, 0);
});

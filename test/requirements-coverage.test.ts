import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFERRED,
  TOTAL_REQUIREMENTS,
  TRACED_DIRECTORIES,
  malformedDeferrals,
  tracedCorpus,
  unclaimedRequirements,
} from '../fitness/checks/requirements-traceability.ts';

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
 *
 * The rule moved to `fitness/checks/requirements-traceability.ts` (issue #69)
 * so the fitness gate can report it too. It is still asserted here, on every
 * PR, under `npm test` — one implementation, two reporting surfaces. The scanned
 * corpus grew to include `features/` at the same time: a scenario naming R11 is
 * traceability in exactly the sense this means. See docs/adr/0010.
 */

test('every requirement is traceable to source, to a test, or to a written deferral', async () => {
  assert.deepEqual(
    unclaimedRequirements(await tracedCorpus()),
    [],
    'each requirement must be cited where it is implemented or tested, or listed in DEFERRED with its issue',
  );
});

test('every deferred requirement names the issue that carries it', () => {
  assert.deepEqual(malformedDeferrals(), [], 'a deferral without a real issue link is not a deferral');
});

test('the deferral list has not quietly grown', () => {
  // A requirement moving from implemented to deferred is a scope change, and
  // scope changes belong in a conversation rather than in a diff.
  assert.deepEqual(Object.keys(DEFERRED).map(Number), [13]);
});

test('the guard detects a requirement that has lost its last reference', () => {
  // The red half, kept in the suite rather than performed once by hand. Without
  // it, `unclaimedRequirements` could return `[]` unconditionally and the test
  // above would pass forever over a guard that had stopped guarding.
  assert.deepEqual(unclaimedRequirements('R1 R2 R3', {}, 5), ['R4', 'R5']);
  assert.deepEqual(unclaimedRequirements('R1 R2 R3', { 4: 'x', 5: 'y' }, 5), []);
});

test('the corpus it scans is real, and includes the scenarios', async () => {
  // A path list that stopped resolving would read an empty corpus, find every
  // requirement unclaimed, and go red — but a *filter* that stopped matching
  // would read nothing and report green. This pins the corpus down.
  const corpus = await tracedCorpus();

  assert.ok(corpus.length > 10_000, `the traced corpus was only ${corpus.length} characters`);
  assert.ok(
    corpus.includes('Feature: Clipping a page into GlassFrog'),
    'features/ must be in the corpus — a scenario citing a requirement is traceability',
  );
  assert.deepEqual([...TRACED_DIRECTORIES], ['src', 'test', 'features']);
  assert.equal(TOTAL_REQUIREMENTS, 22);
});

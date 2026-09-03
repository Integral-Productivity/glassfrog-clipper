import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adrFilenames,
  adrHeadings,
  duplicateAdrNumbers,
  numberedHeadings,
} from '../fitness/checks/adr-numbering.ts';

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
 * than after.
 *
 * WHERE THE RULE LIVES. The rules themselves moved to
 * `fitness/checks/adr-numbering.ts` (issue #69) so the `Software Fitness /
 * Self-compliance` gate can report them. They did not move *out* of here: this
 * file still asserts every one of them under `npm test`, including the two
 * red-half fixtures that keep the guards from rotting into unconditional
 * passes. One implementation, two reporting surfaces — which is what the
 * original note in this header meant by "no separate workflow step to drift
 * from it". A second *implementation* is the thing that drifts; a second
 * reporter of the same function is not. See docs/adr/0010.
 *
 * WHAT INVERTED, AND WHAT DID NOT. The heading rule below used to require
 * every heading to repeat its filename's number. ADR 0015 took the number off
 * the heading instead of guarding the agreement of two copies of it, so the
 * rule now fails a heading that carries a number at all. The *collision* rule
 * is untouched and still guards a live race: 0015 kept sequential allocation
 * deliberately, changing what losing the race costs rather than whether it can
 * happen.
 */
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

test('no ADR heading carries a number', async () => {
  const numbered = numberedHeadings(await adrHeadings());

  assert.deepEqual(
    numbered,
    [],
    'an ADR heading carries a number — the number belongs to the filename alone (docs/adr/0015), so that a renumber stays a pure `git mv`',
  );
});

test('the guard detects the heading a renumber would leave behind', () => {
  // The exact tree #42 produced: the file renamed to 0006 with the heading
  // still reading `# 5.`. Under the old convention that was a *mismatch*
  // between two copies of the number; under 0015 it is simpler — the heading
  // should not have carried a number in the first place, so both files below
  // are reported, including the one whose number was never stale. The red half
  // of red-then-green, kept in the suite rather than performed by hand.
  assert.deepEqual(
    numberedHeadings([
      {
        filename: '0005-the-open-source-path-runs-through-a-public-sdk.md',
        heading: '# 5. The open-source path runs through a public SDK, not a vendored fork',
      },
      {
        filename: '0006-queue-health-is-measured-from-capture-not-from-last-touch.md',
        heading: '# 5. Queue health is measured from capture, not from last touch',
      },
    ]).map((m) => m.filename),
    [
      '0005-the-open-source-path-runs-through-a-public-sdk.md',
      '0006-queue-health-is-measured-from-capture-not-from-last-touch.md',
    ],
  );
});

test('a missing heading is a failure, not a skip', () => {
  // Inverting the rule must not turn "no heading at all" into a pass. A file
  // with no `# ` line trivially carries no number, and skipping it would let
  // the guard pass over precisely the file it can no longer see.
  assert.deepEqual(
    numberedHeadings([{ filename: '0007-no-heading-at-all.md', heading: undefined }]).map((m) => m.filename),
    ['0007-no-heading-at-all.md'],
  );
});

test('a title-only heading is what the rule wants, and unnumbered files are skipped', () => {
  // The ordinary case, and the one that must stay green or the guard reports
  // every ADR in the repo. `README.md` carries no NNNN- prefix, so it is not an
  // ADR by this rule's reckoning and is skipped exactly as
  // `duplicateAdrNumbers` skips it — the stray-filename rule reports it instead.
  assert.deepEqual(
    numberedHeadings([
      { filename: '0001-record-architecture-decisions.md', heading: '# Record architecture decisions' },
      { filename: '0004-provenance-marker-rides-in-the-tension-body.md', heading: '# Provenance marker rides in the tension body' },
      { filename: 'README.md', heading: '# 3. Architecture decisions' },
    ]),
    [],
  );
});

test('a decision title is not mistaken for a stale number', () => {
  // The rule bans `# N. `, the shape `adr new` generates, rather than any
  // leading digit — so an ADR whose title genuinely opens with a number reads
  // as a title. Widening this to `^#\s+\d` would fail the heading below.
  assert.deepEqual(
    numberedHeadings([{ filename: '0015-two-clocks.md', heading: '# 2 clocks are reported, never averaged' }]),
    [],
  );
});

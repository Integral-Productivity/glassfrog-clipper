import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adrFilenames,
  adrHeadings,
  duplicateAdrNumbers,
  headingNumberMismatches,
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

test('every ADR heading carries its own filename number', async () => {
  const mismatches = headingNumberMismatches(await adrHeadings());

  assert.deepEqual(
    mismatches,
    [],
    'an ADR heading disagrees with its filename — a renumber that moves the file must edit the heading too',
  );
});

test('the guard detects the heading a renumber left behind', () => {
  // The exact tree #42 produced: the file renamed to 0006, the heading still
  // reading `# 5.`, and 0005 legitimately reading `# 5.` beside it. The red
  // half of red-then-green, kept in the suite rather than performed by hand.
  assert.deepEqual(
    headingNumberMismatches([
      { filename: '0005-the-open-source-path-runs-through-a-public-sdk.md', heading: '# 5. The open-source path runs through a public SDK, not a vendored fork' },
      {
        filename: '0006-queue-health-is-measured-from-capture-not-from-last-touch.md',
        heading: '# 5. Queue health is measured from capture, not from last touch',
      },
    ]),
    [
      {
        filename: '0006-queue-health-is-measured-from-capture-not-from-last-touch.md',
        filenameNumber: 6,
        heading: '# 5. Queue health is measured from capture, not from last touch',
      },
    ],
  );
});

test('a heading the parser cannot read is a failure, not a skip', () => {
  // A file with no heading, or one that opens with prose instead of `# N.`,
  // must be reported. Skipping it would let the guard pass over precisely the
  // file it can no longer see.
  const unreadable = headingNumberMismatches([
    { filename: '0007-no-heading-at-all.md', heading: undefined },
    { filename: '0008-heading-without-a-number.md', heading: '# Queue health' },
  ]);

  assert.deepEqual(
    unreadable.map((m) => m.filename),
    ['0007-no-heading-at-all.md', '0008-heading-without-a-number.md'],
  );
});

test('zero-padding in the filename does not read as a mismatch', () => {
  // `0004-` against `# 4.` is the ordinary case and must stay green; a textual
  // comparison would flag every ADR in the repo. Unnumbered files are skipped
  // here exactly as `duplicateAdrNumbers` skips them.
  assert.deepEqual(
    headingNumberMismatches([
      { filename: '0001-record-architecture-decisions.md', heading: '# 1. Record architecture decisions' },
      { filename: '0004-provenance-marker-rides-in-the-tension-body.md', heading: '# 4. Provenance marker rides in the tension body' },
      { filename: 'README.md', heading: '# Architecture decisions' },
    ]),
    [],
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Capture } from '../src/types.ts';
import {
  EVIDENCE_FIELD_LIMIT,
  HEADLINE_LIMIT,
  PROVENANCE_MARKER,
  compose,
  headline,
} from '../src/compose.ts';

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    page: {
      url: 'https://example.test/some/page',
      title: 'A page worth clipping',
      capturedAt: '2026-08-28T12:00:00.000Z',
    },
    ...overrides,
  };
}

test('AE2: a capture with a selection carries URL, title and selection into the filed item', () => {
  const composed = compose(
    capture({
      page: {
        url: 'https://example.test/some/page',
        title: 'A page worth clipping',
        selection: 'the sentence that started the tension',
        capturedAt: '2026-08-28T12:00:00.000Z',
      },
    }),
  );

  assert.equal(composed.kind, 'tension');
  if (composed.kind !== 'tension') return;

  assert.match(composed.body, /A page worth clipping/, 'the title');
  assert.match(composed.body, /https:\/\/example\.test\/some\/page/, 'the URL');
  assert.match(composed.body, /the sentence that started the tension/, 'the selection');
});

test('a capture with no work type composes as a tension carrying neither status nor label', () => {
  const composed = compose(capture());

  assert.equal(composed.kind, 'tension', 'KD2: an unset work type is a tension');
  // Tension status is server-derived, and the API rejects `label` on create —
  // both verified against live GlassFrog. Composing either is the bug.
  assert.equal('status' in composed, false);
  assert.equal('label' in composed, false);
  assert.deepEqual(Object.keys(composed).sort(), ['body', 'kind']);
});

test('R11: the marker leads the body, so truncation cannot reach it', () => {
  const composed = compose(
    capture({
      page: {
        url: 'https://example.test/some/page',
        title: 'A page worth clipping',
        selection: 'x'.repeat(EVIDENCE_FIELD_LIMIT * 3),
        capturedAt: '2026-08-28T12:00:00.000Z',
      },
    }),
  );

  assert.equal(composed.kind, 'tension');
  if (composed.kind !== 'tension') return;

  assert.ok(composed.body.startsWith(PROVENANCE_MARKER), 'it leads, so nothing after it can displace it');
});

test('R11: the marker survives a title far longer than the headline allows', () => {
  const composed = compose(
    capture({
      page: {
        url: 'https://example.test/some/page',
        title: 'T'.repeat(HEADLINE_LIMIT * 10),
        capturedAt: '2026-08-28T12:00:00.000Z',
      },
    }),
  );

  assert.equal(composed.kind, 'tension');
  if (composed.kind !== 'tension') return;
  assert.ok(composed.body.startsWith(PROVENANCE_MARKER));
});

/**
 * The regression that motivated revising KTD5. GlassFrog caps this field at 200
 * characters; the previous composition truncated the title to R7's 4,000 and
 * would have emitted ~4,020, failing on any long page title. Nothing caught it,
 * because the tests substitute a fake writer that accepts anything.
 */
test('the headline stays within GlassFrog\'s 200-character limit, however long the title', () => {
  for (const length of [0, 1, 50, HEADLINE_LIMIT, HEADLINE_LIMIT * 2, EVIDENCE_FIELD_LIMIT * 2]) {
    const head = headline({
      url: 'https://example.test/p',
      title: 'T'.repeat(length),
      capturedAt: '2026-08-28T12:00:00.000Z',
    });

    assert.ok(
      Array.from(head).length <= HEADLINE_LIMIT,
      `a title of ${length} chars produced a ${Array.from(head).length}-char headline`,
    );
    assert.ok(head.startsWith(PROVENANCE_MARKER), 'and the marker is never the part that gets cut');
  }
});

test('an action composes the marker into description and the evidence into note', () => {
  const composed = compose(
    capture({
      workType: 'action',
      note: 'chase this down',
      page: {
        url: 'https://example.test/some/page',
        title: 'A page worth clipping',
        selection: 'quoted from the page',
        capturedAt: '2026-08-28T12:00:00.000Z',
      },
    }),
  );

  assert.equal(composed.kind, 'action');
  if (composed.kind !== 'action') return;

  assert.ok(composed.description.startsWith(PROVENANCE_MARKER));
  assert.match(composed.description, /A page worth clipping/);
  assert.ok(Array.from(composed.description).length <= HEADLINE_LIMIT);
  // Asserted by block position rather than by substring presence: the ordering
  // is the requirement (R17 — the practitioner's words lead), and "appears
  // somewhere" would still pass if the note were appended after the evidence.
  const noteBlocks = composed.note.split('\n\n');
  assert.equal(noteBlocks[0], 'chase this down', 'R17: the practitioner note leads');
  assert.equal(noteBlocks[1], 'https://example.test/some/page', 'then the URL');
  assert.equal(noteBlocks[2], 'quoted from the page', 'then the selection');
});

test('a project composes the same way as an action, plus its link', () => {
  const composed = compose(capture({ workType: 'project' }));
  assert.equal(composed.kind, 'project');
  if (composed.kind !== 'project') return;

  assert.ok(composed.description.startsWith(PROVENANCE_MARKER));
  assert.match(composed.note, /https:\/\/example\.test\/some\/page/);
});

/**
 * Belt and suspenders, deliberately. The note is the human-readable evidence
 * block and R7 truncates it; `link` is the one canonical field GlassFrog renders
 * a project as linked from, and truncation must never reach it. Asserting only
 * one of the two would let the other be dropped as a redundancy later.
 */
test('a captured project carries the page URL in link AND in the note', () => {
  const composed = compose(capture({ workType: 'project' }));
  assert.equal(composed.kind, 'project');
  if (composed.kind !== 'project') return;

  assert.equal(composed.link, 'https://example.test/some/page');
  assert.ok(
    composed.note.split('\n\n').includes('https://example.test/some/page'),
    'the evidence block keeps its own copy',
  );
});

/**
 * `ActionInput` has no `link` field and neither does a tension — verified
 * against the SDK's types. Composing one for either path would put a key on the
 * wire the API has no home for.
 */
test('only a project composes a link', () => {
  assert.equal('link' in compose(capture()), false, 'a tension has none');
  assert.equal('link' in compose(capture({ workType: 'action' })), false, 'and neither does an action');
});

test('a project with no URL omits link rather than sending it blank', () => {
  const composed = compose({
    page: { url: '', title: 'A page worth clipping', capturedAt: '2026-08-28T12:00:00.000Z' },
    workType: 'project',
  });
  assert.equal(composed.kind, 'project');
  if (composed.kind !== 'project') return;

  assert.equal('link' in composed, false, 'an empty link reads as one that exists and is broken');
});

test('a capture with no selection leaves no hole where one would have gone', () => {
  const composed = compose(capture());
  assert.equal(composed.kind, 'tension');
  if (composed.kind !== 'tension') return;

  assert.doesNotMatch(composed.body, /\n\n\n/);
  assert.equal(composed.body.trimEnd(), composed.body);
});

test('R17: a note is carried even when there is no selection', () => {
  const composed = compose(capture({ note: 'the thought I had' }));
  assert.equal(composed.kind, 'tension');
  if (composed.kind !== 'tension') return;

  assert.match(composed.body, /the thought I had/);
});

test('each page-derived evidence field is bounded on its own', () => {
  const composed = compose(
    capture({
      page: {
        url: `https://example.test/${'u'.repeat(EVIDENCE_FIELD_LIMIT * 2)}`,
        title: 'T'.repeat(EVIDENCE_FIELD_LIMIT * 2),
        selection: 'S'.repeat(EVIDENCE_FIELD_LIMIT * 2),
        capturedAt: '2026-08-28T12:00:00.000Z',
      },
    }),
  );
  assert.equal(composed.kind, 'tension');
  if (composed.kind !== 'tension') return;

  // The URL occupies its own block, so its position is checkable. A substring
  // test would pass on a body where the URL had been mangled into the middle of
  // a truncated selection.
  const blocks = composed.body.split('\n\n');
  assert.ok(blocks[1]?.startsWith('https://example.test/'), 'the URL survives beside an oversized selection');
  assert.ok(
    Array.from(blocks[1] ?? '').length <= EVIDENCE_FIELD_LIMIT,
    'and is bounded on its own rather than sharing a budget',
  );
});

test('the marker is stable, since triage-survival matching depends on it', () => {
  assert.equal(PROVENANCE_MARKER, '[glassfrog-clipper]');
});

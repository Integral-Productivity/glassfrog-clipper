import test from 'node:test';
import assert from 'node:assert/strict';

import type { Capture } from '../src/types.ts';
import { EVIDENCE_FIELD_LIMIT, PROVENANCE_MARKER, compose } from '../src/compose.ts';

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

  assert.match(composed.label, /A page worth clipping/, 'the title rides in the label');
  assert.match(composed.body, /https:\/\/example\.test\/some\/page/, 'the URL rides in the body');
  assert.match(composed.body, /the sentence that started the tension/, 'so does the selection');
});

test('a capture with no work type composes as a tension and carries no status', () => {
  const composed = compose(capture());

  assert.equal(composed.kind, 'tension', 'KD2: an unset work type is a tension');
  // Tension status is server-derived — v5 auto-computes unprocessed/processed
  // from associations and accepts only `archived` from a client. Composing a
  // status field at all would be the bug.
  assert.equal('status' in composed, false);
});

test('a capture with no selection still files, with evidence and no empty selection block', () => {
  const composed = compose(capture());
  assert.equal(composed.kind, 'tension');
  if (composed.kind !== 'tension') return;

  assert.match(composed.body, /https:\/\/example\.test\/some\/page/);
  assert.doesNotMatch(composed.body, /\n\n\n/, 'no hole is left where the selection would have gone');
  assert.equal(composed.body.trimEnd(), composed.body, 'and no trailing whitespace either');
});

test('R11: the provenance marker survives a selection that exceeds the length limit', () => {
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

  assert.ok(
    composed.label.includes(PROVENANCE_MARKER),
    'the marker is in a different field from the evidence precisely so truncation cannot eat it',
  );
  assert.ok(composed.label.startsWith(PROVENANCE_MARKER), 'and it leads, so it survives a long title too');
});

test('R11: the marker survives a title longer than the field limit', () => {
  const composed = compose(
    capture({
      page: {
        url: 'https://example.test/some/page',
        title: 'T'.repeat(EVIDENCE_FIELD_LIMIT * 2),
        capturedAt: '2026-08-28T12:00:00.000Z',
      },
    }),
  );

  assert.equal(composed.kind, 'tension');
  if (composed.kind !== 'tension') return;

  assert.ok(composed.label.startsWith(PROVENANCE_MARKER));
  assert.ok(composed.label.length < EVIDENCE_FIELD_LIMIT * 2, 'the title is bounded, the marker is not');
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
  assert.match(composed.note, /chase this down/, 'R17: the practitioner note leads');
  assert.match(composed.note, /https:\/\/example\.test\/some\/page/);
  assert.match(composed.note, /quoted from the page/);
  assert.ok(
    composed.note.indexOf('chase this down') < composed.note.indexOf('https://example.test'),
    'the note the practitioner wrote comes before the evidence the machine gathered',
  );
});

test('a project composes the same way as an action', () => {
  const composed = compose(capture({ workType: 'project' }));
  assert.equal(composed.kind, 'project');
  if (composed.kind !== 'project') return;

  assert.ok(composed.description.startsWith(PROVENANCE_MARKER));
  assert.match(composed.note, /https:\/\/example\.test\/some\/page/);
});

test('R17: a note is carried even when there is no selection', () => {
  const composed = compose(capture({ note: 'the thought I had' }));
  assert.equal(composed.kind, 'tension');
  if (composed.kind !== 'tension') return;

  assert.match(composed.body, /the thought I had/);
});

test('composition bounds each page-derived field independently', () => {
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

  // A single oversized field must not consume the budget of the others; each is
  // capped on its own so the URL is still readable next to a huge selection.
  assert.ok(composed.body.includes('https://example.test/'), 'the URL survives beside an oversized selection');
  assert.ok(composed.label.includes('T'), 'the title survives too');
});

test('the marker is stable, since triage-survival matching depends on it', () => {
  assert.equal(PROVENANCE_MARKER, '[glassfrog-clipper]');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { compose, PROVENANCE_MARKER } from '../src/compose.ts';
import type { Capture } from '../src/types.ts';

/**
 * The TypeScript half of a two-language contract.
 *
 * `compose()` exists twice: here, for the Chrome and Safari extensions, and in
 * Swift, for the Share Extension — which never runs the web extension and so
 * must file natively. ADR 0004 makes the provenance marker the basis of the
 * triage-survival metric, so a share-sheet capture whose headline differs by a
 * single character is invisible to that metric while looking entirely normal in
 * GlassFrog. That is the failure this file and its Swift counterpart exist to
 * make impossible.
 *
 * Both suites assert against the same committed golden file rather than against
 * each other, so neither implementation can move without a visible diff in it.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface Fixture {
  cases: Array<{ name: string; capture: Capture; expected: Record<string, string> }>;
}

async function fixture(): Promise<Fixture> {
  return JSON.parse(await readFile(join(root, 'test', 'fixtures', 'compose-cases.json'), 'utf8'));
}

test('the TypeScript compose still produces every case in the golden file', async () => {
  const { cases } = await fixture();
  assert.ok(cases.length >= 12, 'the fixture should not be able to shrink unnoticed');

  for (const { name, capture, expected } of cases) {
    assert.deepEqual(compose(capture), expected, name);
  }
});

test('the golden file covers the cases the two languages are most likely to disagree on', async () => {
  const { cases } = await fixture();
  const names = cases.map((c) => c.name).join(' | ');

  // Swift's String is grapheme-cluster based and JavaScript's Array.from is
  // code-point based. A Swift port written with String.prefix() passes every
  // ASCII case and diverges the moment anything astral arrives — 200 scalars
  // against 47 grapheme clusters, for the same title. Without a case that
  // spans the truncation limit in astral characters, the fixture would give
  // false confidence rather than a contract.
  assert.match(names, /astral/, 'a case crossing the limit in astral characters is load-bearing');
  assert.match(names, /over-long/, 'a case crossing the headline limit at all');
  assert.match(names, /empty title/, 'the marker-alone headline');
});

test('every case in the golden file carries the marker, wherever it went', async () => {
  const { cases } = await fixture();
  for (const { name, expected } of cases) {
    // R11 restated over the whole corpus: the marker leads its field and is
    // never truncated, no matter what the practitioner captured.
    const field = expected.body ?? expected.description;
    assert.ok(typeof field === 'string', `${name}: every shape has a field the marker leads`);
    assert.ok(field.startsWith(PROVENANCE_MARKER), `${name}: marker must lead its field`);
  }
});

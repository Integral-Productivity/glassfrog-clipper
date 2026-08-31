import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// @ts-expect-error - a plain .mjs script with no type declarations; only its
// pure comparison functions are imported here, and the module guards its own
// entry point so importing it does not shell out to `gh`.
import { diffLabels, manifestLabels } from '../scripts/check-labels.mjs';

/**
 * A fitness function for the offline half of the label-drift guard.
 *
 * #43 wrote the triage vocabulary down. #46 observed that nothing detected the
 * document going stale — a convention with an artifact but no enforcement,
 * which is the same failure mode #43 itself was filed about.
 *
 * The obstacle was that labels live behind the GitHub API, so the obvious guard
 * cannot be a plain `npm test` assertion: it would fail red on a fork and on
 * any clone without a token. The resolution splits the check in two, and this
 * file is the half that needs no network:
 *
 *   docs/agents/triage-labels.md  ↔  docs/agents/labels.json   here, on every PR
 *   docs/agents/labels.json       ↔  the live GitHub labels    on a schedule,
 *                                    via .github/workflows/label-drift.yml
 *
 * `labels.json` is the source of truth. The prose document explains it and must
 * agree with it; GitHub is applied from it. So changing a label's description in
 * one place and not the other turns this suite red before the PR merges, and the
 * online half never has to be the thing that catches a documentation slip.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const DOC = join(root, 'docs', 'agents', 'triage-labels.md');
const MANIFEST = join(root, 'docs', 'agents', 'labels.json');

interface Label {
  name: string;
  description: string;
  color: string;
}

/**
 * Returns the body of the `## ` section whose heading starts with `prefix`.
 *
 * Throws rather than returning empty when the heading is gone. A parser that
 * silently finds nothing would extract zero rows, compare them against zero
 * expectations, and report green over a guard that had stopped guarding — the
 * exact failure `adr-numbering.test.ts` keeps its own emptiness check for.
 */
export function section(markdown: string, prefix: string): string {
  const headings = [...markdown.matchAll(/^## (.+)$/gm)];
  const index = headings.findIndex((heading) => (heading[1] ?? '').startsWith(prefix));
  const heading = index === -1 ? undefined : headings[index];
  if (heading === undefined) {
    throw new Error(`no "## ${prefix}…" heading in the document — the parser cannot see the table it guards`);
  }
  return markdown.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? markdown.length);
}

/**
 * The data rows of a markdown table, as cell arrays.
 *
 * Selecting on "first cell is a backticked label name" skips the header and the
 * `|---|` separator without having to recognise them, and ignores the prose
 * tables in the same document whose first column is not a label.
 */
export function labelRows(body: string): string[][] {
  return body
    .split('\n')
    .filter((line) => line.trimStart().startsWith('|'))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim()),
    )
    .filter((cells) => /^`[^`]+`$/.test(cells[0] ?? ''));
}

/**
 * The first two cells of a table row, with a malformed row failing loudly
 * rather than defaulting to an empty string. Defaulting would typecheck and
 * then quietly compare nothing against nothing — which is the failure this
 * whole suite exists to catch, reintroduced to satisfy the compiler.
 */
function firstTwoCells(cells: string[]): { name: string; second: string } {
  const [first, second] = cells;
  if (first === undefined || second === undefined) {
    throw new Error(`a label table row has fewer than two columns: ${JSON.stringify(cells)}`);
  }
  return { name: first.replace(/^`|`$/g, ''), second };
}

/** States and markers state their live description outright, in column two. */
export function statedLabels(body: string): Array<{ name: string; description: string }> {
  return labelRows(body).map((cells) => {
    const { name, second } = firstTwoCells(cells);
    return { name, description: second };
  });
}

/**
 * The tracks table names the STRATEGY.md track rather than the label
 * description — `Capture surface`, not `STRATEGY.md track — Capture surface`.
 * The live description is that name behind a fixed prefix, for all four, so the
 * document does pin the descriptions and the check need not skip the column.
 * If that convention is ever broken this reconstruction fails loudly, which is
 * the right outcome: the prefix is part of the convention.
 */
export function trackLabels(body: string, prefix: string): Array<{ name: string; description: string }> {
  return labelRows(body).map((cells) => {
    const { name, second } = firstTwoCells(cells);
    return { name, description: `${prefix}${second}` };
  });
}

const doc = await readFile(DOC, 'utf8');
const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));

const stated = (group: 'states' | 'markers' | 'tracks' | 'other'): Array<{ name: string; description: string }> =>
  manifest[group].map(({ name, description }: Label) => ({ name, description }));

test('the states table matches the manifest, in order', () => {
  // Order is checked, not just membership: the prose immediately below the table
  // narrates a path through it ("needs-triage → needs-info → ready-for-agent"),
  // so a reordering that leaves the set intact still misleads the reader.
  assert.deepEqual(statedLabels(section(doc, 'States')), stated('states'));
});

test('the markers table matches the manifest, in order', () => {
  assert.deepEqual(statedLabels(section(doc, 'Markers')), stated('markers'));
});

test('the tracks table matches the manifest, in order', () => {
  assert.deepEqual(trackLabels(section(doc, 'Tracks'), manifest.trackDescriptionPrefix), stated('tracks'));
});

test('every remaining label is named in "the rest of the label set"', () => {
  // Prose, not a table, so membership is checked and order is not.
  const body = section(doc, 'The rest of the label set');
  const named = new Set([...body.matchAll(/`([^`]+)`/g)].map((match) => match[1]));
  const unnamed = manifest.other.map((label: Label) => label.name).filter((name: string) => !named.has(name));

  assert.deepEqual(unnamed, [], 'a label in the manifest that the document never mentions is invisible to a reader');
});

test('the counts written into the prose match the manifest', () => {
  // `| **State** (6 labels) |` and the blockquote's "**six**" go stale silently
  // when a label is added — the tables stay correct while the summary lies.
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

  for (const [group, word] of [
    ['State', 'states'],
    ['Marker', 'markers'],
  ] as const) {
    const expected = manifest[word].length;
    const written = new RegExp(`\\*\\*${group}\\*\\*\\s*\\((\\d+) labels\\)`).exec(doc);
    assert.notEqual(written, null, `the "two kinds of label" table no longer states a count for ${group}`);
    assert.equal(Number(written?.[1]), expected, `the ${group} count in the summary table is stale`);
  }

  // The sentence lives inside a blockquote and wraps, so it reaches here as
  // "**six**\n> mutually exclusive". Flattened before matching rather than
  // matched with a regex that has to know about `>` and line wrapping — a
  // reflow of the paragraph should not turn this check red.
  const flattened = doc.replace(/^>\s?/gm, '').replace(/\s+/g, ' ');
  assert.ok(
    flattened.includes(`carries **${words[manifest.states.length]}** mutually exclusive states`),
    'the blockquote spells out a state count that no longer matches the manifest',
  );
});

test('the count README.md advertises matches the manifest', async () => {
  // README.md summarises this vocabulary for a reader who never opens the
  // document, so it carries its own copy of the state count — a third place for
  // the same number to go stale, and the one least likely to be re-read.
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const readme = (await readFile(join(root, 'README.md'), 'utf8')).replace(/\s+/g, ' ');

  assert.ok(
    readme.includes(`the ${words[manifest.states.length]} mutually exclusive issue states`),
    'README.md states a number of triage states that no longer matches the manifest',
  );
});

test('the document states which way authority runs, and names the machinery', () => {
  // #46's third acceptance criterion: whichever direction was chosen must be
  // stated in the document, so the next reader knows which artifact to edit.
  // Asserting on the references rather than on a sentence — prose gets reworded,
  // but a rewrite that drops these has dropped the statement itself.
  for (const reference of ['docs/agents/labels.json', 'label-drift.yml', 'source of truth']) {
    assert.ok(doc.includes(reference), `the document no longer mentions ${reference}`);
  }
});

test('the manifest holds every label exactly once, with a usable colour', () => {
  const all = manifestLabels(manifest) as Array<Label & { group: string }>;
  const names = all.map((label) => label.name);

  assert.deepEqual(
    names.filter((name, index) => names.indexOf(name) !== index),
    [],
    'a label appearing in two groups would be created twice and reported as drift forever',
  );
  for (const label of all) {
    assert.match(label.color, /^[0-9a-f]{6}$/, `${label.name} needs a six-digit lowercase hex colour`);
    assert.notEqual(label.description, '', `${label.name} needs a description; the document publishes it`);
  }
});

test('the parser is reading real tables, not an empty document', () => {
  // Without this, a heading rename or a table reformat would make every
  // comparison above compare [] against [] — green, over nothing.
  assert.ok(manifestLabels(manifest).length >= 20, 'the manifest looks truncated');
  assert.equal(labelRows(section(doc, 'States')).length, manifest.states.length);
  assert.equal(labelRows(section(doc, 'Markers')).length, manifest.markers.length);
  assert.equal(labelRows(section(doc, 'Tracks')).length, manifest.tracks.length);
});

test('a missing section fails loudly rather than parsing as empty', () => {
  assert.throws(() => section(doc, 'Nonexistent'), /no "## Nonexistent…" heading/);
});

test('the doc parser detects a drifted description it is shown', () => {
  // The red half of red-then-green. Without it, `statedLabels` could return []
  // unconditionally and every comparison above would still pass.
  const fixture = [
    '## States — mutually exclusive, exactly one',
    '',
    '| State | Description (live) | Assign it when |',
    '|---|---|---|',
    '| `needs-triage` | Not yet assessed | … |',
    '| `backlog` | Deliberately deferred | … |',
    '',
    '## Next',
  ].join('\n');

  assert.deepEqual(statedLabels(section(fixture, 'States')), [
    { name: 'needs-triage', description: 'Not yet assessed' },
    { name: 'backlog', description: 'Deliberately deferred' },
  ]);
});

test('the live-set comparison detects each kind of drift it is shown', () => {
  // `diffLabels` is what the scheduled workflow runs. Exercised here against
  // fixtures so its three branches are covered offline, without a token.
  const wanted = [
    { name: 'backlog', description: 'On-strategy, deliberately not now', color: 'c5def5', group: 'states' },
    { name: 'ghost', description: 'absent upstream', color: 'abcdef', group: 'states' },
  ];
  const live = [
    { name: 'backlog', description: 'Deferred', color: 'c5def5' },
    { name: 'surprise', description: 'added in the UI', color: '111111' },
  ];

  const { missing, changed, extra } = diffLabels(wanted, live);

  assert.deepEqual(
    missing.map((label: Label) => label.name),
    ['ghost'],
  );
  assert.deepEqual(
    changed.map((label: Label & { fields: string[] }) => [label.name, label.fields]),
    [['backlog', ['description']]],
  );
  assert.deepEqual(
    extra.map((label: Label) => label.name),
    ['surprise'],
  );
});

test('a colour differing only in case is not reported as drift', () => {
  // GitHub returns colours verbatim and the live set genuinely mixes `0E8A16`
  // and `0e8a16`. Reported as drift, this check would be red on every run for a
  // difference nobody can fix — and a permanently red check gets muted.
  const { changed } = diffLabels(
    [{ name: 'status:in-progress', description: 'Actively being worked by a session', color: '0e8a16' }],
    [{ name: 'status:in-progress', description: 'Actively being worked by a session', color: '0e8a16' }],
  );

  assert.deepEqual(changed, []);
  assert.equal(
    manifestLabels(manifest).every((label: Label) => label.color === label.color.toLowerCase()),
    true,
    'the manifest must store colours lowercased, since that is the side that gets normalised',
  );
});

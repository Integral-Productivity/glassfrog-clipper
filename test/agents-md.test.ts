import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * A fitness function for `AGENTS.md`.
 *
 * The file is a pointer document: it tells an agent that `docs/solutions/` and
 * `CONCEPTS.md` exist, describes the corpus well enough to search it, and names
 * the ADRs that constrain the shape of a change. Every one of those claims is
 * about something else in the tree, which makes all of them able to go stale
 * silently — a pointer that has rotted still reads as authoritative, and the
 * reader who follows it is an agent with no way to tell.
 *
 * That is the same failure class the file was written to fix. #113 was filed
 * saying "three docs as of this writing"; by the time it was worked there were
 * four on `main` and seven in flight. A document that describes a growing
 * corpus by its size is wrong within days, so `AGENTS.md` describes it by its
 * structure and this suite holds that description to the corpus.
 *
 * The precedent is `test/label-manifest.test.ts`, which holds README.md's
 * advertised triage-state count to `docs/agents/labels.json`. Same shape: a
 * root document, a source of truth elsewhere in the tree, and a check that
 * fails on the pull request rather than on the next reader.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const AGENTS = join(root, 'AGENTS.md');
const SOLUTIONS = join(root, 'docs', 'solutions');

const agents = await readFile(AGENTS, 'utf8');

/** `AGENTS.md` with fenced code blocks removed — the grep examples are illustrative, not claims. */
const prose = agents.replace(/```[\s\S]*?```/g, '');

/**
 * The body of the `### ` section whose heading starts with `prefix`.
 *
 * Throws rather than returning empty when the heading is gone: a parser that
 * silently found nothing would satisfy every assertion below over an empty
 * string, which is the failure mode these checks exist to prevent.
 */
function section(markdown: string, prefix: string): string {
  const headings = [...markdown.matchAll(/^### (.+)$/gm)];
  const index = headings.findIndex((heading) => (heading[1] ?? '').startsWith(prefix));
  const heading = index === -1 ? undefined : headings[index];
  if (heading === undefined) {
    throw new Error(`no "### ${prefix}…" heading in AGENTS.md — the parser cannot see the section it guards`);
  }
  return markdown.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? markdown.length);
}

/** The section describing the solutions corpus, which is what most of this suite guards. */
const solutionsSection = section(prose, '`docs/solutions/`');

/**
 * Frontmatter keys of one document, in order.
 *
 * A hand-rolled reader rather than a YAML dependency: the suite is
 * dependency-free by design (`node --test` with no `node_modules`), and only
 * top-level key *names* are needed here, never values.
 */
function frontmatterKeys(markdown: string): string[] {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (match === null) {
    return [];
  }
  return [...(match[1] ?? '').matchAll(/^([a-z_]+):/gm)].map((key) => key[1] as string);
}

/** Every `.md` under `docs/solutions/`, with its repo-relative path and text. */
async function corpus(): Promise<Array<{ path: string; text: string }>> {
  const categories = await readdir(SOLUTIONS, { withFileTypes: true });
  const docs: Array<{ path: string; text: string }> = [];

  for (const category of categories) {
    if (!category.isDirectory()) {
      continue;
    }
    for (const entry of await readdir(join(SOLUTIONS, category.name))) {
      if (!entry.endsWith('.md')) {
        continue;
      }
      const relative = join('docs', 'solutions', category.name, entry);
      docs.push({ path: relative, text: await readFile(join(root, relative), 'utf8') });
    }
  }

  return docs;
}

const docs = await corpus();

test('the corpus is actually being read, not an empty directory', () => {
  // Without this, every comparison below would compare [] against [] and report
  // green over a check that had stopped checking — the same guard
  // `label-manifest.test.ts` and `adr-numbering.test.ts` each keep.
  assert.ok(docs.length >= 4, `only ${docs.length} documents found under docs/solutions/`);
});

test('every field AGENTS.md tabulates is on every document in the corpus', () => {
  // The table is a search recipe. A field named there that some documents lack
  // is a recipe that silently returns a partial corpus, which is worse than no
  // recipe at all: the reader gets results and stops looking.
  const tabulated = [...solutionsSection.matchAll(/^\| `([a-z_]+)` \|/gm)].map((row) => row[1] as string);

  assert.ok(tabulated.length >= 5, 'the frontmatter table in AGENTS.md no longer parses as a table');

  for (const doc of docs) {
    const keys = new Set(frontmatterKeys(doc.text));
    const missing = tabulated.filter((field) => !keys.has(field));
    assert.deepEqual(missing, [], `${doc.path} lacks ${missing.join(', ')}, which AGENTS.md says every document carries`);
  }
});

test('the frontmatter fields README.md advertises are on every document too', async () => {
  // README.md carried these pointers first — since #32, and contrary to what
  // #113 assumed when it said neither root document mentioned either store.
  // It summarises the same frontmatter for a reader who never opens AGENTS.md,
  // so it is a second place for the same field names to go stale. Held to the
  // corpus here rather than left to be noticed, which is how `label-manifest`
  // already treats README's triage-state count.
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const advertised = /YAML frontmatter \(([^)]+)\)/.exec(readme)?.[1];

  assert.notEqual(advertised, undefined, 'README.md no longer describes the solutions frontmatter');

  const fields = [...(advertised as string).matchAll(/`([a-z_]+)`/g)].map((match) => match[1] as string);
  assert.ok(fields.length >= 3, 'README.md names no frontmatter fields, so the extractor has stopped matching');

  for (const doc of docs) {
    const keys = new Set(frontmatterKeys(doc.text));
    const missing = fields.filter((field) => !keys.has(field));
    assert.deepEqual(missing, [], `${doc.path} lacks ${missing.join(', ')}, which README.md says the corpus carries`);
  }
});

test('every problem_type in the corpus is one AGENTS.md names', () => {
  // Listed ⊇ used, deliberately one-directional. AGENTS.md may name a value the
  // corpus has not reached yet; it must never omit one already in use, because
  // an agent filtering on the advertised set would not see those documents.
  const named = new Set([...prose.matchAll(/`([a-z_]+)`/g)].map((match) => match[1] as string));
  const used = docs.map((doc) => /^problem_type:\s*(\S+)/m.exec(doc.text)?.[1]).filter((value) => value !== undefined);

  assert.ok(used.length === docs.length, 'a document has no problem_type, so the corpus cannot be filtered by kind');

  const unnamed = [...new Set(used)].filter((value) => !named.has(value as string));
  assert.deepEqual(unnamed, [], `AGENTS.md never mentions problem_type ${unnamed.join(', ')}`);
});

test('every category AGENTS.md names is a real subdirectory', async () => {
  const categories = new Set(
    (await readdir(SOLUTIONS, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );
  // Scoped to the solutions section: `fitness/` and `test/fitness/` are named
  // elsewhere in the file and are not categories.
  const named = [...solutionsSection.matchAll(/`([a-z-]+)\/`/g)].map((match) => match[1] as string);

  assert.ok(named.length >= 2, 'AGENTS.md no longer names any solutions category');
  for (const name of named) {
    assert.ok(categories.has(name), `AGENTS.md names a \`${name}/\` category that docs/solutions/ does not have`);
  }
});

test('AGENTS.md describes the corpus by structure, never by size', () => {
  // #113's own body said "three docs as of this writing" and was wrong within
  // days. A count is the one fact about a growing corpus that cannot be kept
  // true, so the file must not state one.
  //
  // The lookahead spares the distributive form — "one document per learning"
  // describes the shape, not the size, and is exactly what should be written
  // instead.
  const counts = [
    ...prose.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(docs?|documents?|learnings?|entries)\b(?!\s+per\b)/gi),
  ];

  assert.deepEqual(
    counts.map((match) => match[0]),
    [],
    'AGENTS.md states a count of documented solutions, which goes stale on the next capture',
  );
});

test('every repository path AGENTS.md points at exists', async () => {
  const targets = new Set<string>();

  // Markdown link targets, minus external links and in-page anchors.
  for (const link of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = link[1] as string;
    if (!/^(https?:|#|mailto:|\.\.\/)/.test(target)) {
      targets.add(target);
    }
  }

  // Backticked paths, restricted to ones rooted at a real top-level directory
  // so that `best-practices/` and `applies_when:` are not mistaken for paths.
  for (const code of prose.matchAll(/`([^`\s]+)`/g)) {
    const value = code[1] as string;
    if (/^(docs|test|src|fitness|scripts|public|features|apple|\.github)\//.test(value)) {
      targets.add(value);
    }
  }

  assert.ok(targets.size >= 10, 'AGENTS.md no longer points at anything, or the extractor has stopped matching');

  for (const target of [...targets].sort()) {
    await assert.doesNotReject(stat(join(root, target)), `AGENTS.md points at ${target}, which is not in the tree`);
  }
});

test('each ADR AGENTS.md names by number links to that ADR', () => {
  // "[ADR 0012](docs/adr/0013-…)" is the failure this catches: a renumber moves
  // the file, the link is updated to the new path, and the prose keeps citing
  // the old number. Both halves read as correct on their own.
  const citations = [...prose.matchAll(/\[ADR (\d{4})\]\((docs\/adr\/(\d{4})-[^)]+)\)/g)];

  assert.ok(citations.length >= 4, 'AGENTS.md no longer cites the ADRs that govern the shape of a change');

  for (const [, cited, path, filed] of citations) {
    assert.equal(cited, filed, `AGENTS.md calls ${path} "ADR ${cited}"`);
  }
});

test('AGENTS.md names both knowledge stores, which is what #113 asked for', () => {
  // The acceptance criterion, asserted directly. Prose gets reworded; a rewrite
  // that drops either path has dropped the point of the file.
  for (const store of ['docs/solutions/', 'CONCEPTS.md']) {
    assert.ok(agents.includes(store), `AGENTS.md no longer names ${store}`);
  }
});

test('a renamed section fails loudly rather than parsing as empty', () => {
  assert.throws(() => section(prose, 'Nonexistent'), /no "### Nonexistent…" heading/);
  assert.ok(solutionsSection.length > 200, 'the solutions section parsed as almost nothing');
});

test('the frontmatter reader fails loudly on a document with no frontmatter', () => {
  // The red half. Without it, `frontmatterKeys` could return a fixed list and
  // the field check above would pass over documents that carry nothing.
  assert.deepEqual(frontmatterKeys('# Just a heading\n\nNo frontmatter here.\n'), []);
  assert.deepEqual(frontmatterKeys('---\ntitle: x\nmodule: y\n---\n\n# Body\n'), ['title', 'module']);
});

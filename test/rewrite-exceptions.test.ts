import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

/**
 * A fitness function for the strings a rename is not allowed to sweep.
 *
 * #62 renamed this repository, and a handful of places still name the old slug
 * on purpose: command transcripts pasted with the output they produced, an ADR
 * whose Decision records the rename itself, a README section warning the old
 * name is unclaimed. A blockquote explained this, which is enough for a person
 * reading the file and useless against the realistic next actor — a follow-up
 * "sweep any stragglers" pass run as `grep -rl <old> | xargs sed -i` never
 * reads prose, and would silently break the invariant the note protects.
 *
 * So the exceptions live in `docs/agents/rewrite-exceptions.json`, and this
 * holds the tree to it in both directions:
 *
 *   - every listed file still carries the string, the expected number of times
 *     — so a sweep that rewrote one goes red rather than passing quietly;
 *   - no *unlisted* file carries it — so a new occurrence has to be classified
 *     deliberately rather than inherited.
 *
 * Deliberately keyed on file and count, never on line numbers. A line number is
 * invalidated by any edit above it, so a list keyed that way becomes its own
 * drift source — which would make this guard the thing it was written to
 * prevent.
 *
 * One manifest, not markers *and* a manifest: a second copy of the same fact is
 * what `test/repo-identity.test.ts` exists to catch one directory over, and the
 * third acceptance criterion of #160 asks that a future stale-name guard read
 * *this* list rather than carry its own.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join('docs', 'agents', 'rewrite-exceptions.json');

interface Exception {
  file: string;
  occurrences: number;
  kind: string;
  reason: string;
}

interface Manifest {
  string: string;
  exceptions: Exception[];
}

const manifest = async (): Promise<Manifest> =>
  JSON.parse(await readFile(join(root, MANIFEST), 'utf8')) as Manifest;

/** How many times `needle` appears in `haystack`. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/** Every tracked text file, repository-relative, excluding what git does not carry. */
async function textFiles(): Promise<string[]> {
  const skip = new Set(['.git', 'node_modules', 'dist', 'release', '.compound-engineering']);
  const found: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(md|ts|tsx|mjs|js|json|ya?ml|swift|feature|txt)$/.test(entry.name)) found.push(path);
    }
  };

  await walk(root);
  return found.map((path) => relative(root, path).split(sep).join('/'));
}

test('every listed exception still carries the string, the expected number of times', async () => {
  const { string: needle, exceptions } = await manifest();
  const wrong: string[] = [];

  for (const exception of exceptions) {
    const source = await readFile(join(root, exception.file), 'utf8');
    const actual = countOccurrences(source, needle);
    if (actual !== exception.occurrences) {
      wrong.push(`${exception.file}: expected ${exception.occurrences}, found ${actual}`);
    }
  }

  assert.deepEqual(
    wrong,
    [],
    `a deliberate exception was rewritten or duplicated. If the change was intended, update ` +
      `${MANIFEST}; if it came from a mechanical sweep, it is the thing this guard exists to catch:\n${wrong.join('\n')}`,
  );
});

test('no unlisted file carries the string', async () => {
  const { string: needle, exceptions } = await manifest();
  const listed = new Set(exceptions.map((exception) => exception.file));
  const strays: string[] = [];

  for (const path of await textFiles()) {
    if (listed.has(path) || path === MANIFEST.split(sep).join('/')) continue;
    if (countOccurrences(await readFile(join(root, path), 'utf8'), needle) > 0) strays.push(path);
  }

  assert.deepEqual(
    strays,
    [],
    `these name the superseded slug and are not in ${MANIFEST}. Either rewrite them, or add an ` +
      `entry saying why they must stay:\n${strays.join('\n')}`,
  );
});

test('the manifest is shaped so a mechanical pass can consult it', async () => {
  // The point of #160: a list a person can read is not the deliverable. Each
  // entry must carry enough for a tool to act — which file, how many, and a
  // reason a human reviewer can weigh.
  const { string: needle, exceptions } = await manifest();

  assert.ok(needle.length > 0, 'the manifest must name the string it is about');
  assert.ok(exceptions.length > 0, 'an empty manifest would make both guards above vacuous');

  for (const exception of exceptions) {
    assert.ok(typeof exception.file === 'string' && exception.file.length > 0);
    assert.ok(Number.isInteger(exception.occurrences) && exception.occurrences > 0);
    assert.ok(typeof exception.kind === 'string' && exception.kind.length > 0);
    assert.ok(exception.reason.length > 40, `${exception.file}: a reason short enough to be a label is not a reason`);
  }
});

test('the guard detects a swept exception, and a stray one', async () => {
  // The red half, both directions. Without it `countOccurrences` could return
  // the expected number unconditionally and every assertion above would pass
  // over a tree that had been swept clean.
  const { string: needle } = await manifest();

  assert.equal(countOccurrences(`a ${needle} b ${needle} c`, needle), 2);
  assert.equal(countOccurrences('nothing here', needle), 0, 'a swept file must read as 0, not as absent');
  assert.equal(countOccurrences('', needle), 0);
  assert.equal(countOccurrences('aaa', 'aa'), 1, 'overlapping matches must not be double-counted');

  // And the corpus scan must be reading real files, not an empty list.
  assert.ok((await textFiles()).length > 50, 'the file walk returned too little to be scanning the tree');
});

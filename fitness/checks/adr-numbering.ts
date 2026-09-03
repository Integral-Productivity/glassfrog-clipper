/**
 * Characteristic: **navigability of the decision record**.
 *
 * The rules below were written as `test/adr-numbering.test.ts` after the
 * 2026-08-31 collision, and its header explains why there is deliberately no
 * separate workflow step: `npm test` already runs it, and a second surface is a
 * second thing to drift.
 *
 * That reasoning is preserved exactly. The *rules* moved here; the test file
 * imports them and still asserts them under `npm test`, including its two
 * red-half fixtures. What changed is that the fitness gate can now report them
 * too. One implementation, two reporting surfaces, nothing to drift — see
 * docs/adr/0010.
 *
 * WHAT THE HEADING RULE NOW ASSERTS, AND WHY IT INVERTED. It used to require
 * every heading to repeat its filename's number, because #42 renamed a file to
 * `0006-` with a pure `git mv` and left `# 5.` behind, and #54 repaired that by
 * hand. ADR 0015 removed the number from headings entirely rather than keep
 * guarding the agreement of two copies: the rule below now fails a heading that
 * carries a number at all. The number lives on the filename and nowhere else,
 * so a renumber is a `git mv` with nothing left to drift — which is what #42
 * was trying to do and what the old convention made wrong.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { type CheckResult, type Violation, fail, pass } from '../report.ts';
import { REPO_ROOT } from '../root.ts';

const NAME = 'adr-numbering';
const CHARACTERISTIC = 'navigability — every ADR has one number, on exactly one surface';

export const ADR_DIR = join('docs', 'adr');

/**
 * The collision rule, as a pure function over filenames so it can be exercised
 * against a fixture as well as against the real directory. A guard whose red
 * path is never taken is an assertion, not a test.
 *
 * Returns each duplicated number with the files claiming it, sorted, so a
 * failure message names the files to fix rather than only the count.
 *
 * ADR 0015 kept sequential allocation rather than moving to a scheme in which
 * two branches cannot claim the same number, so this rule still guards a live
 * race — it is not vestigial. What 0015 changed is the cost of losing that
 * race, not the possibility of losing it.
 */
export function duplicateAdrNumbers(filenames: string[]): Array<{ number: string; files: string[] }> {
  const byNumber = new Map<string, string[]>();

  for (const filename of filenames) {
    const number = /^(\d{4})-.+\.md$/.exec(filename)?.[1];
    if (number === undefined) continue;
    const claimed = byNumber.get(number) ?? [];
    claimed.push(filename);
    byNumber.set(number, claimed);
  }

  return [...byNumber.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([number, files]) => ({ number, files: [...files].sort() }))
    .sort((a, b) => a.number.localeCompare(b.number));
}

/**
 * The second surface, kept empty.
 *
 * A heading matching `# N. ` is the shape `adr new` generates and the shape
 * that drifted twice. Banning exactly that form rather than any leading digit
 * is deliberate: it is the generated pattern, so it cannot mistake a decision
 * title for a stale number, and it mirrors the parser this rule replaced.
 *
 * A file with *no* heading is still reported, for the reason the old rule gave:
 * a heading the parser cannot see is exactly the state this guard exists to
 * fail on, and silently skipping it is how a fitness function rots into a
 * no-op. A file whose filename carries no number is skipped, matching
 * `duplicateAdrNumbers` — the stray-filename rule below reports it instead.
 */
export function numberedHeadings(
  adrs: Array<{ filename: string; heading: string | undefined }>,
): Array<{ filename: string; heading: string | undefined }> {
  return adrs
    .filter(({ filename }) => /^\d{4}-.+\.md$/.test(filename))
    .filter(({ heading }) => heading === undefined || /^#\s+\d+\.\s/.test(heading))
    .map(({ filename, heading }) => ({ filename, heading }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

export async function adrFilenames(root = REPO_ROOT): Promise<string[]> {
  return (await readdir(join(root, ADR_DIR))).filter((name) => name.endsWith('.md'));
}

export async function adrHeadings(
  root = REPO_ROOT,
): Promise<Array<{ filename: string; heading: string | undefined }>> {
  return Promise.all(
    (await adrFilenames(root)).map(async (filename) => {
      const contents = await readFile(join(root, ADR_DIR, filename), 'utf8');
      return { filename, heading: contents.split('\n').find((line) => line.startsWith('# ')) };
    }),
  );
}

export async function runAdrNumberingCheck(): Promise<CheckResult> {
  const filenames = await adrFilenames();
  const violations: Violation[] = [];

  for (const { number, files } of duplicateAdrNumbers(filenames)) {
    violations.push({
      where: `${ADR_DIR}/${number}-*`,
      detail: `claimed by ${files.join(' and ')} — renumber the later one to the next free slot with \`git mv\`; the number is on the filename only, so nothing else needs editing.`,
    });
  }

  for (const { filename, heading } of numberedHeadings(await adrHeadings())) {
    violations.push({
      where: join(ADR_DIR, filename),
      detail:
        heading === undefined
          ? 'has no `# ` heading — an ADR the reader cannot title is one this guard cannot see.'
          : `heading ${JSON.stringify(heading)} carries a number — the number lives on the filename only (ADR 0015), so a renumber stays a pure \`git mv\`. Drop the \`N. \` prefix.`,
    });
  }

  // A filter that stopped matching would parse nothing, find no duplicates, and
  // report green over a guard that had quietly stopped guarding.
  const numbered = filenames.filter((name) => /^\d{4}-.+\.md$/.test(name));
  if (numbered.length < 6) {
    violations.push({
      where: ADR_DIR,
      detail: `only ${numbered.length} numbered ADRs parsed — the corpus moved, or the filename convention changed.`,
    });
  }
  for (const stray of filenames.filter((name) => !numbered.includes(name))) {
    violations.push({
      where: join(ADR_DIR, stray),
      detail: 'carries no NNNN- prefix, so the numbering guard cannot see it.',
    });
  }

  return violations.length === 0
    ? pass(NAME, CHARACTERISTIC, `${numbered.length} ADRs, each with a unique number carried by its filename alone.`)
    : fail(NAME, CHARACTERISTIC, 'ADR numbering is ambiguous', violations);
}

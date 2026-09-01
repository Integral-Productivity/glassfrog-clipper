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
 * The collision this guards is not hypothetical for this repo today: as of
 * 2026-09-01, PRs #61 and #66 both carry a `docs/adr/0007-*.md`, and neither
 * names the number anywhere a PR-title search can see it.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { type CheckResult, type Violation, fail, pass } from '../report.ts';
import { REPO_ROOT } from '../root.ts';

const NAME = 'adr-numbering';
const CHARACTERISTIC = 'navigability — every ADR has one number, on both surfaces';

export const ADR_DIR = join('docs', 'adr');

/**
 * The collision rule, as a pure function over filenames so it can be exercised
 * against a fixture as well as against the real directory. A guard whose red
 * path is never taken is an assertion, not a test.
 *
 * Returns each duplicated number with the files claiming it, sorted, so a
 * failure message names the files to fix rather than only the count.
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
 * The second surface carrying the same number.
 *
 * #42 renumbered the queue-health ADR from `0005` to `0006` with a pure
 * `git mv` — 100% similarity, no content touched — so the filename moved and
 * the in-file `# 5.` heading stayed behind. A reader browsing rendered ADRs
 * sees headings, not filenames. So does an agent grepping `^# `.
 *
 * Filenames zero-pad to four digits (`0006-`); headings do not (`# 6.`). The
 * comparison is therefore numeric, not textual — string equality would report
 * every correctly-numbered ADR in the repo as a mismatch.
 *
 * A file whose filename carries no number is skipped, matching
 * `duplicateAdrNumbers`. A file whose *heading* carries no number is reported:
 * a heading the parser cannot read is exactly the state this guard exists to
 * fail on, and silently skipping it is how a fitness function rots into a no-op.
 */
export function headingNumberMismatches(
  adrs: Array<{ filename: string; heading: string | undefined }>,
): Array<{ filename: string; filenameNumber: number; heading: string | undefined }> {
  const mismatches: Array<{ filename: string; filenameNumber: number; heading: string | undefined }> = [];

  for (const { filename, heading } of adrs) {
    const fromFilename = /^(\d{4})-.+\.md$/.exec(filename)?.[1];
    if (fromFilename === undefined) continue;

    const fromHeading = heading === undefined ? undefined : /^#\s+(\d+)\.\s/.exec(heading)?.[1];
    if (fromHeading !== undefined && Number(fromHeading) === Number(fromFilename)) continue;

    mismatches.push({ filename, filenameNumber: Number(fromFilename), heading });
  }

  return mismatches.sort((a, b) => a.filename.localeCompare(b.filename));
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
      detail: `claimed by ${files.join(' and ')} — renumber the later one to the next free slot and update references to it.`,
    });
  }

  for (const { filename, filenameNumber, heading } of headingNumberMismatches(await adrHeadings())) {
    violations.push({
      where: join(ADR_DIR, filename),
      detail: `filename says ${filenameNumber}, heading says ${JSON.stringify(heading ?? '(none)')} — a renumber that moves the file must edit the heading too.`,
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
    ? pass(NAME, CHARACTERISTIC, `${numbered.length} ADRs, each with a unique number matching its heading.`)
    : fail(NAME, CHARACTERISTIC, 'ADR numbering is ambiguous', violations);
}

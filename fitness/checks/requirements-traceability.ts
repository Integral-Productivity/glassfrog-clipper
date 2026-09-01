/**
 * Characteristic: **traceability**. Every requirement is implemented, tested,
 * or deferred in writing — never quietly unclaimed.
 *
 * The rule was written as `test/requirements-coverage.test.ts`, which described
 * itself as a fitness function for the Definition of Done's first global
 * clause. It still runs under `npm test`; the rule lives here so the gate can
 * report it too. See docs/adr/0010.
 *
 * This checks traceability, not correctness: the behavioural assertions live in
 * the unit suite and in features/. What it prevents is a requirement going
 * *unclaimed* — losing its last reference while everything stays green.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { type CheckResult, type Violation, fail, pass } from '../report.ts';
import { REPO_ROOT } from '../root.ts';

const NAME = 'requirements-traceability';
const CHARACTERISTIC = 'traceability — no requirement loses its last reference silently';

export const TOTAL_REQUIREMENTS = 22;

/**
 * Requirements deliberately not implemented here, each with the issue that
 * carries it. The plan's Scope Boundaries defer these; this is that deferral
 * made executable, so "deferred" cannot silently become "forgotten".
 */
export const DEFERRED: Record<number, string> = {
  // Telemetry instrumentation. The DoD still forbids the API key reaching any
  // telemetry field, which errors.test.ts enforces today.
  13: 'https://github.com/Integral-Productivity/glassfrog-clipper-chrome-extension/issues/3',
};

/**
 * Where a citation counts as a claim.
 *
 * `features/` was added when the BDD suite landed: a scenario naming R11 is
 * traceability in exactly the sense this check means, and .feature files count
 * alongside their step definitions.
 *
 * `fitness/` is deliberately NOT here. A check citing a requirement says
 * something about the check, not about whether the requirement is implemented —
 * counting it would let this file satisfy itself.
 */
export const TRACED_DIRECTORIES = ['src', 'test', 'features'] as const;
const TRACED_EXTENSIONS = ['.ts', '.feature'];

/** The pure rule, so a fixture can exercise the red path. */
export function unclaimedRequirements(
  corpus: string,
  deferred: Record<number, string> = DEFERRED,
  total: number = TOTAL_REQUIREMENTS,
): string[] {
  const referenced = new Set<number>();
  for (const match of corpus.matchAll(/\bR(\d{1,2})\b/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= total) referenced.add(n);
  }

  const unclaimed: string[] = [];
  for (let n = 1; n <= total; n += 1) {
    if (referenced.has(n) || n in deferred) continue;
    unclaimed.push(`R${n}`);
  }
  return unclaimed;
}

/** Deferrals must name a real issue, or "deferred" is just a word. */
export function malformedDeferrals(deferred: Record<number, string> = DEFERRED): string[] {
  return Object.entries(deferred)
    .filter(([, issue]) => !/^https:\/\/github\.com\/.+\/issues\/\d+$/.test(issue))
    .map(([requirement]) => `R${requirement}`);
}

async function filesUnder(dir: string, root = REPO_ROOT): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...(await filesUnder(join(dir, entry.name), root)));
    else if (TRACED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

export async function tracedCorpus(root = REPO_ROOT): Promise<string> {
  const paths = (
    await Promise.all(TRACED_DIRECTORIES.map((dir) => filesUnder(dir, root)))
  ).flat();
  return (await Promise.all(paths.map((path) => readFile(join(root, path), 'utf8')))).join('\n');
}

export async function runRequirementsTraceabilityCheck(): Promise<CheckResult> {
  const violations: Violation[] = [];

  for (const requirement of unclaimedRequirements(await tracedCorpus())) {
    violations.push({
      where: TRACED_DIRECTORIES.join(', '),
      detail: `${requirement} is cited nowhere and is not listed as deferred — cite it where it is implemented or tested, or defer it with its issue.`,
    });
  }

  for (const requirement of malformedDeferrals()) {
    violations.push({
      where: 'fitness/checks/requirements-traceability.ts',
      detail: `${requirement} is deferred without a real issue link.`,
    });
  }

  return violations.length === 0
    ? pass(
        NAME,
        CHARACTERISTIC,
        `${TOTAL_REQUIREMENTS - Object.keys(DEFERRED).length} of ${TOTAL_REQUIREMENTS} requirements traced; ${Object.keys(DEFERRED).length} deferred with an issue.`,
      )
    : fail(NAME, CHARACTERISTIC, 'a requirement is unclaimed', violations);
}

/**
 * The architecture fitness suite for this repo.
 *
 * Contract, set by devops-excellence's `reusable-architecture-fitness.yml`,
 * which invokes `fitness:self --json-out=<path> | tee <report>`:
 *
 *   - markdown summary on stdout, consumed as the GitHub step summary
 *   - `--json-out=<path>` writes the machine-readable form
 *   - non-zero exit on any violation
 *
 * Building to that contract now, while the reusable is still unreachable from
 * here (devops-excellence#603) and still pnpm-only, is what makes the eventual
 * swap a workflow edit rather than a rewrite. See docs/adr/0010.
 *
 * Hard-blocking, with no --warn-only: the only target is this repo, so there is
 * nobody downstream to wait for.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { runAdrNumberingCheck } from '../checks/adr-numbering.ts';
import { runBundleShapeCheck } from '../checks/bundle-shape.ts';
import { runCredentialConfinementCheck } from '../checks/credential-confinement.ts';
import { runManifestPermissionsCheck } from '../checks/manifest-permissions.ts';
import { runRequirementsTraceabilityCheck } from '../checks/requirements-traceability.ts';
import { runSdkBoundaryCheck } from '../checks/sdk-boundary.ts';
import { type CheckResult, renderMarkdown } from '../report.ts';

/**
 * Every check the suite runs. Exported so `test/fitness/suite.test.ts` can
 * assert that each one has a colocated test — a check nobody tests is a check
 * that can rot into an unconditional pass without anyone noticing.
 */
export const CHECKS: Array<() => Promise<CheckResult>> = [
  runBundleShapeCheck,
  runCredentialConfinementCheck,
  runManifestPermissionsCheck,
  runSdkBoundaryCheck,
  runAdrNumberingCheck,
  runRequirementsTraceabilityCheck,
];

interface Flags {
  jsonOut: string | null;
}

function parseArgs(argv: string[]): Flags {
  let jsonOut: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith('--json-out=')) jsonOut = arg.slice('--json-out='.length);
  }
  return { jsonOut };
}

export async function runAll(): Promise<CheckResult[]> {
  // Sequential rather than concurrent. The suite is IO-light and finishes in
  // well under a second, and a deterministic order keeps the report diffable
  // between runs, which matters more here than the milliseconds.
  const results: CheckResult[] = [];
  for (const check of CHECKS) results.push(await check());
  return results;
}

async function main(): Promise<void> {
  const { jsonOut } = parseArgs(process.argv.slice(2));
  const results = await runAll();

  process.stdout.write(`${renderMarkdown(results)}\n`);

  if (jsonOut) {
    await mkdir(dirname(jsonOut), { recursive: true });
    await writeFile(jsonOut, `${JSON.stringify({ results }, null, 2)}\n`, 'utf8');
  }

  if (results.some((result) => !result.compliant)) process.exitCode = 1;
}

await main();

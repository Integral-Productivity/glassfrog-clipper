/**
 * The online half of the operator-errand guard.
 *
 * Reads issue bodies, so it needs the GitHub API and therefore cannot live in
 * `npm test`: there it would fail red on a fork and on any clone without a
 * token, punishing a contributor for an account they do not have. That is the
 * same split `check-labels.mjs` sits in, and `docs/agents/triage-labels.md`
 * documents it — this reuses that split rather than inventing a third pattern.
 *
 * The rules themselves are in `operator-runbooks.ts`, which is pure and tested
 * offline. This file is only the part that talks to a forge.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { type Errand, markdownReport, nonCompliantErrands } from './operator-runbooks.ts';
import { repoSlug } from './repo-slug.ts';

/**
 * Open errands only.
 *
 * A closed errand's runbook is history: nothing can act on it, and re-reporting
 * it every night is noise that trains people to skip the report — which is the
 * failure this check exists to prevent, arrived at from the other side.
 */
export function fetchOpenErrands(slug: string): Errand[] {
  const out = execFileSync(
    'gh',
    [
      'issue', 'list',
      '--repo', slug,
      '--label', 'operator-errand',
      '--state', 'open',
      '--limit', '100',
      '--json', 'number,title,body',
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(out) as Errand[];
}

function main(): void {
  const errands = fetchOpenErrands(repoSlug());
  const problems = nonCompliantErrands(errands);

  // An empty candidate set is not a pass. `operator-errand` had zero members
  // until #198 pushed the label and applied it, and a check that reported green
  // over nothing is exactly the shape docs/solutions/workflow-issues/
  // a-gate-that-fails-green-is-the-one-you-will-not-find.md is about.
  if (errands.length === 0) {
    console.log('No open operator-errand issues. Nothing to check — and nothing checked.');
    console.log('::warning::The operator-errand label has no open members; this run verified nothing.');
    process.exit(0);
  }

  if (problems.length === 0) {
    console.log(`All ${errands.length} open operator-errand issue(s) carry a runbook and an agent block.`);
    process.exit(0);
  }

  console.log(markdownReport(problems, errands.length));
  process.exit(1);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) main();

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { fromRoot } from '../fitness/root.ts';

/**
 * The two required status checks, pinned by name.
 *
 * `main`'s own ruleset requires exactly these two contexts alongside `verify`
 * (#88, ADR 0012), and `devops-excellence/rulesets/self-governance-adopted.json`
 * names the same two for the eventual org-managed tier. Until #88 only the org
 * ruleset named them, and it is not applied to this repository — so both
 * reported on every PR and neither gated one.
 *
 * A required check that never reports blocks every PR, so the name is not
 * cosmetic — it is the whole mechanism.
 *
 * The names look wrong on purpose. A caller of a reusable workflow emits
 * `<caller job name> / <called job name>`, which is how devops-excellence's own
 * ci.yml gets these from jobs named `BDD` and `Software Fitness`. A plain job
 * emits its own name, so a local runner has to carry the whole string. That
 * reads like a typo, and "fixing" it would silently un-gate the repo at the
 * exact moment the ruleset starts depending on it — a failure with no red
 * anywhere, which is the class of thing this repo writes guards for.
 *
 * These stay correct through the eventual swap to the org reusables
 * (devops-excellence#603 and #617): the migration replaces each job's `steps:`
 * with a `uses:`, and this test then wants the shorter prefixes. Changing it at
 * that point is the point.
 */

const WORKFLOW = '.github/workflows/bdd-and-fitness.yml';

/** Exactly the contexts the tier-1 ruleset requires. */
const REQUIRED_CONTEXTS = ['BDD / Scenarios', 'Software Fitness / Self-compliance'];

const workflow = async (): Promise<string> => readFile(fromRoot(WORKFLOW), 'utf8');

test('the workflow emits both contexts the tier-1 ruleset requires', async () => {
  const source = await workflow();
  const jobNames = [...source.matchAll(/^\s{4}name:\s*(.+?)\s*$/gm)].map((match) => match[1]);

  for (const context of REQUIRED_CONTEXTS) {
    assert.ok(
      jobNames.includes(context),
      `no job named ${JSON.stringify(context)} — the ruleset requires that exact context, and a check that never reports blocks every PR. Job names found: ${JSON.stringify(jobNames)}`,
    );
  }
});

test('the workflow runs the same package scripts the org reusables invoke', async () => {
  // reusable-bdd.yml runs `pnpm bdd`; reusable-architecture-fitness.yml runs
  // `pnpm fitness:self --json-out=...`. Building to that contract is what makes
  // the swap a `uses:` edit rather than a rewrite.
  const source = await workflow();
  assert.match(source, /npm run bdd\b/);
  assert.match(source, /fitness:self.*--json-out=/);
});

test('the workflow declares a pipefail-safe shell, because it pipes', async () => {
  // ADR-043 / the #115 masking incident: GitHub's implicit `run:` shell is
  // `bash -e {0}` with no pipefail, so `fitness:self | tee report.md` exits 0
  // even when fitness:self exits 1 — the gate ships green over a red suite.
  // Verified locally: with pipefail the piped step exits 1, without it, 0.
  const source = await workflow();
  assert.match(source, /defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash/);
  assert.ok(source.includes('| tee'), 'if the pipe is gone, this guard is guarding nothing — re-read it');
});

test('the two package scripts the gates depend on exist', async () => {
  const { scripts } = JSON.parse(await readFile(fromRoot('package.json'), 'utf8'));
  assert.equal(typeof scripts.bdd, 'string', 'reusable-bdd.yml requires a `bdd` script');
  assert.equal(
    typeof scripts['fitness:self'],
    'string',
    'reusable-architecture-fitness.yml requires a `fitness:self` script',
  );
});

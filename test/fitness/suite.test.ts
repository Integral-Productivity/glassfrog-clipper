import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { CHECKS, runAll } from '../../fitness/self/cli.ts';
import { fail, pass, renderMarkdown } from '../../fitness/report.ts';
import { REPO_ROOT, fromRoot } from '../../fitness/root.ts';
import { CHECK_SOURCES, REQUIRED_CHECKS } from '../support/required-checks.ts';

/**
 * The guard on the guards.
 *
 * A fitness suite decays in two specific ways, and neither shows up as a red:
 * a check quietly stops being run, or a check keeps running but can no longer
 * fail. Both leave the gate green while it protects nothing — which is exactly
 * the "vacuous pass" #69's acceptance criteria rule out.
 */

test('every check is exercised by a test, and is wired into the suite', async () => {
  const checks = (await readdir('fitness/checks'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => name.replace(/\.ts$/, ''));

  // The rule is "imported by some test", not "has a file of the same name in
  // test/fitness/". Filename colocation is only a proxy for it, and this repo
  // breaks the proxy on purpose: `adr-numbering` and `requirements-traceability`
  // are asserted from test/adr-numbering.test.ts and
  // test/requirements-coverage.test.ts, where they were written and where their
  // history reads (docs/adr/0010). Checking the import also catches the case the
  // proxy misses entirely — a test file that exists but exercises nothing.
  const testFiles: string[] = [];
  for (const entry of await readdir('test', { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      testFiles.push(join(entry.parentPath, entry.name));
    }
  }
  const corpus = (await Promise.all(testFiles.map((path) => readFile(path, 'utf8')))).join('\n');

  assert.deepEqual(
    checks.filter((check) => !corpus.includes(`fitness/checks/${check}.ts`)).sort(),
    [],
    'a check no test imports can rot into an unconditional pass without anything going red',
  );

  const results = await runAll();
  assert.deepEqual(
    checks.filter((check) => !results.some((result) => result.name === check)).sort(),
    [],
    'a check that exists but is not in CHECKS is not being run at all',
  );
  assert.equal(results.length, CHECKS.length);
});

test('every check names the architectural characteristic it defends', async () => {
  // docs/adr/0010: a check whose rationale is not carried in its own output
  // becomes a check nobody dares change. The report is where that lands.
  for (const result of await runAll()) {
    assert.ok(result.characteristic.length > 10, `${result.name} has no characteristic`);
    assert.ok(result.summary.length > 0, `${result.name} reports no summary`);
  }
});

test('a failure that names nothing is rejected as a bug in the check', () => {
  // A red with no violations renders as a failure a reader cannot act on.
  assert.throws(() => fail('x', 'y', 'z', []), /reported a failure with no violations/);
});

test('the markdown report leads with failures and their detail', () => {
  const rendered = renderMarkdown([
    pass('ok-check', 'some characteristic', 'all good'),
    fail('bad-check', 'another characteristic', 'it broke', [
      { where: 'src/thing.ts', detail: 'did the wrong thing' },
    ]),
  ]);

  assert.match(rendered, /\*\*1 of 2 checks failed\.\*\*/);
  // The detail must be inline: the reusable pipes this into the step summary,
  // where it is read far more often on the red path than behind an artifact.
  assert.match(rendered, /src\/thing\.ts` — did the wrong thing/);
  assert.ok(
    rendered.indexOf('bad-check') < rendered.indexOf('| Check |'),
    'failures come before the summary table',
  );
});

test('an all-green run says so without listing anything', () => {
  const rendered = renderMarkdown([pass('a', 'characteristic a', 'fine')]);
  assert.match(rendered, /\*\*1 checks, all compliant\.\*\*/);
  assert.ok(!rendered.includes('❌'));
});

test('importing the CLI runs nothing — it is a module as well as a command', async () => {
  /*
   * A regression test for a bug CI caught and local runs could not.
   *
   * `fitness/self/cli.ts` used to `await main()` at module scope. This file
   * imports `CHECKS` and `runAll` from it, so the import ran the whole suite:
   * it printed the report into the TAP stream, and set `process.exitCode = 1`
   * whenever any check failed — failing this test file even though every
   * assertion in it passed.
   *
   * It was invisible locally because `dist/` already existed. In CI, `ci.yml`
   * runs `npm test` before `npm run build`, so the bundle check found no
   * artifact and reported a failure (a failure rather than a skip, deliberately)
   * whose exit code the test process inherited.
   *
   * Asserting on stdout rather than on the exit code is what makes this catch
   * the bug in either environment: if `main()` runs on import it prints the
   * markdown report, whether the suite is green or red.
   */
  const cli = fromRoot('fitness/self/cli.ts');
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(cli).href)});`],
    { cwd: REPO_ROOT },
  );

  assert.equal(
    stdout.trim(),
    '',
    'importing the CLI printed a report, so it executed on import — restore the entry-point guard',
  );
});

/**
 * The third decay mode: a check that still runs and still fails, in a workflow
 * nobody is required to be green on.
 *
 * The two guards above cover a check that stops being run and a check that can
 * no longer fail. #88 found the one they miss. `scripts/check-bundle.mjs` became
 * a three-line shim over `fitness/checks/bundle-shape.ts` in #86, so `ci.yml`'s
 * "Check the service worker bundle" step and the fitness suite assert the same
 * thing twice — and the obvious cleanup is to delete the duplicate. At the time
 * `verify` was the only merge-blocking context, so deleting that step would have
 * moved `bundle-shape` off the one gating job onto a job that reported without
 * gating. Every test passed. The suite still ran it, it could still fail, and
 * failing would no longer have stopped anything.
 *
 * So the property to assert is not about the checks; it is about who is obliged
 * to be green. Three links carry it, all offline:
 *
 *   1. a context in `REQUIRED_CHECKS` is emitted by a job that runs
 *      `npm run … fitness:self`     — asserted below
 *   2. the `fitness:self` script runs `fitness/self/cli.ts`, which owns `CHECKS`
 *                                    — asserted below
 *   3. `CHECKS` covers every file in `fitness/checks/`
 *                                    — asserted by the first test in this file
 *
 * Break any one and a check stops being gated. Link 3 is not repeated here; it
 * is the same assertion, and two copies of it would drift.
 */

export interface WorkflowJob {
  /** The job's key under `jobs:`. */
  id: string;
  /** What the check run is called: `name:` where present, otherwise the id. */
  name: string;
  /** This job's lines alone, so a sibling job's `run:` cannot be read as its own. */
  body: string;
}

/**
 * Split a workflow's `jobs:` block into jobs, keyed by the context each emits.
 *
 * Job-scoped rather than a whole-file search, and that is the entire point. A
 * grep for `fitness:self` across `bdd-and-fitness.yml` passes whether the
 * command sits in the required job or the one beside it — which is precisely
 * the distinction #88 turned on. Scanning the file would reproduce the bug in
 * the guard written to catch it.
 *
 * A line scan, not a YAML parse, for the same reason `pullRequestTrigger` is:
 * the repo carries no YAML dependency and the facts needed sit at fixed
 * indents. It understands neither `jobs:` as a flow mapping nor a job whose
 * `name:` arrives through an anchor. Both are absent here, and the assertion
 * below fails loudly rather than quietly finding no jobs if one appears.
 */
export function workflowJobs(source: string): WorkflowJob[] {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (start === -1) return [];

  const jobs: WorkflowJob[] = [];
  let current: { id: string; name?: string; body: string[] } | undefined;

  const close = (): void => {
    if (current) jobs.push({ id: current.id, name: current.name ?? current.id, body: current.body.join('\n') });
    current = undefined;
  };

  for (const line of lines.slice(start + 1)) {
    // A new top-level key ends the `jobs:` block.
    if (/^\S/.test(line)) break;

    const header = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (header?.[1] !== undefined) {
      close();
      current = { id: header[1], body: [] };
      continue;
    }
    if (!current) continue;

    // Exactly four spaces: a step's `- name:` sits at six and must not match.
    const name = line.match(/^ {4}name:\s*(?:'([^']*)'|"([^"]*)"|(.+?))\s*$/);
    const declared = name?.[1] ?? name?.[2] ?? name?.[3];
    if (declared !== undefined) current.name = declared;

    current.body.push(line);
  }
  close();

  return jobs;
}

/**
 * Which required contexts are emitted by a job that runs `command`.
 *
 * `command` must not be global — a `/g` regex carries `lastIndex` between
 * `test` calls and would start skipping matches after the first.
 */
export function contextsRunning(
  command: RegExp,
  required: string[],
  sources: Record<string, string>,
  workflows: Record<string, string>,
): string[] {
  const running: string[] = [];

  for (const context of required) {
    const workflow = sources[context];
    if (workflow === undefined) continue;
    const source = workflows[workflow];
    if (source === undefined) continue;

    const job = workflowJobs(source).find((candidate) => candidate.name === context);
    if (job && command.test(job.body)) running.push(context);
  }

  return running;
}

/** `npm run fitness:self`, with or without `--silent`, and never in a comment. */
const RUNS_THE_SUITE = /^(?!\s*#).*\bnpm run\b.*\bfitness:self\b/m;

async function mappedWorkflows(): Promise<Record<string, string>> {
  const names = [...new Set(Object.values(CHECK_SOURCES))];
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await readFile(fromRoot(join('.github', 'workflows', name)), 'utf8')] as const),
    ),
  );
}

test('the fitness suite runs inside a context that blocks the merge', async () => {
  const workflows = await mappedWorkflows();

  // Link 1. Not "some workflow runs the suite" — some *required context's own
  // job* runs it.
  const gating = contextsRunning(RUNS_THE_SUITE, REQUIRED_CHECKS, CHECK_SOURCES, workflows);
  assert.ok(
    gating.length > 0,
    `no required check runs the fitness suite, so every check in fitness/checks/ can fail without blocking a merge. Required: ${JSON.stringify(REQUIRED_CHECKS)}`,
  );

  // Link 2. The script is the joint between the workflow and this module, and
  // it is the quiet one: repoint `fitness:self` at anything else and link 1
  // still passes while nothing in `CHECKS` runs.
  const { scripts } = JSON.parse(await readFile(fromRoot('package.json'), 'utf8'));
  assert.match(
    scripts['fitness:self'],
    /fitness\/self\/cli\.ts/,
    'the fitness:self script no longer runs fitness/self/cli.ts, so the gated suite is not the one CHECKS describes',
  );
});

test('the job parser reads a job body, not the whole file', () => {
  // The red half, and #88's shape exactly: the suite runs, but in the job that
  // is not required. A whole-file search would call this gated. `[]` is the
  // guard working.
  const source = [
    'jobs:',
    '  gated:',
    '    name: Required / Context',
    '    steps:',
    '      - name: Install',
    '        run: npm ci',
    '  ungated:',
    '    name: Advisory / Context',
    '    steps:',
    '      - run: npm run fitness:self',
    '',
  ].join('\n');

  const jobs = workflowJobs(source);
  assert.deepEqual(
    jobs.map((job) => job.name),
    ['Required / Context', 'Advisory / Context'],
  );
  assert.ok(!jobs[0]?.body.includes('fitness:self'), 'a sibling job’s step leaked into this job’s body');

  const sources = { 'Required / Context': 'w.yml' };
  assert.deepEqual(contextsRunning(RUNS_THE_SUITE, ['Required / Context'], sources, { 'w.yml': source }), []);
});

test('a job with no name: emits its id, which is how verify is required', () => {
  // `ci.yml`'s job is `verify:` with no `name:` override, so the fallback is
  // not a convenience — it is the rule that makes the real mapping work.
  const source = 'jobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run fitness:self\n';

  assert.deepEqual(workflowJobs(source).map((job) => job.name), ['verify']);
  assert.deepEqual(contextsRunning(RUNS_THE_SUITE, ['verify'], { verify: 'ci.yml' }, { 'ci.yml': source }), ['verify']);
});

test('a commented-out invocation does not count as running the suite', () => {
  // A guard that reads a comment as a command is a guard that goes green on a
  // disabled step.
  const source =
    'jobs:\n  fitness:\n    name: Fitness\n    steps:\n      # - run: npm run fitness:self\n      - run: npm ci\n';

  assert.deepEqual(contextsRunning(RUNS_THE_SUITE, ['Fitness'], { Fitness: 'w.yml' }, { 'w.yml': source }), []);
});

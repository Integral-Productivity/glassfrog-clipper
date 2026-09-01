import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { CHECKS, runAll } from '../../fitness/self/cli.ts';
import { fail, pass, renderMarkdown } from '../../fitness/report.ts';

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

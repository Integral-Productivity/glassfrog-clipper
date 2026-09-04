import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * A fitness function for docs/adr/0011's surface layer — both halves of it.
 *
 * 0011 puts behaviour at the domain and a thin surface layer on each platform:
 * `features/surface/chrome.feature` for Chrome, and — 0011's Consequences
 * records why it is Swift rather than a `safari.feature` —
 * `ShareSheetSurfaceTests.swift` for Safari. Neither states behaviour the other
 * does; deleting either loses a platform's specification outright.
 *
 * [#98](../../issues/98) found that nothing required fails when the Safari half
 * is deleted, and asked for a gate.
 *
 * ONE CORRECTION TO THAT ISSUE, because building to its framing would have
 * shipped half a guard. #98 says the Chrome half "is enforced" and only the
 * Swift half is not. Measured on 2026-09-02, both premises behind that are
 * false: `npm run bdd` does not run inside `verify` — it runs in
 * `bdd-and-fitness.yml` as `BDD / Scenarios`, which is unfiltered and therefore
 * *requirable*, but was not then among what `main` actually required. Deleting
 * `features/surface/chrome.feature` and running the required suite passes,
 * 354 of 354. `test/requirements-coverage.test.ts`
 * does trace `features/`, but no requirement loses its last citation when that
 * file goes.
 *
 * So the gap was symmetric and the Swift half was simply the one that got
 * looked at. This guard is therefore symmetric too — a guard that protected one
 * half while its identical twin rotted is how the asymmetry arose in the first
 * place.
 *
 * WHY IT LIVES HERE RATHER THAN IN THE RULESET. The obvious fix is to require
 * the checks that run these suites, and ADR 0012 uses these very names to say
 * why that fails: `apple.yml` is path-filtered to `apple/**`, so `Swift core` is
 * silent on a pull request touching nothing under that path, and a required
 * check that never reports does not fail a pull request — it pins it at
 * "Expected — waiting for status to be reported", with nothing timing out.
 * `test/branch-protection.test.ts`'s `unreliablyRequiredChecks` goes red if
 * anyone tries. So this runs where the gate already is: under `verify`, on
 * Linux, on every pull request.
 *
 * BE PRECISE ABOUT WHAT THAT BUYS, because the header on `SharedItem.swift`
 * once overclaimed in exactly this direction and had to be corrected. This
 * proves each surface layer is still *wired up*; deletion, gutting and silent
 * unwiring are what it catches. It cannot itself prove either suite is green.
 *
 * Whether a *red* suite blocks a merge is a separate question, and the two
 * halves no longer answer it the same way. `BDD / Scenarios` is now required on
 * `main` (#194, landed by #202; ADR 0012's amendment records it), so a red
 * Chrome run does block a merge — the Chrome half of what
 * [#91](../../issues/91) described is closed. `Swift core` is still not
 * required, because ADR 0012 explains that requiring a path-filtered check
 * would pin every non-Apple pull request at "waiting for status to be
 * reported"; a red Safari run therefore still blocks nothing, which remains
 * [#133](../../issues/133).
 *
 * Five ways a surface layer stops being specified, four of which leave every
 * other check green:
 *
 *   1. the specification file is deleted        — caught, both halves
 *   2. it is gutted to a stub                   — caught, by a case floor
 *   3. the Swift test target stops covering it  — caught, via Package.swift
 *   4. nothing in CI runs the suite any more    — caught, both halves; the one
 *      #98 did not name. Delete `apple.yml` today and the Swift suite stops
 *      running entirely, with nothing to notice.
 *   5. the suite runs and fails                 — NOT caught. See above.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The Safari surface-layer specification, as 0011's Consequences names it. */
export const SWIFT_SPECIFICATION = join(
  'apple',
  'GlassFrogClipperCore',
  'Tests',
  'GlassFrogClipperCoreTests',
  'ShareSheetSurfaceTests.swift',
);

/** The Chrome surface-layer specification. `features/surface/` is Chrome-only by decision. */
export const CHROME_SPECIFICATION = join('features', 'surface', 'chrome.feature');

/** What `swift test --package-path` is pointed at. Written as CI writes it. */
export const PACKAGE_PATH = 'apple/GlassFrogClipperCore';

/**
 * The SwiftPM test target that must cover the Safari specification. SwiftPM
 * finds a test target's sources at `Tests/<target name>/`, so this name and the
 * directory in SWIFT_SPECIFICATION are the same fact stated twice — which is
 * why the test below asserts they agree rather than trusting either alone.
 */
export const TEST_TARGET = 'GlassFrogClipperCoreTests';

/**
 * Floors, not counts. High enough that gutting a file to a stub fails; low
 * enough that removing a case which turned out to be redundant does not force
 * an edit here and teach everyone to raise the floor reflexively.
 *
 * There are 21 Swift cases and 4 Chrome scenarios today. The Chrome floor is
 * necessarily tight — with four scenarios there is little room between "intact"
 * and "gutted", so it tolerates exactly one deliberate removal and catches
 * emptying. That is worth stating rather than pretending the two floors carry
 * the same weight: the Chrome one is close to a presence check.
 */
export const MINIMUM_CASES = 15;
export const MINIMUM_SCENARIOS = 3;

/**
 * The declared Swift test cases, by name.
 *
 * A `@Test` carrying no description counts as `(unnamed)` rather than being
 * skipped: the floor is about how much specification is present, and a case
 * without a description is still a case. The known limit is that a `@Test`
 * written inside a comment would be counted, which fails open — worth naming,
 * though gutting the file while leaving fifteen commented `@Test`s behind is
 * not a failure mode anyone reaches by accident.
 */
export function testCases(source: string): string[] {
  return [...source.matchAll(/@Test\b\s*(?:\(\s*"((?:[^"\\]|\\.)*)")?/g)].map((match) => match[1] ?? '(unnamed)');
}

/** The declared Gherkin scenarios, by name. `Scenario Outline` counts as one. */
export function scenarios(source: string): string[] {
  return [...source.matchAll(/^[ \t]*Scenario(?: Outline)?:[ \t]*(.*)$/gm)].map((match) => (match[1] ?? '').trim());
}

/** The test targets `Package.swift` declares. */
export function testTargets(manifest: string): string[] {
  return [...manifest.matchAll(/\.testTarget\(\s*name:\s*"([^"]+)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/**
 * Which of the given sources actually *run* a command, rather than mentioning it.
 *
 * That distinction is the whole job. `apple.yml` names
 * `swift test --package-path apple/GlassFrogClipperCore` twice: once as the step
 * that runs it, and once inside an `echo "::error::…"` telling a contributor what
 * to run. A substring search would count the error message, so deleting the real
 * step would leave this guard green — failing open, in the one direction a guard
 * must not.
 *
 * So an invocation is a line that *begins* with the command, allowing for
 * indentation, for a YAML list dash, and for a `run:` prefix. That reads a
 * `run: <cmd>` step and each line of a `run: |` block, and declines the echo.
 * `mentions`, when given, must also appear on that line — which is how the
 * Swift invocation is tied to this package rather than to any package.
 */
export function runnersInvoking(
  sources: Record<string, string>,
  command: string,
  mentions?: string,
): string[] {
  const invokes = (line: string): boolean => {
    const invocation = line.trim().replace(/^-\s+/, '').replace(/^run:\s*/, '');
    return invocation.startsWith(command) && (mentions === undefined || invocation.includes(mentions));
  };

  return Object.entries(sources)
    .filter(([, source]) => source.split('\n').some(invokes))
    .map(([name]) => name)
    .sort();
}

/**
 * Everything CI could run a suite from: the workflow files, and the scripts they
 * call. Both are in scope because both really do invoke one — `apple.yml`
 * directly for the `Swift core` job, and `scripts/verify-apple.sh` for
 * `Xcode targets`.
 */
async function runnerSources(): Promise<Record<string, string>> {
  const directories = [
    { dir: join('.github', 'workflows'), extensions: ['.yml', '.yaml'] },
    { dir: 'scripts', extensions: ['.sh'] },
  ];

  const entries = await Promise.all(
    directories.map(async ({ dir, extensions }) => {
      const names = (await readdir(join(root, dir))).filter((name) =>
        extensions.some((extension) => name.endsWith(extension)),
      );
      return Promise.all(
        names.map(async (name) => [join(dir, name), await readFile(join(root, dir, name), 'utf8')] as const),
      );
    }),
  );

  return Object.fromEntries(entries.flat());
}

test('the Safari surface layer is still there, and still substantive', async () => {
  const cases = testCases(await readFile(join(root, SWIFT_SPECIFICATION), 'utf8'));

  assert.ok(
    cases.length >= MINIMUM_CASES,
    `${SWIFT_SPECIFICATION} declares ${cases.length} test cases, below the floor of ${MINIMUM_CASES}. ` +
      'Deleting or gutting a surface layer must cost a deliberate edit here — see docs/adr/0011 and issue #98.',
  );
});

test('the Chrome surface layer is still there, and still substantive', async () => {
  const declared = scenarios(await readFile(join(root, CHROME_SPECIFICATION), 'utf8'));

  assert.ok(
    declared.length >= MINIMUM_SCENARIOS,
    `${CHROME_SPECIFICATION} declares ${declared.length} scenarios, below the floor of ${MINIMUM_SCENARIOS}. ` +
      'Deleting or gutting a surface layer must cost a deliberate edit here — see docs/adr/0011 and issue #98.',
  );
});

test('the Safari specification sits in a test target the package still declares', async () => {
  const manifest = await readFile(join(root, PACKAGE_PATH, 'Package.swift'), 'utf8');

  assert.ok(
    testTargets(manifest).includes(TEST_TARGET),
    `Package.swift no longer declares a test target named ${TEST_TARGET}, so swift test would not compile ${SWIFT_SPECIFICATION}`,
  );

  // SwiftPM resolves a test target's sources at Tests/<target name>/. Asserting
  // the path agrees with the declared name is what makes the check above mean
  // "this file is compiled" rather than "some test target exists somewhere".
  const covered = join(...PACKAGE_PATH.split('/'), 'Tests', TEST_TARGET);
  assert.ok(
    SWIFT_SPECIFICATION.startsWith(covered),
    `${SWIFT_SPECIFICATION} is outside ${covered}/, so the declared test target does not cover it`,
  );
});

test('something in CI actually runs each surface suite', async () => {
  const sources = await runnerSources();

  assert.notDeepEqual(
    runnersInvoking(sources, 'swift test', PACKAGE_PATH),
    [],
    `nothing under .github/workflows or scripts/ runs "swift test --package-path ${PACKAGE_PATH}". ` +
      'A specification that compiles is worth nothing if no runner executes it.',
  );

  assert.notDeepEqual(
    runnersInvoking(sources, 'npm run bdd'),
    [],
    'nothing under .github/workflows or scripts/ runs "npm run bdd", so no runner executes the Chrome surface layer.',
  );
});

test('the guard is reading a real corpus, not an empty one', async () => {
  // The failure this pins down is the quiet one. A moved directory throws, but
  // a filter that stopped matching would read {} — and every `runnersInvoking`
  // call would return [], which the test above catches, while a future refactor
  // that inverted the sense would report green over nothing. Pin the corpus down.
  const sources = await runnerSources();

  assert.ok(
    Object.keys(sources).length >= 6,
    `expected the runner corpus to be present, read ${Object.keys(sources).length} files`,
  );
  assert.ok(
    Object.keys(sources).some((name) => name.endsWith('.yml')) &&
      Object.keys(sources).some((name) => name.endsWith('.sh')),
    'both halves of the runner corpus must be present — a workflow could invoke a suite, or a script it calls could',
  );
});

test('the guard distinguishes running a suite from merely naming it', () => {
  // The red half, and the reason this is not a substring search. Both fixtures
  // contain the exact command string; only one runs it. `apple.yml` really does
  // carry both shapes, so a guard that could not tell them apart would stay
  // green after the step that runs the tests was deleted.
  const runs = 'jobs:\n  core:\n    steps:\n      - name: Swift core tests\n' +
    `        run: swift test --package-path ${PACKAGE_PATH}\n`;
  const merely = '        run: |\n' +
    `          echo "::error::Then make BOTH suites pass — npm test, and swift test --package-path ${PACKAGE_PATH}."\n`;

  assert.deepEqual(runnersInvoking({ 'runs.yml': runs }, 'swift test', PACKAGE_PATH), ['runs.yml']);
  assert.deepEqual(runnersInvoking({ 'merely.yml': merely }, 'swift test', PACKAGE_PATH), []);
  assert.deepEqual(runnersInvoking({ 'neither.yml': 'jobs:\n  verify:\n    steps: []\n' }, 'swift test'), []);

  // A `run: |` block invokes just as much as a one-line `run:` does.
  const block = '      - name: Verify\n        run: |\n          cd .\n' + `          swift test --package-path ${PACKAGE_PATH}\n`;
  assert.deepEqual(runnersInvoking({ 'block.yml': block }, 'swift test', PACKAGE_PATH), ['block.yml']);

  // `mentions` ties the Swift invocation to this package rather than any package.
  const elsewhere = '        run: swift test --package-path some/other/Package\n';
  assert.deepEqual(runnersInvoking({ 'elsewhere.yml': elsewhere }, 'swift test', PACKAGE_PATH), []);
});

test('the guard detects a gutted specification and a dropped test target', () => {
  // The other red halves. Without them `testCases`, `scenarios` and
  // `testTargets` could each return a constant and every assertion above would
  // pass forever over a guard that had stopped guarding.
  assert.deepEqual(testCases('struct Stub {}\n'), []);
  assert.deepEqual(testCases('@Test("named")\nfunc a() {}\n@Test\nfunc b() {}\n'), ['named', '(unnamed)']);

  assert.deepEqual(scenarios('Feature: nothing\n\n  Background:\n    Given x\n'), []);
  assert.deepEqual(
    scenarios('Feature: f\n\n  Scenario: one\n    Given x\n\n  Scenario Outline: two\n    Given <y>\n'),
    ['one', 'two'],
  );

  assert.deepEqual(testTargets('targets: [.target(name: "GlassFrogClipperCore")]'), []);
  assert.deepEqual(
    testTargets('.testTarget(\n  name: "GlassFrogClipperCoreTests",\n  dependencies: []\n)'),
    ['GlassFrogClipperCoreTests'],
  );
});

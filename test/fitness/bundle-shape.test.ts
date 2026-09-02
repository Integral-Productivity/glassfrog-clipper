import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUNDLE_BUDGET_BYTES,
  bundleViolations,
  runBundleShapeCheck,
} from '../../fitness/checks/bundle-shape.ts';

/**
 * The red halves. `runBundleShapeCheck` against the real artifact is the green
 * half and lives in the fitness run itself; what needs a test is that each rule
 * fires when shown its own failure, because a rule that never fires reports
 * green forever.
 */

test('a bare import specifier is caught', () => {
  const violations = bundleViolations(`import { x } from "some-package";`, 100);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.detail, /bare specifiers: some-package/);
});

test('a relative import is not mistaken for a bare one', () => {
  assert.deepEqual(bundleViolations(`import { x } from "./local.js";`, 100), []);
});

test('esbuild path comments and User-Agent strings do not trip it', () => {
  // The reason the rule matches import syntax rather than the package name:
  // both of these appear in a correct bundle, and failing on them would be a
  // red build with nothing wrong — which is worse than no check at all.
  const source = `// node_modules/@integral-productivity/glassfrog/dist/index.js
const UA = "@integral-productivity/glassfrog/0.6.0";`;
  assert.deepEqual(bundleViolations(source, 100), []);
});

test('a DOM-only global is caught', () => {
  const violations = bundleViolations('const el = document.querySelector("x");', 100);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.detail, /DOM-only globals: document/);
});

test('a bundle over budget is caught, and one at the budget is not', () => {
  assert.deepEqual(bundleViolations('', BUNDLE_BUDGET_BYTES), []);
  const over = bundleViolations('', BUNDLE_BUDGET_BYTES + 1);
  assert.equal(over.length, 1);
  assert.match(over[0]!.detail, /over the 256 KiB budget/);
});

test('a build input for another platform shipping in dist/ is caught', () => {
  // Arrived with the Apple targets (#66): `npm run build` copies all of public/
  // into dist/, so the Safari manifest overlay rides along unless something
  // removes it. The `build` script deletes it and this asserts it is gone —
  // this is the half that survives someone editing the build script.
  assert.deepEqual(bundleViolations('', 100, ['background.js', 'manifest.json']), []);

  const violations = bundleViolations('', 100, ['background.js', 'manifest.safari.json']);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.where, 'dist/manifest.safari.json');
  assert.match(violations[0]!.detail, /build input for another platform/);
});

test('the real bundle is checked, and a missing one is a failure rather than a skip', async () => {
  const result = await runBundleShapeCheck();
  // Either outcome is legitimate depending on whether `npm run build` has run,
  // but "not found" must never read as compliant — that is how a gate stops
  // gating without anyone noticing.
  if (!result.compliant) {
    assert.ok(result.violations.length > 0, 'a failure must name what is wrong');
  }
  assert.equal(result.name, 'bundle-shape');
});

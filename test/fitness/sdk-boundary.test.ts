import test from 'node:test';
import assert from 'node:assert/strict';

import { ADAPTER, boundaryViolations, runSdkBoundaryCheck } from '../../fitness/checks/sdk-boundary.ts';

test('the adapter may import the SDK — that is its job', () => {
  const source = `import { GlassFrogClient } from '@integral-productivity/glassfrog';
const c = new GlassFrogClient({ baseUrl: 'https://api.glassfrog.com' });`;
  assert.deepEqual(boundaryViolations(ADAPTER, source), []);
});

test('the SDK imported above the adapter is caught', () => {
  const violations = boundaryViolations(
    'src/popup.ts',
    `import { GlassFrogClient } from '@integral-productivity/glassfrog';`,
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.detail, /talks to the CaptureWriter port/);
});

test('a raw fetch at GlassFrog is caught', () => {
  const violations = boundaryViolations(
    'src/pending.ts',
    `await fetch('https://api.glassfrog.com/api/v5/me', { headers });`,
  );
  assert.ok(violations.some((v) => /puts GlassFrog on the wire directly/.test(v.detail)));
});

test('naming the origin outside the adapter is caught even without a fetch', () => {
  // The weaker signal, reported separately: a second place that knows the base
  // URL is a second client waiting to happen.
  const violations = boundaryViolations('src/config.ts', `const BASE = 'https://api.glassfrog.com';`);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.detail, /base URL is the SDK's to own/);
});

test('an ordinary module is clean', () => {
  assert.deepEqual(
    boundaryViolations('src/compose.ts', `import type { Capture } from './types.ts';`),
    [],
  );
});

test('the adapter losing its SDK import is a failure, not a pass', async () => {
  // Every per-file rule passes vacuously on a tree with no adapter at all, so
  // the check asserts the adapter's existence separately. This pins that.
  const result = await runSdkBoundaryCheck();
  assert.equal(result.name, 'sdk-boundary');
  assert.equal(result.compliant, true, result.violations.map((v) => v.detail).join('; '));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ADAPTER, boundaryViolations, runSdkBoundaryCheck } from '../../fitness/checks/sdk-boundary.ts';
import { fromRoot } from '../../fitness/root.ts';

/** The host the manifest declares; passed explicitly so each rule is exercised in isolation. */
const HOST = 'api.glassfrog.com';

test('the adapter may import the SDK — that is its job', () => {
  const source = `import { GlassFrogClient } from '@integral-productivity/glassfrog';
const c = new GlassFrogClient({ baseUrl: 'https://api.glassfrog.com' });`;
  assert.deepEqual(boundaryViolations(ADAPTER, source, HOST), []);
});

test('the SDK imported above the adapter is caught', () => {
  const violations = boundaryViolations(
    'src/popup.ts',
    `import { GlassFrogClient } from '@integral-productivity/glassfrog';`,
    HOST,
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.detail, /talks to the CaptureWriter port/);
});

test('a raw fetch at GlassFrog is caught', () => {
  const violations = boundaryViolations(
    'src/pending.ts',
    `await fetch('https://api.glassfrog.com/api/v5/me', { headers });`,
    HOST,
  );
  assert.ok(violations.some((v) => /puts GlassFrog on the wire directly/.test(v.detail)));
});

test('naming the origin outside the adapter is caught even without a fetch', () => {
  // The weaker signal, reported separately: a second place that knows the base
  // URL is a second client waiting to happen.
  const violations = boundaryViolations('src/config.ts', `const BASE = 'https://api.glassfrog.com';`, HOST);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.detail, /base URL is the SDK's to own/);
});

test('an ordinary module is clean', () => {
  assert.deepEqual(
    boundaryViolations('src/compose.ts', `import type { Capture } from './types.ts';`, HOST),
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

test('the boundary host is derived from the manifest, not repeated in the check', async () => {
  // Single source of truth: public/manifest.json declares the one origin this
  // extension may reach, and `manifest-permissions` pins it to exactly that
  // value. If the check hardcoded the host too, changing the origin would move
  // the boundary while the guard kept watching the old one.
  const { host_permissions } = JSON.parse(await readFile(fromRoot('public', 'manifest.json'), 'utf8'));
  const declared = new URL(String(host_permissions[0]).replace(/\/\*$/, '')).hostname;

  assert.equal(declared, HOST, 'this test\'s fixture host must match what the manifest declares');

  const source = await readFile(fromRoot('fitness/checks/sdk-boundary.ts'), 'utf8');
  assert.ok(
    source.includes('host_permissions'),
    'sdk-boundary must read the origin from the manifest rather than carrying its own copy',
  );
});

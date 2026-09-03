import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PUBLISHED_CONTACTS,
  disclosureViolations,
  runAccountDisclosureCheck,
} from '../fitness/checks/account-disclosure.ts';

/**
 * A fitness function for what the public tree says about the accounts this
 * project runs on.
 *
 * On 2026-09-03 the repository went public while a store-registration runbook
 * was still being appended to. The runbook named the owning account, the
 * licence it holds, the unit it sits in, where its mail routes and where its
 * password lives — each addition reasonable on its own, and together a
 * description of one account whose email Google will never let us change.
 * Nothing failed, because nothing was a secret; the leak was the accumulation.
 *
 * The green half alone would rot: a rule that stops matching reports the same
 * green as a tree that is clean. So the red half below feeds the rule the thing
 * it exists to catch, and the allowlist is asserted to be small rather than
 * merely present — an allowlist that quietly grows is how this check would be
 * suppressed rather than removed.
 */
test('an operational company address in the tree is a violation', () => {
  const violations = disclosureViolations(
    'docs/store/example.md',
    'Sign in as `chrome-store@integralproductivity.com` and pay the fee.',
  );

  // Asserted through map/some rather than violations[0]: `noUncheckedIndexedAccess`
  // is on, so indexed access is `T | undefined` and reads only compile behind a
  // narrowing dance that adds nothing to what is being asserted.
  assert.deepEqual(
    violations.map((violation) => violation.where),
    ['docs/store/example.md'],
  );
  assert.ok(
    violations.some((violation) => /operational address on a company domain/.test(violation.detail)),
    'the violation should say what is wrong in terms a reader can act on',
  );
});

test('a published contact address is not a violation', () => {
  assert.deepEqual(
    disclosureViolations('PRIVACY.md', 'Email <kraigparkinson@integralproductivity.com>.'),
    [],
  );
});

test('addresses off the company domains are not this check\'s business', () => {
  assert.deepEqual(
    disclosureViolations('README.md', 'noreply@github.com and someone@example.com'),
    [],
  );
});

test('the allowlist stays small enough to read', () => {
  // Suppression here looks like maintenance: one more row, one more time. The
  // assertion makes growing it a decision someone has to make on purpose.
  assert.ok(
    PUBLISHED_CONTACTS.size <= 3,
    `PUBLISHED_CONTACTS holds ${PUBLISHED_CONTACTS.size} addresses — every row is a company ` +
      'address the project publishes deliberately, so a growing list needs an argument.',
  );
  for (const [address, reason] of PUBLISHED_CONTACTS) {
    assert.ok(reason.length > 20, `${address} is allowlisted without a stated reason`);
  }
});

test('the tree itself is clean', async () => {
  const result = await runAccountDisclosureCheck();
  assert.ok(
    result.compliant,
    `${result.name} failed: ${JSON.stringify(result.violations, null, 2)}`,
  );
  // A rule that stopped matching would also report zero violations, so assert
  // the check actually read the tree rather than an empty list.
  assert.match(result.summary, /^\d+ text file\(s\)/);
  const scanned = Number.parseInt(result.summary, 10);
  assert.ok(scanned > 50, `the check scanned ${scanned} files — too few to have read this repo`);
});

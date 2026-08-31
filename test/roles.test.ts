import test from 'node:test';
import assert from 'node:assert/strict';

import { captureRoleCaveat, circleNotice, displayName, roleOptions } from '../src/roles.ts';
import type { RoleSummary } from '../src/storage.ts';

const ANCHOR = 'role_00000000000000000000000000000000';
const CLIENT_RELATIONS = 'role_11111111111111111111111111111111';
const INTEGRATORS = 'role_22222222222222222222222222222222';
const LEAD_A = 'role_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const LEAD_B = 'role_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ORPHAN_PARENT = 'role_cccccccccccccccccccccccccccccccc';

const circle = (id: string, name: string, parentRoleId: string | null): RoleSummary => ({
  id,
  name,
  hasSubroles: true,
  parentRoleId,
});

const role = (id: string, name: string, parentRoleId: string | null): RoleSummary => ({
  id,
  name,
  hasSubroles: false,
  parentRoleId,
});

const labelFor = (options: ReturnType<typeof roleOptions>, id: string): string =>
  options.find((option) => option.id === id)?.label ?? '';

/* ------------------------------------------- #29: circles and the work type */

/**
 * The governance choice, asserted for all three work types in one place so that
 * removing it fails loudly rather than quietly widening the picker again.
 */
test('#29: circles are selectable for a tension and not for an action or a project', () => {
  const roles = [circle(CLIENT_RELATIONS, 'Client Relations', ANCHOR), role(LEAD_A, 'Designer', CLIENT_RELATIONS)];

  assert.deepEqual(
    roleOptions(roles, 'tension').map((option) => option.selectable),
    [true, true],
    'a tension sensed about a circle is ordinary practice',
  );
  assert.deepEqual(
    roleOptions(roles, 'action').map((option) => option.selectable),
    [false, true],
  );
  assert.deepEqual(
    roleOptions(roles, 'project').map((option) => option.selectable),
    [false, true],
  );
});

test('#29: a circle stays in the list, marked, rather than vanishing from it', () => {
  const options = roleOptions([circle(CLIENT_RELATIONS, 'Client Relations', ANCHOR)], 'project');

  assert.equal(options.length, 1, 'hiding it would read as a broken list');
  assert.match(options[0]?.label ?? '', /\(circle\)$/);
});

/**
 * A list cached before `has_subroles` was read carries no answer. Treating that
 * as "circle" would hide roles a practitioner could file against yesterday.
 */
test('#29: a role list cached before has_subroles was read still offers every role', () => {
  const stale: RoleSummary[] = [{ id: CLIENT_RELATIONS, name: 'Client Relations' }];

  for (const workType of ['tension', 'action', 'project'] as const) {
    assert.equal(roleOptions(stale, workType)[0]?.selectable, true, workType);
  }
});

/* ------------------------------------------------ #30: same-named roles */

test('#30: roles sharing a name are qualified by their parent circle', () => {
  const roles = [
    circle(CLIENT_RELATIONS, 'Client Relations', ANCHOR),
    circle(INTEGRATORS, 'Integrators Community', ANCHOR),
    role(LEAD_A, 'Circle Lead', CLIENT_RELATIONS),
    role(LEAD_B, 'Circle Lead', INTEGRATORS),
  ];
  const options = roleOptions(roles, 'action');

  assert.equal(labelFor(options, LEAD_A), 'Circle Lead — Client Relations');
  assert.equal(labelFor(options, LEAD_B), 'Circle Lead — Integrators Community');
});

test('#30: a role with a unique name renders unqualified', () => {
  const roles = [circle(CLIENT_RELATIONS, 'Client Relations', ANCHOR), role(LEAD_A, 'Designer', CLIENT_RELATIONS)];

  assert.equal(labelFor(roleOptions(roles, 'action'), LEAD_A), 'Designer', 'the common case stays clean');
});

/**
 * A practitioner can fill a sub-role without filling its circle, so the parent
 * is not always in the list. An id fragment is still enough to tell the two
 * apart, which is the whole job — and it costs no second network read.
 */
test('#30: a role whose parent is not in the list still renders distinguishably', () => {
  const roles = [role(LEAD_A, 'Circle Lead', ORPHAN_PARENT), role(LEAD_B, 'Circle Lead', CLIENT_RELATIONS)];
  const options = roleOptions(roles, 'action');

  assert.equal(labelFor(options, LEAD_A), 'Circle Lead — parent cccccccc');
  assert.notEqual(labelFor(options, LEAD_A), labelFor(options, LEAD_B));
});

test('#30: a same-named role with no parent at all falls back to its own id fragment', () => {
  const roles = [role(LEAD_A, 'Circle Lead', null), role(LEAD_B, 'Circle Lead', CLIENT_RELATIONS)];
  const options = roleOptions(roles, 'action');

  assert.equal(labelFor(options, LEAD_A), 'Circle Lead (aaaaaaaa)');
  assert.notEqual(labelFor(options, LEAD_A), labelFor(options, LEAD_B));
});

test('#30: a null role name keeps the existing id-fragment style', () => {
  assert.equal(displayName(null, LEAD_A), 'Untitled role (aaaaaaaa)');
  assert.equal(displayName('   ', LEAD_A), 'Untitled role (aaaaaaaa)');
  assert.equal(displayName('Designer', LEAD_A), 'Designer');
});

test('#30: qualification and the circle marker compose rather than displace each other', () => {
  const roles = [
    circle(CLIENT_RELATIONS, 'Circle Lead', ANCHOR),
    role(LEAD_A, 'Circle Lead', INTEGRATORS),
  ];

  assert.equal(labelFor(roleOptions(roles, 'project'), CLIENT_RELATIONS), 'Circle Lead — parent 00000000 (circle)');
});

/* ------------------------------------------------- telling the practitioner */

test('a circle chosen for an action is reported, not silently swapped', () => {
  const roles = [circle(CLIENT_RELATIONS, 'Client Relations', ANCHOR), role(LEAD_A, 'Designer', CLIENT_RELATIONS)];

  assert.equal(circleNotice(roles, 'tension', CLIENT_RELATIONS), '', 'nothing to say when circles are fine');
  assert.match(circleNotice(roles, 'action', CLIENT_RELATIONS), /Client Relations is a circle/);
  assert.doesNotMatch(circleNotice(roles, 'action', LEAD_A), /no longer selected/);
  assert.match(
    circleNotice(roles, 'action', LEAD_A),
    /Circles are not offered for actions and projects/,
    'the reason is stated whether or not a selection was dropped',
  );
});

test('a capture role that is a circle is called out when it is saved', () => {
  const roles = [circle(CLIENT_RELATIONS, 'Client Relations', ANCHOR), role(LEAD_A, 'Designer', CLIENT_RELATIONS)];

  assert.match(captureRoleCaveat(roles, CLIENT_RELATIONS), /Client Relations is a circle/);
  assert.equal(captureRoleCaveat(roles, LEAD_A), '');
  assert.equal(captureRoleCaveat(roles, 'role_unknown'), '');
});

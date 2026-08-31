import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createClient, createWriter, fetchRolesForKey } from '../src/glassfrog.ts';

/**
 * The only test that exercises what this extension actually puts on the wire.
 *
 * Everywhere else the capture path is driven through the CaptureWriter port
 * against a fake, which is what makes it testable — and is also exactly why a
 * wrong belief about the real API survived all of it. The `label`-on-create
 * defect was invisible to every other test in this suite.
 *
 * A real GlassFrogClient is pointed at a local server, so the SDK builds the
 * request, sets the headers, and parses the response for real. No credential is
 * involved: the key is a literal, and it never leaves this process.
 */

const ROLE = 'role_0123456789abcdef0123456789abcdef';
const KEY = 'test-key-not-a-real-credential';

interface Recorded {
  method: string;
  url: string;
  headers: NodeJS.Dict<string | string[]>;
  body: unknown;
}

async function withServer(
  handler: (recorded: Recorded) => { status?: number; json: unknown },
): Promise<{ baseUrl: string; calls: Recorded[]; close: () => Promise<void> }> {
  const calls: Recorded[] = [];
  const server: Server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const recorded: Recorded = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: raw ? JSON.parse(raw) : undefined,
      };
      calls.push(recorded);
      const { status = 200, json } = handler(recorded);
      const payload = JSON.stringify(json);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(payload);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test('a tension is POSTed to the role-scoped path, and carries no label', async (t) => {
  const server = await withServer(() => ({
    status: 201,
    json: { data: { id: 'ten_aaaabbbbccccddddeeeeffff00001111', type: 'tension', status: 'unprocessed' } },
  }));
  t.after(() => server.close());

  const writer = createWriter(createClient(KEY, { baseUrl: server.baseUrl }));
  const created = await writer.createTension(ROLE, { body: '[glassfrog-clipper] A page\n\nhttps://example.test/' });

  assert.equal(created.id, 'ten_aaaabbbbccccddddeeeeffff00001111', 'the response envelope is unwrapped');

  const call = server.calls[0];
  assert.equal(call?.method, 'POST');
  assert.equal(call?.url, `/roles/${ROLE}/tensions`, 'role is a path parameter (ADR 0003)');

  const tension = (call?.body as { tension?: Record<string, unknown> })?.tension;
  assert.ok(tension, 'the SDK wraps the input in a `tension` envelope');
  assert.deepEqual(
    Object.keys(tension).sort(),
    ['body'],
    'no label and no status: the API rejects the first on create and derives the second',
  );
});

test('R12: the key travels in X-Auth-Token and nowhere else', async (t) => {
  const server = await withServer(() => ({ status: 201, json: { data: { id: 'ten_1', type: 'tension' } } }));
  t.after(() => server.close());

  const writer = createWriter(createClient(KEY, { baseUrl: server.baseUrl }));
  await writer.createTension(ROLE, { body: 'x' });

  const call = server.calls[0];
  assert.equal(call?.headers['x-auth-token'], KEY, 'v5 has no OAuth — the key is a header');
  assert.equal(call?.url.includes(KEY), false, 'and never a query parameter');
  assert.equal(JSON.stringify(call?.body).includes(KEY), false, 'nor part of the payload');
});

test('an action POSTs to its own path and carries the configured status', async (t) => {
  const server = await withServer(() => ({ status: 201, json: { data: { id: 'act_1', type: 'action' } } }));
  t.after(() => server.close());

  const writer = createWriter(createClient(KEY, { baseUrl: server.baseUrl }));
  await writer.createAction(ROLE, { description: '[glassfrog-clipper] A page', note: 'evidence', status: 'someday' });

  const call = server.calls[0];
  assert.equal(call?.url, `/roles/${ROLE}/actions`);
  const item = (call?.body as { action_item?: Record<string, unknown> })?.action_item;
  assert.equal(item?.status, 'someday', 'R6 / KD3 reaches the wire');
  assert.equal(item?.description, '[glassfrog-clipper] A page');
});

test('a project POSTs to its own path', async (t) => {
  const server = await withServer(() => ({ status: 201, json: { data: { id: 'prj_1', type: 'project' } } }));
  t.after(() => server.close());

  const writer = createWriter(createClient(KEY, { baseUrl: server.baseUrl }));
  await writer.createProject(ROLE, {
    description: 'd',
    note: 'n',
    status: 'current',
    link: 'https://example.test/some/page',
  });

  const project = (server.calls[0]?.body as { project?: Record<string, unknown> })?.project;
  assert.equal(server.calls[0]?.url, `/roles/${ROLE}/projects`);
  assert.equal(project?.status, 'current');
  assert.equal(project?.description, 'd');
  // The whole point of #28: `link` reaches the wire, not just the note. Only a
  // wire-level assertion can prove it — the port would happily carry a field the
  // adapter then dropped.
  assert.equal(project?.link, 'https://example.test/some/page');
});

test('a project filed from a page with no URL sends no link key at all', async (t) => {
  const server = await withServer(() => ({ status: 201, json: { data: { id: 'prj_1', type: 'project' } } }));
  t.after(() => server.close());

  const writer = createWriter(createClient(KEY, { baseUrl: server.baseUrl }));
  await writer.createProject(ROLE, { description: 'd', note: 'n', status: 'current' });

  const project = (server.calls[0]?.body as { project?: Record<string, unknown> })?.project;
  assert.equal('link' in (project ?? {}), false, 'the SDK input has no null to mean "clear"');
});

/**
 * KTD7 turns on this being true. The SDK's 429 backoff is a plain timer with no
 * in-flight request keeping the worker alive, so Chrome can kill the worker
 * mid-backoff and lose the capture. Until now that was an unverified claim about
 * a constructor argument.
 */
test('KTD7: a 429 is not retried — exactly one request leaves the extension', async (t) => {
  const server = await withServer(() => ({ status: 429, json: { message: 'slow down' } }));
  t.after(() => server.close());

  const writer = createWriter(createClient(KEY, { baseUrl: server.baseUrl }));

  await assert.rejects(() => writer.createTension(ROLE, { body: 'x' }));
  assert.equal(server.calls.length, 1, 'maxRetries: 0 means one attempt, not four');
});

test('a rejected request surfaces a status the classifier can use', async (t) => {
  const server = await withServer(() => ({ status: 403, json: { message: 'forbidden' } }));
  t.after(() => server.close());

  const writer = createWriter(createClient(KEY, { baseUrl: server.baseUrl }));

  await assert.rejects(
    () => writer.createTension(ROLE, { body: 'x' }),
    (error: unknown) => {
      // KTD9 branches on `status`; if the SDK stopped carrying it, every failure
      // would collapse into "unknown" and R18's reconfigure path would vanish.
      assert.equal((error as { status?: number }).status, 403);
      return true;
    },
  );
});

test('a malformed role id is rejected before any request leaves', async (t) => {
  const server = await withServer(() => ({ status: 201, json: { data: { id: 'ten_1' } } }));
  t.after(() => server.close());

  const writer = createWriter(createClient(KEY, { baseUrl: server.baseUrl }));

  await assert.rejects(
    () => writer.createTension('not-a-role-id', { body: 'x' }),
    (error: unknown) => {
      // KTD9's first class: a TypeError from id validation, never a network hop.
      assert.equal((error as Error).name, 'TypeError');
      return true;
    },
  );
  assert.equal(server.calls.length, 0, 'nothing reached the network');
});

const ROLE_A = { id: 'role_0123456789abcdef0123456789abcdef', name: 'Platform Engineering' };
const ROLE_B = { id: 'role_fedcba9876543210fedcba9876543210', name: null };

const rolesPage = (roles: unknown[]) => ({
  data: roles,
  meta: { pagination: { per_page: 100, has_next_page: false } },
});

/**
 * The regression from the first real install. `me.get()` is the one
 * single-resource read in the SDK that does not go through `fetchOne`, so it
 * never unwraps the `data` envelope the API actually returns — while its
 * declared type claims otherwise. Reading `roles` straight off it yielded
 * undefined for an account filling dozens of roles, and the options page then
 * told the practitioner their account fills none.
 */
test('KTD8: roles are read when /me arrives inside a data envelope', async (t) => {
  const server = await withServer(() => ({
    status: 200,
    json: { data: { actor: {}, organization: {}, membership: {}, roles: [ROLE_A, ROLE_B] } },
  }));
  t.after(() => server.close());

  const roles = await fetchRolesForKey(KEY, { baseUrl: server.baseUrl });

  assert.equal(server.calls.length, 1, 'the embed answered, so no fallback was needed');
  assert.match(server.calls[0]?.url ?? '', /^\/me\?/);
  assert.match(server.calls[0]?.url ?? '', /include=roles/);
  assert.equal(roles[0]?.name, 'Platform Engineering');
  assert.match(roles[1]?.name ?? '', /^Untitled role \(/, 'a null name stays pickable');
});

test('KTD8: roles are read when /me returns them bare', async (t) => {
  // The shape A4 documents for the pinned ^0.6.0. Both must work: the SDK may
  // fix its own inconsistency, and 0.7.0 changes the envelope again.
  const server = await withServer(() => ({
    status: 200,
    json: { actor: {}, organization: {}, membership: {}, roles: [ROLE_A] },
  }));
  t.after(() => server.close());

  assert.deepEqual(await fetchRolesForKey(KEY, { baseUrl: server.baseUrl }), [
    { id: ROLE_A.id, name: 'Platform Engineering' },
  ]);
});

test('an empty embed falls back to /me/roles rather than concluding the account has none', async (t) => {
  const server = await withServer((recorded) =>
    recorded.url.startsWith('/me/roles')
      ? { status: 200, json: rolesPage([ROLE_A]) }
      : { status: 200, json: { data: { actor: {}, organization: {}, membership: {} } } },
  );
  t.after(() => server.close());

  const roles = await fetchRolesForKey(KEY, { baseUrl: server.baseUrl });

  assert.deepEqual(
    server.calls.map((c) => c.url.split('?')[0]),
    ['/me', '/me/roles'],
    'an absent embed means we did not read the roles, not that there are none',
  );
  assert.equal(roles.length, 1);
  assert.equal(roles[0]?.name, 'Platform Engineering');
});

test('R21: only an empty /me AND an empty /me/roles reports no roles', async (t) => {
  const server = await withServer((recorded) =>
    recorded.url.startsWith('/me/roles')
      ? { status: 200, json: rolesPage([]) }
      : { status: 200, json: { data: { actor: {}, organization: {}, membership: {}, roles: [] } } },
  );
  t.after(() => server.close());

  assert.deepEqual(await fetchRolesForKey(KEY, { baseUrl: server.baseUrl }), []);
  assert.equal(server.calls.length, 2, 'both reads were attempted before reporting none');
});

/**
 * #29 and #30 both turn on fields the mapper used to drop. This asserts against
 * a real response body rather than a hand-built RoleSummary, because the defect
 * was never in the picker — it was that `has_subroles` and `parent_role_id`
 * never survived the wire in the first place.
 */
test('a role carries its circle-ness and its parent through the mapping', async (t) => {
  const server = await withServer(() => ({
    status: 200,
    json: {
      data: {
        actor: {},
        organization: {},
        membership: {},
        roles: [
          { ...ROLE_A, has_subroles: true, parent_role_id: null },
          { ...ROLE_B, has_subroles: false, parent_role_id: ROLE_A.id },
        ],
      },
    },
  }));
  t.after(() => server.close());

  const roles = await fetchRolesForKey(KEY, { baseUrl: server.baseUrl });

  assert.equal(roles[0]?.hasSubroles, true);
  assert.equal(roles[0]?.parentRoleId, null, 'the anchor role has no parent, and null says so');
  assert.equal(roles[1]?.hasSubroles, false);
  assert.equal(roles[1]?.parentRoleId, ROLE_A.id);
});

/**
 * Absent must stay distinguishable from false. A payload without the fields
 * means we did not read them, not that the role is a non-circle orphan — and
 * the picker declines to hide a role on the strength of what it did not read.
 */
test('a payload missing the two fields yields a summary missing them too', async (t) => {
  const server = await withServer(() => ({
    status: 200,
    json: { data: { actor: {}, organization: {}, membership: {}, roles: [ROLE_A] } },
  }));
  t.after(() => server.close());

  assert.deepEqual(await fetchRolesForKey(KEY, { baseUrl: server.baseUrl }), [
    { id: ROLE_A.id, name: 'Platform Engineering' },
  ]);
});

test('a malformed roles payload is ignored rather than crashing the options page', async (t) => {
  const server = await withServer((recorded) =>
    recorded.url.startsWith('/me/roles')
      ? { status: 200, json: rolesPage(['not-a-role', { name: 'no id' }, ROLE_A]) }
      : { status: 200, json: { data: { actor: {}, roles: 'not-an-array' } } },
  );
  t.after(() => server.close());

  assert.deepEqual(await fetchRolesForKey(KEY, { baseUrl: server.baseUrl }), [
    { id: ROLE_A.id, name: 'Platform Engineering' },
  ]);
});

test('the client is given a bound fetch, or nothing reaches the network in a browser', async (t) => {
  const server = await withServer(() => ({ status: 201, json: { data: { id: 'ten_1', type: 'tension' } } }));
  t.after(() => server.close());

  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  // Stand in for the browser's receiver check.
  const strict = function (this: unknown, ...args: Parameters<typeof fetch>) {
    if (this !== globalThis && this !== undefined) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return realFetch(...args);
  } as unknown as typeof fetch;
  globalThis.fetch = strict;

  const writer = createWriter(createClient(KEY, { baseUrl: server.baseUrl }));

  await writer.createTension(ROLE, { body: 'x' });

  assert.equal(server.calls.length, 1, 'the request went out rather than dying as a network error');
});

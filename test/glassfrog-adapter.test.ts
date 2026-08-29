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
  await writer.createProject(ROLE, { description: 'd', note: 'n', status: 'current' });

  assert.equal(server.calls[0]?.url, `/roles/${ROLE}/projects`);
  assert.equal((server.calls[0]?.body as { project?: { status?: string } })?.project?.status, 'current');
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

test('KTD8: the key probe asks for roles in one call and maps them for the picker', async (t) => {
  const server = await withServer(() => ({
    status: 200,
    json: {
      actor: { id: 'per_1', name: 'Someone' },
      organization: { id: 'org_1', name: 'Org' },
      membership: { id: 'mem_1' },
      roles: [
        { id: 'role_0123456789abcdef0123456789abcdef', name: 'Platform Engineering' },
        { id: 'role_fedcba9876543210fedcba9876543210', name: null },
      ],
    },
  }));
  t.after(() => server.close());

  const roles = await fetchRolesForKey(KEY, { baseUrl: server.baseUrl });

  const call = server.calls[0];
  assert.equal(call?.method, 'GET');
  assert.match(call?.url ?? '', /^\/me\?/, 'one call proves the key and supplies the picker');
  assert.match(call?.url ?? '', /include=roles/);

  assert.equal(roles[0]?.name, 'Platform Engineering');
  assert.match(
    roles[1]?.name ?? '',
    /^Untitled role \(/,
    'a null name becomes something pickable rather than a blank option',
  );
});

test('A4: roles are read from the bare response, not a data envelope', async (t) => {
  // origin/main wraps me.get() in { data } for 0.7.0. Against the pinned ^0.6.0
  // the roles sit at the top level; reading result.data.roles would silently
  // yield an empty picker and look like "this account fills no roles".
  const server = await withServer(() => ({
    status: 200,
    json: { actor: {}, organization: {}, membership: {}, roles: [{ id: 'role_'.padEnd(37, 'a'), name: 'R' }] },
  }));
  t.after(() => server.close());

  const roles = await fetchRolesForKey(KEY, { baseUrl: server.baseUrl });
  assert.equal(roles.length, 1);
});

/**
 * Regression guard for a bug that only manifests in a browser.
 *
 * The SDK keeps `options.fetch ?? globalThis.fetch` and later invokes it as
 * `this.fetchImpl(...)`, so an unbound global arrives with `this` set to the
 * client instance. Browsers require fetch's receiver to be the global scope and
 * throw "Illegal invocation"; Node's undici does not care. The result was a bug
 * invisible to every Node test while breaking every single capture in Chrome.
 *
 * This test makes Node behave the way a browser does.
 */
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

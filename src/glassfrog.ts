import { GlassFrogClient } from '@integral-productivity/glassfrog';

import type { CaptureWriter, CreatedItem } from './capture.ts';
import { displayName } from './roles.ts';
import { type RoleSummary, getApiKey } from './storage.ts';

/**
 * The SDK-backed implementation of the CaptureWriter port.
 *
 * Everything above this file talks to the port, which is what lets the capture
 * path be tested without a network and without resolving the SDK at all. This
 * module is the only place that knows GlassFrog's method names.
 *
 * v5 has no OAuth — the key travels as `X-Auth-Token`. See docs/adr/0002 for
 * why the key is held locally rather than brokered.
 */

/**
 * KTD7: the SDK's 429 backoff is a plain timer with no in-flight request to
 * keep the worker alive, so Chrome can kill the worker mid-backoff and lose the
 * capture. Zero retries makes every failure immediate, visible, and the
 * practitioner's to resolve.
 */
const MAX_RETRIES = 0;

/**
 * `baseUrl` exists so the adapter can be driven against a local server in
 * tests. It is the only way to verify what this extension actually puts on the
 * wire — the request path, the absence of `label`, and that maxRetries: 0 really
 * does mean one attempt — none of which a fake client can prove.
 */
export function createClient(apiKey: string, options: { baseUrl?: string } = {}): GlassFrogClient {
  return new GlassFrogClient({
    apiKey,
    maxRetries: MAX_RETRIES,
    // The SDK stores `options.fetch ?? globalThis.fetch` and later calls it as
    // `this.fetchImpl(...)`, so an unbound global arrives with `this` set to the
    // client. Browsers require fetch's receiver to be the global scope and throw
    // "Illegal invocation"; Node's undici does not care, so this fails ONLY in
    // the one environment the extension actually runs in. Verified in Chrome:
    // without the bind, every request dies as a network error and the
    // practitioner is told they are offline forever.
    fetch: globalThis.fetch.bind(globalThis),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });
}

export async function getClient(): Promise<GlassFrogClient> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('No GlassFrog API key configured. Open the extension options to add one.');
  }
  return createClient(apiKey);
}

/**
 * Adapts the SDK's three role-scoped creates to the port. Each is
 * `POST /roles/{role_id}/...` — the role is a path parameter, which is the
 * whole reason a capture cannot reach the API without one (ADR 0003).
 */
export function createWriter(client: GlassFrogClient): CaptureWriter {
  return {
    async createTension(roleId, input): Promise<CreatedItem> {
      // Neither `status` nor `label` is sent. v5 auto-computes
      // unprocessed/processed from associations, and rejects `label` on create
      // despite the generated types listing it — both verified against the
      // live API. The provenance marker rides at the head of the body instead.
      const tension = await client.tensions.createForRole(roleId, { body: input.body });
      return { id: tension.id };
    },
    async createAction(roleId, input): Promise<CreatedItem> {
      const action = await client.actions.createForRole(roleId, {
        description: input.description,
        note: input.note,
        status: input.status,
      });
      return { id: action.id };
    },
    async createProject(roleId, input): Promise<CreatedItem> {
      const project = await client.projects.createForRole(roleId, {
        description: input.description,
        note: input.note,
        status: input.status,
      });
      return { id: project.id };
    },
  };
}

export async function getWriter(): Promise<CaptureWriter> {
  return createWriter(await getClient());
}

/**
 * KTD8: prove the key and populate the role picker.
 *
 * Role ids are opaque 32-hex values a practitioner cannot obtain from the
 * GlassFrog UI, so without this the picker cannot exist and R8 is unsatisfiable.
 *
 * Two reads, because one is not reliable:
 *
 * 1. `GET /me?include=roles`, the single call KTD8 describes.
 * 2. `GET /me/roles` when that embed comes back empty.
 *
 * The fallback is not defensive padding. `me.get()` is the one single-resource
 * read in the SDK that does NOT go through `fetchOne`, so it never unwraps the
 * `data` envelope the API actually returns — its declared `MeResponse` type is
 * a lie about its runtime shape. Reading `roles` off it yields undefined even
 * for an account filling dozens of roles. `unwrapBody` handles that (and the
 * bare shape, and the 0.7.0 envelope A4 warns about), but an empty embed still
 * cannot be trusted to mean "this account has no roles" — only that we did not
 * read any. `/me/roles` goes through `fetchPage`, which unwraps correctly.
 */
export async function fetchRolesForKey(
  apiKey: string,
  options: { baseUrl?: string } = {},
): Promise<RoleSummary[]> {
  const client = createClient(apiKey, options);

  const embedded = toRoleSummaries(unwrapBody(await client.me.get({ include: ['roles'] })).roles);
  if (embedded.length > 0) return embedded;

  const page = await client.me.listRoles({ perPage: 100 });
  return toRoleSummaries(page.items);
}

/**
 * Returns the response body whether or not it arrived inside a `data` envelope.
 *
 * The API envelopes single resources; the SDK unwraps that everywhere except
 * `me.get()`. Handling both shapes here means this keeps working when the SDK
 * fixes its own inconsistency, and against the 0.7.0 envelope change too.
 */
function unwrapBody(payload: unknown): { roles?: unknown } {
  if (typeof payload !== 'object' || payload === null) return {};
  const enveloped = (payload as { data?: unknown }).data;
  const body = typeof enveloped === 'object' && enveloped !== null ? enveloped : payload;
  return body as { roles?: unknown };
}

/**
 * `has_subroles` and `parent_role_id` are on the `Role` payload both reads
 * return — they were simply dropped here. Each is spread only when the payload
 * actually carried it, so a response missing one yields a summary missing it
 * too: "we did not read this" stays distinguishable from "false" and "no
 * parent", and the picker can decline to act on what it does not know.
 */
function toRoleSummaries(roles: unknown): RoleSummary[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .filter(
      (
        role,
      ): role is {
        id: string;
        name?: string | null;
        has_subroles?: unknown;
        parent_role_id?: unknown;
      } =>
        typeof role === 'object' && role !== null && typeof (role as { id?: unknown }).id === 'string',
    )
    .map((role) => ({
      id: role.id,
      name: displayName(role.name, role.id),
      ...(typeof role.has_subroles === 'boolean' ? { hasSubroles: role.has_subroles } : {}),
      ...(typeof role.parent_role_id === 'string' || role.parent_role_id === null
        ? { parentRoleId: role.parent_role_id }
        : {}),
    }));
}

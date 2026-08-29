import { GlassFrogClient } from '@integral-productivity/glassfrog';

import type { CaptureWriter, CreatedItem } from './capture.ts';
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
 * KTD8: one call proves the key and supplies the role picker's options.
 *
 * `GET /me?include=roles` is the same probe glassfrog-mcp-server uses at
 * api/oauth/authorize.ts. Role ids are opaque 32-hex values a practitioner
 * cannot obtain from the GlassFrog UI, so without this the picker cannot exist
 * and R8 is unsatisfiable.
 *
 * A4: against the pinned ^0.6.0 the roles sit on the bare response. origin/main
 * carries an unreleased BREAKING change wrapping this in a `data` envelope for
 * 0.7.0 — reading `result.data.roles` here would break against the pin.
 */
export async function fetchRolesForKey(
  apiKey: string,
  options: { baseUrl?: string } = {},
): Promise<RoleSummary[]> {
  const me = await createClient(apiKey, options).me.get({ include: ['roles'] });
  const roles = me.roles ?? [];
  return roles.map((role) => ({ id: role.id, name: displayName(role.name, role.id) }));
}

/**
 * A role's name is nullable in the v5 schema. An unnamed role would otherwise
 * render as a blank option the practitioner cannot tell apart from another one
 * — and since role ids are opaque hex, there would be nothing else to go on.
 * The id fragment keeps two unnamed roles distinguishable.
 */
function displayName(name: string | null | undefined, id: string): string {
  const trimmed = name?.trim();
  return trimmed || `Untitled role (${id.replace(/^role_/, '').slice(0, 8)})`;
}

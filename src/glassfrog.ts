import { GlassFrogClient } from '@integral-productivity/glassfrog';

import { getApiKey } from './storage.ts';

/**
 * Builds a client from the v5 API key the practitioner stored in extension
 * options. GlassFrog v5 has no OAuth — the key is sent as `X-Auth-Token`.
 * See docs/adr/0002 for why we hold the key locally rather than brokering it.
 *
 * The key is read through `src/storage.ts` rather than a local key constant:
 * U2 owns every storage key so there is one place to change when the shape of
 * configuration changes.
 */
export async function getClient(): Promise<GlassFrogClient> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('No GlassFrog API key configured. Open the extension options to add one.');
  }
  return new GlassFrogClient({ apiKey });
}

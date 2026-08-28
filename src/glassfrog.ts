import { GlassFrogClient } from '@integral-productivity/glassfrog';

const API_KEY_STORAGE_KEY = 'glassfrog.apiKey';

/**
 * Builds a client from the v5 API key the practitioner stored in extension
 * options. GlassFrog v5 has no OAuth — the key is sent as `X-Auth-Token`.
 * See docs/adr/0002 for why we hold the key locally rather than brokering it.
 */
export async function getClient(): Promise<GlassFrogClient> {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  const apiKey = stored[API_KEY_STORAGE_KEY] as string | undefined;
  if (!apiKey) {
    throw new Error('No GlassFrog API key configured. Open the extension options to add one.');
  }
  return new GlassFrogClient({ apiKey });
}

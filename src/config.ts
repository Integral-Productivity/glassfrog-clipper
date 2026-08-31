/**
 * The configuration decision, separated from the page that renders it.
 *
 * This lives apart from src/options.ts for the same reason the CaptureWriter
 * port lives apart from src/glassfrog.ts: the options page must statically
 * import the SDK adapter, and anything importing that cannot be exercised
 * without resolving the SDK. Keeping the decision here keeps R21's three
 * failure paths testable.
 */
import { classifyFailure } from './errors.ts';
import type { RoleSummary } from './storage.ts';

export type ConfigurationAttempt =
  | { ok: true; roles: RoleSummary[] }
  | { ok: false; reason: ConfigurationFailureReason; message: string };

export type ConfigurationFailureReason = 'missing-key' | 'rejected-key' | 'no-roles' | 'unreachable';

/**
 * Validates a key and resolves the roles it can file against (KTD8: one call
 * proves the key and supplies the picker).
 *
 * R21 requires that an attempt which cannot complete says so plainly rather
 * than leaving the practitioner on an empty form — so the ways it can fail are
 * distinct outcomes here, not one falsy return.
 */
export async function attemptConfiguration(
  fetchRoles: (apiKey: string) => Promise<RoleSummary[]>,
  apiKey: string,
): Promise<ConfigurationAttempt> {
  const key = apiKey.trim();
  if (!key) {
    return { ok: false, reason: 'missing-key', message: 'Enter your GlassFrog API key to continue.' };
  }

  let roles: RoleSummary[];
  try {
    roles = await fetchRoles(key);
  } catch (error) {
    const failure = classifyFailure(error, { apiKey: key });
    return failure.reconfigure
      ? {
          ok: false,
          reason: 'rejected-key',
          message: "That key wasn't accepted by GlassFrog. Check it and try again.",
        }
      : {
          ok: false,
          reason: 'unreachable',
          // Deliberately not `failure.message`: the classifier writes for the
          // capture path ("your capture is saved"), and there is no capture
          // here. Interpolating it produced a doubled, false sentence.
          message: 'Could not reach GlassFrog just now. Check your connection and try again.',
        };
  }

  if (roles.length === 0) {
    // Deliberately describes what was observed rather than asserting a fact
    // about the practitioner's org. The first real install hit this message on
    // an account filling dozens of roles, because the SDK's me.get() does not
    // unwrap the API's `data` envelope — the reader was broken, not the account.
    // A5's genuine case (no primary, non-discarded assignment) is real, but it
    // is not the only way to get here, and telling someone to go ask their Lead
    // Link for a role they already hold sends them somewhere useless.
    return {
      ok: false,
      reason: 'no-roles',
      message:
        'That key works, but GlassFrog returned no roles to file against. If you do fill roles, the key may belong to a different account.',
    };
  }

  return { ok: true, roles };
}

/** A held capture, described so the practitioner recognises it. */
export function describePending(title: string, url: string): string {
  return title.trim() || url.trim() || 'an untitled page';
}

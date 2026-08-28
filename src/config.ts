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
      : { ok: false, reason: 'unreachable', message: `Could not reach GlassFrog: ${failure.message}` };
  }

  if (roles.length === 0) {
    // A5: /me/roles returns only primary, non-discarded assignments. An account
    // without one cannot satisfy R8 at all, and an empty dropdown would read as
    // a loading bug rather than an account problem.
    return {
      ok: false,
      reason: 'no-roles',
      message:
        'That key works, but the account fills no roles, so there is nothing to file against. Ask your Lead Link for a role assignment.',
    };
  }

  return { ok: true, roles };
}

/** A held capture, described so the practitioner recognises it. */
export function describePending(title: string, url: string): string {
  return title.trim() || url.trim() || 'an untitled page';
}

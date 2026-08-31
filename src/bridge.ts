/**
 * Keeping the extension's configuration and the app's in step.
 *
 * Safari gives a web extension its own `chrome.storage.local`, inside the
 * extension's sandbox. The containing app and the Share Extension cannot read
 * it, and it cannot read theirs. Left alone, that means a practitioner who
 * configured "the clipper" once has configured it once — and the share sheet,
 * which is the whole point of the Apple build, still has no API key.
 *
 * The sync is deliberately **one-way at configuration time**, in both
 * directions, and never on the capture path:
 *
 *   - `publishConfiguration` runs when the practitioner saves in the options
 *     page, pushing what they entered to the app.
 *   - `adoptConfigurationFromApp` runs once at worker startup, and only when
 *     the extension has none, so configuration entered in the app flows back.
 *
 * A read-through would be the obvious alternative and is the wrong one. Every
 * capture would pay a process launch to learn its own role id, on the one path
 * STRATEGY.md protects above all others, and would fail outright whenever the
 * app was unavailable. Two stores that agree beats one store that is slow.
 *
 * On Chrome none of this runs at all: `sendNative` reports no bridge and every
 * function here returns without doing anything.
 */
import { sendNative } from './platform.ts';
import {
  type DefaultStatus,
  type RoleSummary,
  getApiKey,
  getCaptureRoleId,
  getDefaultStatus,
  getRoles,
  isConfigured,
  setApiKey,
  setCaptureRoleId,
  setDefaultStatus,
  setRoles,
} from './storage.ts';

interface WireConfiguration {
  apiKey?: string;
  captureRoleId?: string;
  defaultStatus?: string;
  roles?: Array<{ id?: unknown; name?: unknown }>;
}

/**
 * Pushes the current configuration to the containing app.
 *
 * Reads back out of storage rather than taking the form's values as an
 * argument: what the app should hold is what the extension actually saved, and
 * the two have diverged before — the options page's save is two-phase, so a
 * valid key with no role yet is a real state that must cross the bridge exactly
 * as it is rather than as the form momentarily displayed it.
 */
export async function publishConfiguration(): Promise<boolean> {
  const [apiKey, captureRoleId, defaultStatus, roles] = await Promise.all([
    getApiKey(),
    getCaptureRoleId(),
    getDefaultStatus(),
    getRoles(),
  ]);

  const reply = await sendNative<{ delivered?: boolean }>({
    kind: 'configure',
    apiKey: apiKey ?? '',
    captureRoleId: captureRoleId ?? '',
    defaultStatus,
    roles,
  });

  return reply?.delivered === true;
}

/**
 * Asks the containing app for configuration, and adopts it if the extension has
 * none of its own.
 *
 * Guarded on being unconfigured rather than run unconditionally: the app's copy
 * is a mirror, not a source of truth, and letting it overwrite a key the
 * practitioner just entered in the options page would make the two stores fight
 * — with the capture role, the one setting that decides where every future
 * capture lands, as the thing they fight over.
 */
export async function adoptConfigurationFromApp(): Promise<boolean> {
  if (await isConfigured()) return false;

  const reply = await sendNative<{ delivered?: boolean; configuration?: WireConfiguration }>({
    kind: 'request-configuration',
  });
  if (reply?.delivered !== true || !reply.configuration) return false;

  return applyConfiguration(reply.configuration);
}

/**
 * Writes a configuration received from the app, refusing a partial one.
 *
 * Exported for its own sake so the decision is testable without a bridge. The
 * all-or-nothing rule matters: half a configuration leaves the extension in the
 * two-phase state R21 describes, having *silently* moved it there, so the
 * practitioner sees a key they never entered and a role picker they never used.
 */
export async function applyConfiguration(configuration: WireConfiguration): Promise<boolean> {
  const apiKey = (configuration.apiKey ?? '').trim();
  const captureRoleId = (configuration.captureRoleId ?? '').trim();
  if (!apiKey || !captureRoleId) return false;

  await setApiKey(apiKey);
  await setRoles(toRoleSummaries(configuration.roles));
  await setDefaultStatus(configuration.defaultStatus === 'someday' ? 'someday' : ('current' satisfies DefaultStatus));
  // Written last. `onConfigurationChanged` fires on either key, and the capture
  // role is what makes the state complete — setting it first would wake the
  // held-capture path against a configuration still missing its key.
  await setCaptureRoleId(captureRoleId);
  return true;
}

/** The same nullable-name handling the SDK path does — an id is not a name. */
function toRoleSummaries(roles: WireConfiguration['roles']): RoleSummary[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .filter((role): role is { id: string; name?: unknown } => typeof role?.id === 'string')
    .map((role) => ({
      id: role.id,
      name:
        typeof role.name === 'string' && role.name.trim()
          ? role.name.trim()
          : `Untitled role (${role.id.replace(/^role_/, '').slice(0, 8)})`,
    }));
}

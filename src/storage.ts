/**
 * The one module that owns extension storage.
 *
 * U2's Definition of Done is that no file outside this one references a raw
 * storage key. Every other unit reads and writes through the helpers here, so
 * there is exactly one place that knows the pending slot is a single key, one
 * place that knows the expiry, and one place that classifies configuration.
 *
 * Implements KTD3 (single overwritten pending slot with a 7-day expiry).
 * Serves R8, R9, R15, R16, R20.
 */
import type { Capture, WorkType } from './types.ts';

/**
 * Every key the extension writes. Deliberately exported as a frozen record so a
 * test can assert the set, and so a future unit adding a key has to come here.
 */
export const STORAGE_KEYS = {
  apiKey: 'glassfrog.apiKey',
  captureRoleId: 'glassfrog.captureRoleId',
  roles: 'glassfrog.roles',
  defaultStatus: 'glassfrog.defaultStatus',
  pendingCapture: 'clipper.pendingCapture',
  popupDraft: 'clipper.popupDraft',
  lastNotice: 'clipper.lastNotice',
} as const;

/**
 * In-flight markers are keyed per capture id rather than living in one slot:
 * KTD7 requires that two overlapping captures cannot clear each other's record.
 */
export const IN_FLIGHT_KEY_PREFIX = 'clipper.inFlight.';

/** KTD3: long enough to leave GlassFrog to fetch an API key and come back. */
export const PENDING_CAPTURE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** KD3 restricts the configurable default to these two. */
export type DefaultStatus = 'current' | 'someday';

export const DEFAULT_STATUS_FALLBACK: DefaultStatus = 'current';

/**
 * The subset of a GlassFrog role the extension keeps. Cached at key-validation
 * time (KTD8) so the popup can offer a picker — role ids are opaque 32-hex
 * values a practitioner cannot type from memory.
 */
export interface RoleSummary {
  id: string;
  name: string;
  /**
   * Whether the role has subroles — i.e. whether it is a circle. Optional
   * because a role list cached before this field was read has no answer, and
   * "absent" must stay distinguishable from "false": the picker treats the
   * former as unknown and keeps offering the role.
   */
  hasSubroles?: boolean;
  /**
   * The circle this role sits in. `null` for the anchor role, absent for a list
   * cached before parents were read. Names collide across an organisation, so
   * this is what lets the picker say *which* `Circle Lead` an option is.
   */
  parentRoleId?: string | null;
}

/** A capture parked while the extension is unconfigured (R9). */
export interface PendingCapture {
  /** Generated at capture time; also keys the in-flight marker (KTD7). */
  id: string;
  capture: Capture;
  /** When this entered the slot. Expiry is measured from here (KTD3). */
  capturedAt: string;
}

/**
 * Reading the slot is three-valued on purpose. R16 forbids retaining a stale
 * capture indefinitely but equally forbids deleting it silently, so an expired
 * capture must come back distinguishable rather than as `absent` — U6 surfaces
 * it. Storage reports; it does not decide.
 */
export type PendingCaptureRead =
  | { state: 'absent' }
  | { state: 'current'; pending: PendingCapture }
  | { state: 'expired'; pending: PendingCapture };

/** A write the worker has started but not yet confirmed (KTD7). */
export interface InFlightMarker {
  id: string;
  capture: Capture;
  startedAt: string;
}

/**
 * The last thing the extension tried to tell the practitioner, kept so a
 * surface can render it later.
 *
 * This exists because KTD2's notification surface is not universal: Safari
 * implements no `chrome.notifications`, so on a background quick-capture the
 * notice has nowhere to go the moment the containing app is unreachable. A
 * badge says *something happened* but cannot say which of KTD9's four failures
 * it was, and R18 turns entirely on the practitioner learning that an unusable
 * role wants reconfiguring rather than a retry.
 *
 * `deliveredBy` records which link in the chain actually took it, so a surface
 * can avoid repeating a notice the practitioner has already seen as a system
 * notification.
 */
export interface Notice {
  id: string;
  title: string;
  message: string;
  at: string;
  deliveredBy: 'notifications' | 'native' | 'stored';
}

/** What the practitioner typed into the popup but has not filed (R20). */
export interface PopupDraft {
  roleId?: string;
  workType?: WorkType;
  note?: string;
}

/**
 * Configuration is reported as *which* pieces are missing, not as a boolean.
 * R21 needs to tell a practitioner what to do next, and U3's save is two-phase
 * — a valid key with no role chosen yet is a real, distinct state.
 */
export type ConfigurationState =
  | { configured: true }
  | { configured: false; missing: ConfigurationGap[] };

export type ConfigurationGap = 'apiKey' | 'captureRole';

const area = (): chrome.storage.LocalStorageArea => chrome.storage.local;

async function readKey<T>(key: string): Promise<T | undefined> {
  const stored = await area().get(key);
  return stored[key] as T | undefined;
}

/* ------------------------------------------------------------------ config */

export async function getApiKey(): Promise<string | undefined> {
  return readKey<string>(STORAGE_KEYS.apiKey);
}

export async function getCaptureRoleId(): Promise<string | undefined> {
  return readKey<string>(STORAGE_KEYS.captureRoleId);
}

export async function getRoles(): Promise<RoleSummary[]> {
  return (await readKey<RoleSummary[]>(STORAGE_KEYS.roles)) ?? [];
}

export async function getDefaultStatus(): Promise<DefaultStatus> {
  const stored = await readKey<string>(STORAGE_KEYS.defaultStatus);
  return stored === 'someday' || stored === 'current' ? stored : DEFAULT_STATUS_FALLBACK;
}

export async function setApiKey(apiKey: string): Promise<void> {
  await area().set({ [STORAGE_KEYS.apiKey]: apiKey });
}

export async function setCaptureRoleId(roleId: string): Promise<void> {
  await area().set({ [STORAGE_KEYS.captureRoleId]: roleId });
}

export async function setRoles(roles: RoleSummary[]): Promise<void> {
  await area().set({ [STORAGE_KEYS.roles]: roles });
}

export async function setDefaultStatus(status: DefaultStatus): Promise<void> {
  await area().set({ [STORAGE_KEYS.defaultStatus]: status });
}

/**
 * Reports which of the two load-bearing settings are absent. A key that is
 * present but blank counts as absent — an empty string would otherwise sail
 * past and fail later as an opaque 401.
 */
export async function getConfigurationState(): Promise<ConfigurationState> {
  const [apiKey, roleId] = await Promise.all([getApiKey(), getCaptureRoleId()]);
  const missing: ConfigurationGap[] = [];
  if (!apiKey) missing.push('apiKey');
  if (!roleId) missing.push('captureRole');
  return missing.length === 0 ? { configured: true } : { configured: false, missing };
}

export async function isConfigured(): Promise<boolean> {
  return (await getConfigurationState()).configured;
}

/* ---------------------------------------------------------- pending capture */

/**
 * Always targets the one fixed key. Replacing rather than appending is what
 * keeps KD4's hold from becoming the accumulating inbox KD1 rejects (R15).
 */
export async function writePendingCapture(
  pending: PendingCapture,
): Promise<{ replaced: PendingCapture | undefined }> {
  const existing = await readKey<PendingCapture>(STORAGE_KEYS.pendingCapture);
  await area().set({ [STORAGE_KEYS.pendingCapture]: pending });
  return { replaced: existing };
}

export async function readPendingCapture(now: number = Date.now()): Promise<PendingCaptureRead> {
  const pending = await readKey<PendingCapture>(STORAGE_KEYS.pendingCapture);
  if (!pending) return { state: 'absent' };
  const capturedAt = Date.parse(pending.capturedAt);
  // An unparseable timestamp is treated as expired rather than trusted as
  // current: surfacing it is recoverable, silently holding it forever is not.
  const age = Number.isNaN(capturedAt) ? Number.POSITIVE_INFINITY : now - capturedAt;
  return age > PENDING_CAPTURE_TTL_MS ? { state: 'expired', pending } : { state: 'current', pending };
}

export async function clearPendingCapture(): Promise<void> {
  await area().remove(STORAGE_KEYS.pendingCapture);
}

/* ------------------------------------------------------- in-flight markers */

const inFlightKey = (id: string): string => `${IN_FLIGHT_KEY_PREFIX}${id}`;

export async function markInFlight(marker: InFlightMarker): Promise<void> {
  await area().set({ [inFlightKey(marker.id)]: marker });
}

export async function clearInFlight(id: string): Promise<void> {
  await area().remove(inFlightKey(id));
}

/** Every marker still recorded — what U6 surfaces at worker startup (KTD7). */
export async function listInFlight(): Promise<InFlightMarker[]> {
  const all = await area().get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(IN_FLIGHT_KEY_PREFIX))
    .map(([, value]) => value as InFlightMarker);
}

/* ------------------------------------------------------------- last notice */

export async function readNotice(): Promise<Notice | undefined> {
  return readKey<Notice>(STORAGE_KEYS.lastNotice);
}

/**
 * One slot, overwritten — the same shape as the pending capture and for the
 * same reason (KTD3/KD1): a growing list of unread notices is an inbox, and
 * this extension does not have one.
 */
export async function writeNotice(notice: Notice): Promise<void> {
  await area().set({ [STORAGE_KEYS.lastNotice]: notice });
}

export async function clearNotice(): Promise<void> {
  await area().remove(STORAGE_KEYS.lastNotice);
}

/* -------------------------------------------------------------- popup draft */

export async function readDraft(): Promise<PopupDraft | undefined> {
  return readKey<PopupDraft>(STORAGE_KEYS.popupDraft);
}

export async function writeDraft(draft: PopupDraft): Promise<void> {
  await area().set({ [STORAGE_KEYS.popupDraft]: draft });
}

export async function clearDraft(): Promise<void> {
  await area().remove(STORAGE_KEYS.popupDraft);
}

/* -------------------------------------------------------------- listeners */

/**
 * Subscribes to configuration becoming valid (or changing).
 *
 * Exposed here rather than letting callers reach for chrome.storage.onChanged
 * themselves: this module owns which keys constitute configuration, and that
 * knowledge leaking into the service worker is exactly how two definitions of
 * "configured" come to disagree.
 */
export function onConfigurationChanged(listener: () => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (STORAGE_KEYS.apiKey in changes || STORAGE_KEYS.captureRoleId in changes) listener();
  });
}

/**
 * Subscribes to the pending slot changing.
 *
 * U3 needs this because `openOptionsPage()` may only *focus* a page that is
 * already open, in which case its load-time read never runs and a newly-held
 * capture would never appear (AE9).
 */
export function onPendingCaptureChanged(listener: () => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (STORAGE_KEYS.pendingCapture in changes) listener();
  });
}

/* ------------------------------------------------------------ access level */

/**
 * Lets the options page and popup read the same `local` area the worker writes.
 *
 * The typeof guard is load-bearing: `setAccessLevel` arrived on `local` later
 * than on `session`, and calling it unguarded throws during module evaluation —
 * which would take every capture path down with it, on exactly the older Chrome
 * builds least able to report why.
 */
export function enableTrustedContexts(): void {
  const local = chrome.storage.local as chrome.storage.LocalStorageArea & {
    setAccessLevel?: (options: { accessLevel: string }) => Promise<void>;
  };
  if (typeof local.setAccessLevel !== 'function') return;
  void local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {
    // Older builds reject rather than omit the method. Non-fatal either way.
  });
}

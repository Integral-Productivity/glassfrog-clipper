/**
 * R13: local capture telemetry, and the boundary that keeps it local.
 *
 * STRATEGY.md's Distribution & trust track makes trust the adoption gate, so
 * the posture here is the product decision, not an implementation detail:
 * records are written to `chrome.storage.local` and nothing in this module can
 * send them anywhere. Egress exists only as a button the practitioner presses
 * on the options page, which copies the log to their own clipboard.
 *
 * R13 says a telemetry record carries only timing and outcome fields — never
 * the captured URL, page title, selection text, or the API key. That is
 * enforced three ways, deliberately layered, because a leak here is silent and
 * permanent:
 *
 *   1. `structureOf` is the only function that ever sees a `Capture`, and it
 *      returns two booleans. No other code path can pass captured text in.
 *   2. `sanitize` copies an allowlist of fields and drops everything else, so a
 *      field added carelessly later never reaches storage.
 *   3. `test/telemetry.test.ts` files a capture whose URL, title, selection and
 *      key are distinctive sentinels and asserts none appears in the serialised
 *      log — the same wire-level discipline `test/glassfrog-adapter.test.ts`
 *      applies to what goes on the network.
 *
 * KTD1's reasoning carries over: the service worker records every event. A
 * popup that recorded its own abandonment could not — Chrome destroys it on
 * blur, which is the very event being measured.
 */
import { type CaptureFailureKind, isTelemetryMessage } from './messages.ts';
import { clearTelemetryLog, readTelemetryLog, writeTelemetryLog } from './storage.ts';
import type { Capture } from './types.ts';

/**
 * The two paths are measured separately because STRATEGY.md thresholds them
 * separately: p95 ≤ 2s applies to the keystroke path only, since human
 * deliberation dominates the popup and is not a measure of flow.
 */
export type CapturePath = 'keystroke' | 'popup';

export type CaptureOutcome =
  /** Reached GlassFrog and was accepted. */
  | 'filed'
  /** Reached GlassFrog and was refused, or never got there. */
  | 'failed'
  /** R9: the extension was unconfigured, so the capture is parked. */
  | 'held'
  /** The popup closed without filing. Only the popup path can abandon. */
  | 'abandoned'
  /** OQ7: a tab Chrome would not let the extension read. */
  | 'unreadable-tab';

/**
 * One invocation. Every field is a timestamp, a duration, an enum, or a
 * boolean — there is nowhere in this shape to put captured text.
 */
export interface CaptureRecord {
  /** The capture id. Locally generated (crypto.randomUUID), carries no content. */
  id: string;
  path: CapturePath;
  startedAt: string;
  /** Absent while the invocation is still open. */
  outcome?: CaptureOutcome;
  endedAt?: string;
  durationMs?: number;
  /**
   * Whether the practitioner named a role *other than the configured default*.
   * See `structureOf` — the distinction is what makes the structure-at-capture
   * rate able to falsify anything.
   */
  roleSet?: boolean;
  workTypeSet?: boolean;
  failureKind?: CaptureFailureKind;
}

/** R13's allowlist. Anything not named here never reaches storage. */
export const TELEMETRY_FIELDS = Object.freeze([
  'id',
  'path',
  'startedAt',
  'outcome',
  'endedAt',
  'durationMs',
  'roleSet',
  'workTypeSet',
  'failureKind',
] as const);

/** Enough for months of ordinary use; the log is read whole, so it stays small. */
export const TELEMETRY_MAX_RECORDS = 1000;

/**
 * Longer than the 90-day triage window so a rolling read never runs off the end
 * of the log, and bounded so the log cannot grow without limit on a device the
 * practitioner never clears.
 */
export const TELEMETRY_RETENTION_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reduces a capture to the two booleans structure-at-capture needs.
 *
 * The definition of `roleSet` is the load-bearing choice in this file. The
 * popup pre-fills the role picker with the configured capture role, so counting
 * "a role is present" would score every zero-decision capture as structured and
 * drive the rate towards 100% — turning STRATEGY.md's falsification test into a
 * measure that cannot fail. A capture filed against the configured default *is*
 * the deferred path, whichever surface it came from, so only a role that
 * differs from it counts.
 *
 * This under-counts rather than over-counts, which is the safe direction for a
 * test whose job is to disprove the positioning.
 */
export function structureOf(
  capture: Capture,
  context: { captureRoleId?: string },
): { roleSet: boolean; workTypeSet: boolean } {
  return {
    roleSet: Boolean(capture.roleId) && capture.roleId !== context.captureRoleId,
    // KD2: an unset work type is a tension by default, so only an explicit one
    // represents a decision the practitioner made at capture time.
    workTypeSet: capture.workType !== undefined,
  };
}

/**
 * Copies the allowlisted fields and nothing else.
 *
 * Type-checked as well as key-checked: a string smuggled into `durationMs`
 * would pass an allowlist that only looked at names.
 */
export function sanitize(record: CaptureRecord): CaptureRecord {
  const source = record as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of TELEMETRY_FIELDS) {
    const value = source[field];
    if (value === undefined) continue;
    if (field === 'durationMs') {
      if (typeof value === 'number' && Number.isFinite(value)) out[field] = value;
      continue;
    }
    if (field === 'roleSet' || field === 'workTypeSet') {
      if (typeof value === 'boolean') out[field] = value;
      continue;
    }
    if (typeof value === 'string') out[field] = value;
  }
  return out as unknown as CaptureRecord;
}

/**
 * Serialises every read-modify-write on the log.
 *
 * `chrome.storage.local` offers no atomic update, and KTD7 already establishes
 * that two captures can be in flight at once — without this, the second write
 * silently discards the first one's record.
 */
let tail: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work);
  tail = next.catch(() => undefined);
  return next;
}

function prune(records: readonly CaptureRecord[], now: number): CaptureRecord[] {
  const cutoff = now - TELEMETRY_RETENTION_DAYS * DAY_MS;
  const fresh = records.filter((record) => {
    const at = Date.parse(record.startedAt);
    // An unparseable timestamp is dropped: it can never fall inside a rolling
    // window, so keeping it only costs quota.
    return !Number.isNaN(at) && at >= cutoff;
  });
  return fresh.slice(Math.max(0, fresh.length - TELEMETRY_MAX_RECORDS));
}

async function update(mutate: (records: CaptureRecord[]) => CaptureRecord[]): Promise<void> {
  await serialize(async () => {
    const current = await readTelemetryLog();
    const next = mutate([...current]).map(sanitize);
    await writeTelemetryLog(prune(next, Date.now()));
  });
}

/** Opens an invocation. Called the moment the shortcut fires or the popup loads. */
export async function recordStarted(input: {
  id: string;
  path: CapturePath;
  startedAt?: string;
}): Promise<void> {
  const startedAt = input.startedAt ?? new Date().toISOString();
  await update((records) => {
    if (records.some((r) => r.id === input.id)) return records;
    records.push({ id: input.id, path: input.path, startedAt });
    return records;
  });
}

export interface OutcomeDetail {
  durationMs?: number;
  failureKind?: CaptureFailureKind;
  structure?: { roleSet: boolean; workTypeSet: boolean };
  /** Only used when no open record exists — see below. */
  path?: CapturePath;
}

/**
 * Closes an invocation.
 *
 * If no open record is found the outcome is still recorded, with `startedAt`
 * set to now. The worker can be destroyed between the start and the outcome, and
 * a filed capture that goes unrecorded would understate exactly the denominator
 * every rate here divides by. A first outcome wins: a record that already has
 * one is never overwritten, so a late `abandoned` from a closing popup cannot
 * undo a `filed` that already landed.
 */
export async function recordOutcome(
  id: string,
  outcome: CaptureOutcome,
  detail: OutcomeDetail = {},
): Promise<void> {
  const endedAt = new Date().toISOString();
  await update((records) => {
    const existing = records.find((r) => r.id === id);
    if (existing?.outcome) return records;

    const target =
      existing ?? { id, path: detail.path ?? 'keystroke', startedAt: endedAt };
    if (!existing) records.push(target);

    target.outcome = outcome;
    target.endedAt = endedAt;

    const started = Date.parse(target.startedAt);
    const duration = detail.durationMs ?? (Number.isNaN(started) ? undefined : Date.parse(endedAt) - started);
    if (duration !== undefined && duration >= 0) target.durationMs = duration;

    if (detail.failureKind) target.failureKind = detail.failureKind;
    if (detail.structure) {
      target.roleSet = detail.structure.roleSet;
      target.workTypeSet = detail.structure.workTypeSet;
    }
    return records;
  });
}

export async function readTelemetry(): Promise<CaptureRecord[]> {
  return (await readTelemetryLog()).map(sanitize);
}

export async function clearTelemetry(): Promise<void> {
  await serialize(async () => clearTelemetryLog());
}

/* -------------------------------------------------------- the popup port -- */

/** The slice of chrome.runtime.Port this needs, so a test can supply one. */
export interface TelemetryPortLike {
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface TelemetrySessionOptions {
  /**
   * Whether a capture's write is currently going out. A popup destroyed *while*
   * its capture is in flight has not abandoned anything — the worker finishes
   * that write regardless (KTD1) — so counting it would report a capture the
   * practitioner successfully made as one they gave up on.
   */
  isSubmitting: (captureId: string) => boolean;
}

/**
 * Follows one popup from open to close.
 *
 * This lives here rather than in src/background.ts because it is telemetry
 * behaviour, and because src/background.ts must stay what its header says it
 * is: listeners registered synchronously at top level, with nothing in it that
 * wants a test.
 *
 * The disconnect is the measurement. Chrome destroys a popup on blur with no
 * event the popup itself can send, so abandonment is only observable as the
 * port going away — which is why the popup opens one at all.
 */
export function attachTelemetrySession(
  port: TelemetryPortLike,
  options: TelemetrySessionOptions,
): void {
  let session: string | undefined;

  port.onMessage.addListener((message: unknown) => {
    if (!isTelemetryMessage(message)) return;
    session = message.captureId;
    if (message.kind === 'started') {
      void recordStarted({ id: message.captureId, path: message.path, startedAt: message.startedAt });
    } else {
      void recordOutcome(message.captureId, message.outcome, { path: message.path });
    }
  });

  port.onDisconnect.addListener(() => {
    if (!session || options.isSubmitting(session)) return;
    // recordOutcome keeps the first outcome, so a filing that already landed
    // wins over this even when the ordering is unlucky.
    void recordOutcome(session, 'abandoned', { path: 'popup' });
  });
}

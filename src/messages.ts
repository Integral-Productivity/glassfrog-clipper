/**
 * The contract between the three extension contexts.
 *
 * KTD1 makes the service worker the only writer: the popup and the options page
 * send it a message and receive an outcome. Chrome destroys a popup on blur with
 * no way to prevent it, so a popup-owned fetch loses captures the practitioner
 * had already committed to.
 *
 * U3 and U7 import these types rather than defining their own, so there is one
 * place the shape of a capture request changes.
 */
import type { CaptureOutcome, CapturePath } from './telemetry.ts';
import type { Capture } from './types.ts';

export const FILE_CAPTURE = 'clipper/file-capture' as const;

/**
 * How an invocation began, carried so the worker can close the telemetry record
 * the popup opened. `startedAt` comes from the popup because only the popup
 * knows when it was opened, and time-to-capture is measured from there.
 */
export interface Invocation {
  path: CapturePath;
  startedAt: string;
}

export interface FileCaptureRequest {
  type: typeof FILE_CAPTURE;
  /** Generated at capture time; keys the in-flight marker (KTD7). */
  captureId: string;
  capture: Capture;
  /** Absent from an older message; the worker then measures from its own clock. */
  invocation?: Invocation;
}

/**
 * The telemetry channel, and the reason it is a long-lived port rather than a
 * message.
 *
 * Popup abandonment is measured by the popup *ceasing to exist*, and there is
 * no event a dying popup can reliably send. A port, though, disconnects when
 * its document is destroyed — so the worker learns of the closure from Chrome
 * rather than from the popup, which is what makes the measurement possible at
 * all. KTD1's reasoning again: the worker records, because the popup cannot.
 *
 * The protocol is deliberately declared here rather than in src/telemetry.ts.
 * The popup must be able to speak it without importing the recorder, so that
 * "only the service worker writes telemetry" is a property of the module graph
 * and not of anyone's discipline.
 */
export const TELEMETRY_PORT = 'clipper/telemetry' as const;

export type TelemetryMessage =
  | { kind: 'started'; captureId: string; path: CapturePath; startedAt: string }
  | { kind: 'outcome'; captureId: string; path: CapturePath; outcome: CaptureOutcome };

export function isTelemetryMessage(value: unknown): value is TelemetryMessage {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, captureId } = value as { kind?: unknown; captureId?: unknown };
  return (kind === 'started' || kind === 'outcome') && typeof captureId === 'string';
}

/**
 * KTD9 splits failure rather than reporting one "it failed", because R18
 * requires the practitioner learn that an unusable role needs *reconfiguring*
 * rather than a retry — a distinction a single message cannot carry.
 *
 * KTD9 says four kinds. There are five: 401 joined the reconfigure path, and
 * an unclassified status needs somewhere to go that is not a guess. The plan
 * is annotated; this is the count that is real.
 */
export type CaptureFailureKind =
  /** Malformed stored role id; the SDK rejects it before any request goes out. */
  | 'unusable-role'
  /** 429 after the SDK's own retries. */
  | 'rate-limited'
  /** status 0 — network down, or the request timed out. */
  | 'network'
  /** 422 — the request was understood and refused. */
  | 'invalid-payload'
  /** Anything unclassified; preserved and surfaced rather than guessed at. */
  | 'unknown';

export interface CaptureFailure {
  kind: CaptureFailureKind;
  /**
   * Safe to show a practitioner. R12: never the request headers, never the API
   * key — the SDK's error type carries no headers, so this holds as long as
   * nothing logs the client options.
   */
  message: string;
  /** True when R18's reconfigure path applies rather than preserve-and-retry. */
  reconfigure: boolean;
  /**
   * Whether the item may exist in GlassFrog despite the failure.
   *
   * False for every failure that names its own rejection — a 4xx, or the
   * client-side id validation that never reached the network. True only where
   * the outcome is genuinely unknown: a request that may have been received
   * before the connection died, or a 5xx that may have followed a completed
   * write. KTD7 hands that ambiguity to the practitioner, and this is the flag
   * that decides whether there is any ambiguity to hand over.
   */
  mayHaveFiled: boolean;
}

export type FileCaptureOutcome =
  | { status: 'filed'; captureId: string; itemId?: string }
  /** R9: the extension was unconfigured, so the capture is held, not lost. */
  | { status: 'held'; captureId: string; replacedPending: boolean }
  | { status: 'failed'; captureId: string; failure: CaptureFailure };

export function isFileCaptureRequest(value: unknown): value is FileCaptureRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === FILE_CAPTURE
  );
}

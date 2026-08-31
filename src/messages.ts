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
import type { Capture } from './types.ts';

export const FILE_CAPTURE = 'clipper/file-capture' as const;

export interface FileCaptureRequest {
  type: typeof FILE_CAPTURE;
  /** Generated at capture time; keys the in-flight marker (KTD7). */
  captureId: string;
  capture: Capture;
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

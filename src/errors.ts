/**
 * Failure classification.
 *
 * Implements KTD9: failures split four ways, not two. The split exists because
 * R18 requires the practitioner learn that an *unusable role* needs
 * reconfiguring rather than a retry — a distinction "it failed" cannot carry,
 * and the one that decides whether waiting will ever help.
 *
 * R12 governs everything that leaves here: no surfaced or logged string may
 * carry the API key or the headers bearing it.
 *
 * A second axis rides alongside the four kinds: `mayHaveFiled`. R10 preserves a
 * failed capture in every case, but only an *ambiguous* failure should leave the
 * in-flight marker behind for U6 to surface — a definite 4xx means no item was
 * created, and telling the practitioner to go check GlassFrog for it sends them
 * looking for something that does not exist.
 */
import type { CaptureFailure, CaptureFailureKind } from './messages.ts';

/** The shape the SDK's error carries. It has no headers field, which is why R12 holds. */
interface ApiErrorLike {
  status?: unknown;
  message?: unknown;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as ApiErrorLike | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function messageOf(error: unknown): string {
  const message = (error as ApiErrorLike | null)?.message;
  return typeof message === 'string' && message.trim() ? message.trim() : 'Unknown error';
}

/**
 * `instanceof` is not load-bearing here on purpose: a TypeError crossing a
 * message boundary or a realm arrives structurally intact but fails the
 * prototype check, and misclassifying the SDK's id validation as transient
 * would tell the practitioner to retry a capture that can never succeed.
 */
function isValidationTypeError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (error as { name?: unknown } | null)?.name === 'TypeError';
}

/**
 * Removes the API key from a string before it can be shown or logged.
 *
 * The SDK's error type carries no headers, so R12 already holds by
 * construction. This is the second layer: it costs one pass over a short
 * string, and it means a future SDK that echoes a request into an error message
 * cannot turn into a key disclosure without someone noticing.
 */
export function redact(text: string, apiKey?: string): string {
  if (!apiKey || apiKey.length < 8) return text;
  return text.split(apiKey).join('[redacted]');
}

export interface ClassifyOptions {
  /** Passed so the key can be scrubbed from any message that echoes it. */
  apiKey?: string;
}

export function classifyFailure(error: unknown, options: ClassifyOptions = {}): CaptureFailure {
  const status = statusOf(error);
  const detail = redact(messageOf(error), options.apiKey);

  // Client-side id validation. Never reached the network, and never will with
  // the role currently stored.
  if (status === undefined && isValidationTypeError(error)) {
    return failure('unusable-role', `That capture role is not usable: ${detail}`, true, NOT_FILED);
  }

  switch (status) {
    case 401:
    case 403:
    case 404:
      // 401 joins the reconfigure path: a rejected key is as unusable as a
      // rejected role, and retrying either is time the practitioner will not
      // get back.
      return failure(
        'unusable-role',
        status === 401
          ? 'GlassFrog rejected the API key. Open the extension options to update it.'
          : 'GlassFrog would not file to that role. Open the extension options to choose another.',
        true,
        NOT_FILED,
      );
    case 429:
      return failure('rate-limited', 'GlassFrog is rate limiting requests. Your capture is saved — try again shortly.', false, NOT_FILED);
    case 422:
      return failure('invalid-payload', `GlassFrog refused the request: ${detail}`, false, NOT_FILED);
    case 0:
      // Not NOT_FILED. Status 0 covers both a connection that never opened and
      // a request that went out and whose response was lost, and nothing here
      // can tell those apart. Treating it as definitely-not-filed would drop the
      // in-flight marker that is the only trace of a write that may have landed.
      return failure('network', 'Could not reach GlassFrog. Your capture is saved — try again when you are back online.', false, MAY_HAVE_FILED);
    default:
      // Unclassified, which includes 5xx: a server error can follow a write that
      // already succeeded, so the outcome is unknown rather than negative.
      return failure('unknown', `Filing failed: ${detail}`, false, MAY_HAVE_FILED);
  }
}

/**
 * Named rather than passed as a bare boolean: `failure(..., false, false)` at a
 * call site says nothing about which `false` is which, and the two flags mean
 * opposite kinds of thing.
 */
const NOT_FILED = false;
const MAY_HAVE_FILED = true;

function failure(
  kind: CaptureFailureKind,
  message: string,
  reconfigure: boolean,
  mayHaveFiled: boolean,
): CaptureFailure {
  return { kind, message, reconfigure, mayHaveFiled };
}

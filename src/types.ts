/**
 * The three shapes GlassFrog can receive. Deliberately closed — STRATEGY.md's
 * "Holacracy-native" boundary means we never invent a fourth.
 */
export type WorkType = 'tension' | 'action' | 'project';

/** What the browser can tell us for free, before the practitioner decides anything. */
export interface PageContext {
  url: string;
  title: string;
  /** Text the practitioner had selected when they invoked capture, if any. */
  selection?: string;
  capturedAt: string;
}

/**
 * A capture in flight. `workType` and `roleId` are optional by design — that
 * optionality IS the strategy ("never block, never discard"). A capture with
 * both unset is valid and must still file.
 */
export interface Capture {
  page: PageContext;
  note?: string;
  workType?: WorkType;
  roleId?: string;
}

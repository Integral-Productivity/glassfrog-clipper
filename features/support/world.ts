/**
 * The world the capture scenarios run in.
 *
 * Two substitutions, and only two:
 *
 * 1. `chrome.*` is the in-memory fake already used by the unit suite. It is
 *    imported from `test/support/` rather than copied, because two fakes of the
 *    same platform drift apart and the copy is always the one that stops
 *    matching Chrome. Chrome is the platform here, not the system under test.
 *
 * 2. GlassFrog is substituted behind the `CaptureWriter` port, never at the
 *    network boundary — the Verification Contract forbids the latter, and the
 *    port is what it prescribes instead.
 *
 * Everything between those two boundaries is the real capture path: real
 * compose(), real fileCapture(), real storage semantics.
 *
 * The scenarios themselves name neither of these. They speak the vocabulary in
 * CONCEPTS.md, so a second platform binds its own driver to the same .feature
 * files rather than restating them — see docs/adr/0011.
 */
import { World, setWorldConstructor } from '@cucumber/cucumber';

import type { CaptureWriter, CreatedItem } from '../../src/capture.ts';
import type { DefaultStatus } from '../../src/storage.ts';
import { type FakeChrome, installFakeChrome } from '../../test/support/chrome.ts';
import type { Capture } from '../../src/types.ts';

/** One accepted write, in the shape the port received it. */
export interface FiledItem {
  kind: 'tension' | 'action' | 'project';
  roleId: string;
  input: Record<string, unknown>;
}

/** What the practitioner was told, if anything. */
export type Outcome =
  | { state: 'filed'; item: CreatedItem }
  | { state: 'held'; replacedPending: boolean }
  | { state: 'failed'; error: unknown }
  | { state: 'none' };

export class ClipperWorld extends World {
  chrome!: FakeChrome;
  private restoreChrome: (() => void) | undefined;

  /** Every write the port accepted, in order. */
  filed: FiledItem[] = [];

  /** The capture currently being assembled by the When steps. */
  draft: Partial<Capture> = {};

  outcome: Outcome = { state: 'none' };

  /**
   * An ordered log of the things the capture path did that a scenario might
   * care about the ORDER of — 'selection-read', 'write'. Ordering assertions
   * need a sequence, and reconstructing one from timestamps is flaky by
   * construction.
   */
  events: string[] = [];

  /**
   * Set by a scenario that needs the write to fail. `'never-returns'` models a
   * worker killed mid-write — the promise neither resolves nor rejects, which
   * is the only way to observe an in-flight marker being left behind.
   */
  writeFailure: unknown | 'never-returns' | undefined;

  installChrome(): void {
    const { chrome, restore } = installFakeChrome();
    this.chrome = chrome;
    this.restoreChrome = restore;
  }

  teardown(): void {
    this.restoreChrome?.();
    this.restoreChrome = undefined;
  }

  /**
   * The fake behind the port. Records what GlassFrog would have received, so
   * assertions can read the filed item as the practitioner's triage would.
   */
  writer(): CaptureWriter {
    const record = async (
      kind: FiledItem['kind'],
      roleId: string,
      input: Record<string, unknown>,
    ): Promise<CreatedItem> => {
      this.events.push('write');
      if (this.writeFailure === 'never-returns') return new Promise<CreatedItem>(() => {});
      if (this.writeFailure !== undefined) throw this.writeFailure;
      this.filed.push({ kind, roleId, input });
      return { id: `item-${this.filed.length}` };
    };

    return {
      createTension: (roleId, input) => record('tension', roleId, { ...input }),
      createAction: (roleId, input: { status: DefaultStatus } & Record<string, unknown>) =>
        record('action', roleId, { ...input }),
      createProject: (roleId, input: { status: DefaultStatus } & Record<string, unknown>) =>
        record('project', roleId, { ...input }),
    };
  }

  /** The single item filed, failing loudly when the count is not one. */
  onlyFiled(): FiledItem {
    if (this.filed.length !== 1) {
      throw new Error(`expected exactly one filed item, found ${this.filed.length}`);
    }
    return this.filed[0]!;
  }

  /**
   * The headline field, whichever field the work type puts it in. A tension has
   * no `description`: its marker leads `body` (ADR 0004), so the headline is
   * that field's first line.
   */
  headlineOf(item: FiledItem): string {
    if (item.kind === 'tension') return String(item.input.body ?? '').split('\n\n')[0] ?? '';
    return String(item.input.description ?? '');
  }

  /** The evidence field — the practitioner's note and the page evidence. */
  detailOf(item: FiledItem): string {
    if (item.kind === 'tension') {
      return String(item.input.body ?? '')
        .split('\n\n')
        .slice(1)
        .join('\n\n');
    }
    return String(item.input.note ?? '');
  }
}

setWorldConstructor(ClipperWorld);

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  delegatesTo,
  directStrippers,
  pageContextProducers,
  producerViolations,
  stripsDirectly,
} from '../../fitness/checks/capture-credential-strip.ts';

/**
 * Red-then-green for `fitness/checks/capture-credential-strip.ts`.
 *
 * Every fixture is an inline source string. Nothing here touches the file
 * system and nothing needs a Swift toolchain — which is the point: the check
 * runs in `Software Fitness / Self-compliance` on `ubuntu-latest`, so if it
 * could only be exercised on macOS it could not be a gate at all (ADR 0022).
 */

const swiftStripper = `
struct CaptureFiler {
    public static func file(_ capture: Capture) async -> Outcome {
        return await client.file(capture)
    }

    public static func pageContext(url: String, title: String) -> PageContext {
        return PageContext(url: Compose.truncate(Compose.stripUrlCredentials(url)), title: title)
    }
}
`;

test('a producer that strips is accepted, in both languages', () => {
  const ts = 'export function pageContextFromTab(tab: Tab): PageContext { return { url: stripUrlCredentials(tab.url) }; }';

  assert.deepEqual(pageContextProducers(ts).map((p) => p.name), ['pageContextFromTab']);
  assert.ok(stripsDirectly(pageContextProducers(ts)[0]!.body));
  assert.deepEqual(producerViolations('src/capture.ts', ts, new Set()), []);

  assert.deepEqual(pageContextProducers(swiftStripper).map((p) => p.name), ['pageContext']);
  assert.deepEqual(producerViolations('CaptureFiler.swift', swiftStripper, new Set()), []);
});

test('the guard detects a TypeScript surface that skips the strip', () => {
  // The red half. This is the shape the extension shipped before R7, and the
  // shape a third capture surface would arrive in.
  const leaky = 'export function pageContextFromPopup(tab: Tab): PageContext { return { url: tab.url }; }';
  const violations = producerViolations('src/popup.ts', leaky, new Set());

  assert.equal(violations.length, 1);
  assert.match(violations[0]!.where, /src\/popup\.ts — pageContextFromPopup/);
  assert.match(violations[0]!.detail, /without routing its url through/);
});

test('the guard detects a Swift surface that skips the strip', () => {
  // The red half for the other language, and the actual historical defect:
  // the share extension built its own PageContext and filed the credential
  // while `swift test` stayed green.
  const leaky = `
    public static func pageContext(url: String, title: String) -> PageContext {
        return PageContext(url: Compose.truncate(url), title: title)
    }
  `;
  const violations = producerViolations('SharedItem.swift', leaky, new Set());

  assert.equal(violations.length, 1);
  assert.match(violations[0]!.where, /SharedItem\.swift — pageContext/);
});

test('delegating to a producer that strips is accepted, even when both share a name', () => {
  // Both Swift producers really are called `pageContext`. A naive "calls a safe
  // name other than its own" rule reads the qualified call as self-recursion
  // and reports a violation that is not there — which the first draft did.
  const delegating = `
    public static func pageContext(from items: [NSExtensionItem]) async -> PageContext? {
        return CaptureFiler.pageContext(url: url ?? "", title: title ?? "")
    }
  `;
  const safe = directStrippers([swiftStripper]);

  assert.deepEqual([...safe], ['pageContext']);
  assert.ok(delegatesTo(pageContextProducers(delegating)[0]!, safe));
  assert.deepEqual(producerViolations('SharedItem.swift', delegating, safe), []);
});

test('a producer cannot vouch for itself by calling itself', () => {
  // Without the qualified/different-name rule, a bare self-call would satisfy
  // delegation and any producer could launder its own violation.
  const recursive = `
    func pageContext(url: String) -> PageContext {
        return pageContext(url: url)
    }
  `;
  const safe = new Set(['pageContext']);

  assert.equal(delegatesTo(pageContextProducers(recursive)[0]!, safe), false);
  assert.equal(producerViolations('Loop.swift', recursive, safe).length, 1);
});

test('the parameter scan does not run across a function body', () => {
  // A regression test for a real defect in this check's first draft. With
  // `[\s\S]*?` for the parameter list, the match started at `func file`, ran
  // through its whole body, and landed on the later `-> PageContext` — naming
  // the wrong function and reading the wrong body. The check then believed
  // nothing in CaptureFiler.swift stripped.
  const producers = pageContextProducers(swiftStripper);

  assert.deepEqual(producers.map((p) => p.name), ['pageContext']);
  assert.ok(!producers.some((p) => p.name === 'file'), 'must not match the preceding function');
  assert.ok(producers[0]!.body.includes('stripUrlCredentials'), 'must read the producer own body');
});

test('a function that merely consumes a PageContext is not a producer', () => {
  // `headline(page: PageContext)` and `toCapture(page: PageContext, …)` take one
  // and carry no obligation. Flagging them would make the check unusable and
  // teach people to widen it.
  const consumers = `
    export function headline(page: PageContext): string { return page.title; }
    export function toCapture(page: PageContext, fields: PopupFields): Capture { return { page }; }
  `;

  assert.deepEqual(pageContextProducers(consumers), []);
  assert.deepEqual(producerViolations('src/compose.ts', consumers, new Set()), []);
});

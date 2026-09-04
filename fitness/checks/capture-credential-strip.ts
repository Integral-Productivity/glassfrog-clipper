/**
 * Characteristic: **confidentiality of what a capture carries**.
 *
 * R7 strips the URL `userinfo` component before a capture is filed, because
 * `https://user:token@host/path` is a credential the practitioner never chose
 * to send. The rule itself is small. Where it went wrong is instructive.
 *
 * When the strip first landed it went into `src/compose.ts` only, and the Apple
 * share extension builds its own `PageContext` in Swift rather than going
 * through `pageContextFromTab`. So every share from an iOS or macOS app filed
 * the credential — and `swift test` stayed green, because the two capture
 * surfaces do not share a capture path and nothing compared them. A reviewer
 * caught it. Nothing in the repository would have.
 *
 * The fix shipped a second implementation. The *class* of bug did not go away:
 * a third capture surface, or a refactor that adds another `PageContext`
 * producer, inherits no guard and no failing test. `sdk-boundary` guards the
 * seam where this repo meets the SDK; this guards the seam where a platform
 * meets the capture path, which is the seam that has actually drifted.
 *
 * The rule: **every producer of a `PageContext` routes its `url` through the
 * strip** — directly, or by delegating to a producer that does. Delegation is
 * allowed because `SharedItem.pageContext(from:)` legitimately hands off to
 * `CaptureFiler.pageContext`, and a rule that forbade that would push callers
 * toward duplicating the strip instead of reusing it.
 *
 * Both languages, in one check, because the whole point is that the two halves
 * drift apart. Static text analysis only: this runs in the `Software Fitness /
 * Self-compliance` job on `ubuntu-latest`, which has no Swift toolchain — and
 * per ADR 0022 a check must run inside a required context or it is not a gate.
 * Reading Swift as text is what makes that possible.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { type CheckResult, type Violation, fail, pass } from '../report.ts';
import { fromRoot } from '../root.ts';

const NAME = 'capture-credential-strip';
const CHARACTERISTIC = 'confidentiality — no capture surface files a credential it was handed';

/** The strip, named the same way in both languages. */
const STRIP = 'stripUrlCredentials';

/** Where production capture surfaces live. Tests build fixtures and are not surfaces. */
export const SURFACE_DIRECTORIES = [
  { dir: ['src'], extension: '.ts', language: 'TypeScript' as const },
  {
    dir: ['apple', 'GlassFrogClipperCore', 'Sources', 'GlassFrogClipperCore'],
    extension: '.swift',
    language: 'Swift' as const,
  },
];

export interface Producer {
  /** The function's name, as it appears in the source. */
  name: string;
  /** Its body, brace-balanced. */
  body: string;
}

/**
 * Read the body of every function whose *declared return type* is `PageContext`.
 *
 * Declared return type, not "mentions PageContext": `headline(page: PageContext)`
 * and `toCapture(page: PageContext, …)` consume one and must not be flagged.
 * Producing is what carries the obligation.
 *
 * Brace-balanced rather than regex-matched, for the reason
 * `credential-confinement.ts` gives about its own extractor: a non-greedy regex
 * stops at the first inner brace and silently checks a fragment. A check that
 * reads half its input is worse than no check, because it reports green.
 */
export function pageContextProducers(source: string): Producer[] {
  // TypeScript: `function name(…): PageContext {`
  // Swift:      `func name(…) -> PageContext {`, optionally `async`, optionally `?`
  //
  // The parameter list is `[^{}]*?`, not `[\s\S]*?`, and that is load-bearing.
  // A parameter list cannot contain a brace, but a *function body* can — so the
  // permissive form lets the match start at one `func`, run through that
  // function's entire body, and land on a later `-> PageContext`. It then
  // reports the wrong function's name and the wrong body. That is not
  // hypothetical: the first draft of this check read `CaptureFiler.swift` as
  // declaring a producer called `file`, missed `pageContext` entirely, and so
  // believed nothing stripped. Failing loudly is why it was caught; a variant
  // that mis-read in the safe direction would not have been.
  const declaration =
    /\b(?:function|func)\s+(\w+)\s*\([^{}]*?\)\s*(?:async\s*)?(?::|->)\s*PageContext\??\s*\{/g;

  const producers: Producer[] = [];
  for (const match of source.matchAll(declaration)) {
    const name = match[1];
    if (name === undefined) continue;

    const open = source.indexOf('{', match.index + match[0].length - 1);
    if (open === -1) continue;

    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    producers.push({ name, body: source.slice(open, end + 1) });
  }
  return producers;
}

/** Whether a body performs the strip itself. */
export function stripsDirectly(body: string): boolean {
  return new RegExp(`\\b${STRIP}\\s*\\(`).test(body);
}

/**
 * Whether a producer hands off to one that strips.
 *
 * The subtlety that caught the first draft of this check: both Swift producers
 * are *called* `pageContext`. `SharedItem.pageContext(from:)` delegates to
 * `CaptureFiler.pageContext(url:title:selection:)`, and a naive "calls a safe
 * name other than its own" test reads that as self-recursion and reports a
 * violation that is not there.
 *
 * So a delegation counts when the call is **type-qualified**
 * (`CaptureFiler.pageContext(`) or names a *different* producer. A bare
 * self-call does not, which is what keeps a producer from vouching for itself.
 */
export function delegatesTo(producer: Producer, safeNames: ReadonlySet<string>): boolean {
  return [...safeNames].some((safe) => {
    if (new RegExp(`\\b\\w+\\.${safe}\\s*\\(`).test(producer.body)) return true;
    return safe !== producer.name && new RegExp(`\\b${safe}\\s*\\(`).test(producer.body);
  });
}

/**
 * The pure rule over one file's producers.
 *
 * `safeNames` are producers already known to strip — passed in so delegation
 * across files resolves. `CaptureFiler.pageContext` strips; `SharedItem
 * .pageContext(from:)` calls it and is safe for that reason alone.
 */
export function producerViolations(path: string, source: string, safeNames: ReadonlySet<string>): Violation[] {
  const violations: Violation[] = [];

  for (const producer of pageContextProducers(source)) {
    if (stripsDirectly(producer.body)) continue;

    if (delegatesTo(producer, safeNames)) continue;

    violations.push({
      where: `${path} — ${producer.name}`,
      detail:
        `builds a PageContext without routing its url through \`${STRIP}\`, and without ` +
        'delegating to a producer that does. R7 strips the URL userinfo component before a ' +
        'capture is filed; a surface that skips it files the credential, and no test goes red ' +
        'because the two capture paths do not share code.',
    });
  }

  return violations;
}

/** Every producer in the corpus that strips directly — the roots delegation resolves to. */
export function directStrippers(sources: Iterable<string>): Set<string> {
  const names = new Set<string>();
  for (const source of sources) {
    for (const producer of pageContextProducers(source)) {
      if (stripsDirectly(producer.body)) names.add(producer.name);
    }
  }
  return names;
}

export async function runCaptureCredentialStripCheck(): Promise<CheckResult> {
  const files: Array<{ path: string; source: string; language: string }> = [];

  for (const surface of SURFACE_DIRECTORIES) {
    const names = (await readdir(fromRoot(...surface.dir))).filter((name) => name.endsWith(surface.extension));
    for (const name of names) {
      const path = join(...surface.dir, name);
      files.push({ path, source: await readFile(fromRoot(path), 'utf8'), language: surface.language });
    }
  }

  const safeNames = directStrippers(files.map((file) => file.source));

  const violations: Violation[] = [];
  let producers = 0;
  const languages = new Set<string>();

  for (const file of files) {
    const found = pageContextProducers(file.source);
    producers += found.length;
    if (found.length > 0) languages.add(file.language);
    violations.push(...producerViolations(file.path, file.source, safeNames));
  }

  // A check that stopped finding producers would report green over nothing —
  // the exact failure this repository has a solutions doc about. Both surfaces
  // must still be visible, since the whole point is that they drift apart.
  if (producers === 0 || languages.size < SURFACE_DIRECTORIES.length) {
    violations.push({
      where: 'fitness/checks/capture-credential-strip.ts',
      detail:
        `found ${producers} PageContext producer(s) across ${languages.size} of ` +
        `${SURFACE_DIRECTORIES.length} surfaces. Both a TypeScript and a Swift producer are ` +
        'expected; seeing fewer means a path moved and this check is guarding nothing.',
    });
  }

  return violations.length === 0
    ? pass(
        NAME,
        CHARACTERISTIC,
        `${producers} PageContext producers across ${languages.size} capture surfaces, all routed through ${STRIP}`,
      )
    : fail(NAME, CHARACTERISTIC, `${violations.length} capture surface problem(s)`, violations);
}

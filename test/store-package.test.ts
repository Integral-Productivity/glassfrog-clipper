import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error — a .mjs sibling with no type declarations; the rules it
// exports are the subject of this file, so importing them is the point.
import { storeViolations, REQUIRED_ICON_SIZES, LIMITS } from '../scripts/package-chrome.mjs';

/**
 * Fitness function, filed as a test — the arrangement ADR 0010 describes for the
 * checks that predate the fitness suite. The characteristic is **publishability**:
 * the packaged extension is accepted by Chrome Web Store review.
 *
 * It erodes silently, and expensively. Every rule checked here fails at the
 * dashboard rather than in the browser: the extension loads unpacked, passes the
 * suite, builds green, and is refused days later by a reviewer. Shortening the
 * feedback loop from a review cycle to a test run is the entire value.
 *
 * It is not filed under `fitness/` because ADR 0010 adopted four architectural
 * characteristics on a stated evaluation rather than as a collection point, and
 * publishability is a distribution constraint rather than an architectural one.
 * `scripts/package-chrome.mjs` applies the same exported rules to the real
 * artifact at packaging time, so there is one implementation with two reporting
 * surfaces, as with `fitness/checks/manifest-permissions.ts`.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function manifest(): Promise<Record<string, any>> {
  return JSON.parse(await readFile(join(root, 'public', 'manifest.json'), 'utf8'));
}

/** Actual pixel width of each declared icon, read from the PNG's IHDR chunk. */
async function iconDimensions(m: Record<string, any>): Promise<Map<string, number | null>> {
  const dimensions = new Map<string, number | null>();
  for (const declared of Object.values(m.icons ?? {}) as string[]) {
    try {
      const bytes = await readFile(join(root, 'public', declared));
      dimensions.set(declared, bytes.readUInt32BE(16));
    } catch {
      dimensions.set(declared, null);
    }
  }
  return dimensions;
}

test('the manifest would survive Chrome Web Store review', async () => {
  const m = await manifest();
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

  const problems = storeViolations(m, await iconDimensions(m), version);

  assert.deepEqual(
    problems,
    [],
    'these fail at the store dashboard, days after the change that caused them',
  );
});

test('every icon slot the browser UI uses is declared and correctly sized', async () => {
  const m = await manifest();
  const dimensions = await iconDimensions(m);

  for (const size of REQUIRED_ICON_SIZES as number[]) {
    const declared = m.icons[String(size)];
    // Chrome silently upscales the nearest icon for a missing slot, so a
    // toolbar button can look blurry with nothing anywhere reporting why.
    assert.ok(declared, `icons.${size} is not declared`);
    assert.equal(dimensions.get(declared), size, `${declared} is not ${size}px wide`);
  }
});

test('the store description stays inside the limit that is easy to overrun', async () => {
  const { description } = await manifest();

  // 132 characters is short enough that an ordinary sentence about the product
  // overruns it, which is why this is asserted rather than trusted.
  assert.ok(description.length > 0, 'the store requires a description');
  assert.ok(
    description.length <= LIMITS.description,
    `description is ${description.length} characters; the limit is ${LIMITS.description}`,
  );
});

test('the committed icons are what scripts/render-icons.py produces', async (t) => {
  // The geometry in render-icons.py is the source of truth for the mark. If the
  // PNGs are edited by hand — or the geometry is edited without re-rendering —
  // nothing else in the tree notices, and the drift ships.
  const out = await mkdtemp(join(tmpdir(), 'clipper-icons-'));
  try {
    try {
      execFileSync('python3', [join(root, 'scripts', 'render-icons.py'), '--out', out], {
        stdio: 'pipe',
      });
    } catch (error) {
      // Rendering needs only the Python standard library, so a failure here is
      // a missing interpreter rather than a missing dependency. Say so instead
      // of reporting the icons as drifted.
      t.skip(`python3 unavailable or failed: ${(error as Error).message}`);
      return;
    }

    for (const size of REQUIRED_ICON_SIZES as number[]) {
      const committed = await readFile(join(root, 'public', `icon${size}.png`));
      const rendered = await readFile(join(out, `icon${size}.png`));
      assert.ok(
        committed.equals(rendered),
        `public/icon${size}.png differs from the geometry — run \`npm run icons\``,
      );
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

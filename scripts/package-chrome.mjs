/**
 * Packages `dist/` into the zip the Chrome Web Store accepts, and refuses to
 * package anything that would fail review.
 *
 * The refusal is the point. A Web Store rejection costs a review cycle measured
 * in days, and the causes are almost all trivially checkable before upload: a
 * description one character over the limit, an icon whose file is not the size
 * it claims, a stray source map, a manifest version that disagrees with
 * package.json. `fitness/checks/manifest-permissions.ts` states the same problem
 * for the permission list — "a widened permission ships green, and the feedback
 * arrives at Web Store review". This script moves that feedback to the terminal.
 *
 * The store rules checked here are *store* rules, deliberately not filed as a
 * fitness function: ADR 0010 adopted four architectural characteristics after
 * evaluating candidates rather than collecting them, and package validity is a
 * publishing constraint rather than an architectural one. It follows the same
 * pattern the ADR describes for the checks that were already filed as tests —
 * `test/store-package.test.ts` imports these rules so they run on every PR
 * without needing a build, and this script applies them to the real artifact.
 *
 *     npm run package        # build, validate, zip
 *
 * The zip is written deterministically: entries in sorted order, every timestamp
 * pinned to the DOS epoch. Two runs from the same tree produce byte-identical
 * archives, so "did this change?" is answerable with a checksum rather than by
 * unzipping and diffing.
 */
import { deflateRawSync, crc32 } from 'node:zlib';
import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* -------------------------------------------------------------------------- */
/* Store rules                                                                 */
/* -------------------------------------------------------------------------- */

/** Every icon size the store and the browser UI ask for. */
export const REQUIRED_ICON_SIZES = [16, 32, 48, 128];

/**
 * Chrome's own limits, not ours. `description` at 132 is the one that actually
 * bites — it is short enough that an ordinary sentence overruns it, and the
 * failure arrives from the dashboard rather than from the browser.
 */
export const LIMITS = { name: 75, description: 132 };

/** Chrome accepts one to four dot-separated integers, each 0–65535, no leading zeros. */
export const VERSION_PATTERN = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/;

/**
 * Files that must never reach the store. Source maps are the live risk: tsup
 * emits them on a flag, they inflate the package, and they publish the original
 * sources to anyone who unzips a CRX.
 */
const FORBIDDEN = [/\.map$/, /^manifest\.safari\.json$/, /(^|\/)\.DS_Store$/];

/**
 * The pure rule, so `test/store-package.test.ts` can run it against the
 * repository's `public/manifest.json` with no build in the way.
 *
 * `iconDimensions` maps a declared icon path to its actual pixel width, or
 * `null` when the file is missing. Passing it in rather than reading files here
 * keeps this function pure and lets the test supply fixtures.
 */
export function storeViolations(manifest, iconDimensions, packageVersion) {
  const problems = [];
  const say = (detail) => problems.push(detail);

  if (manifest.manifest_version !== 3) {
    say(`manifest_version is ${manifest.manifest_version}; the store accepts only 3.`);
  }

  if (!VERSION_PATTERN.test(manifest.version ?? '')) {
    say(`version "${manifest.version}" is not a store-legal version string.`);
  }

  // A version already accepted by the store can never be reused, so shipping
  // one that disagrees with package.json means the next release has to guess
  // which number was actually published.
  if (packageVersion !== undefined && manifest.version !== packageVersion) {
    say(`manifest version ${manifest.version} disagrees with package.json ${packageVersion}.`);
  }

  for (const [field, limit] of Object.entries(LIMITS)) {
    const value = manifest[field];
    if (!value) say(`${field} is empty; the store requires it.`);
    else if (value.length > limit) {
      say(`${field} is ${value.length} characters; the store allows ${limit}.`);
    }
  }

  for (const size of REQUIRED_ICON_SIZES) {
    const declared = manifest.icons?.[String(size)];
    if (!declared) {
      say(`icons.${size} is not declared; Chrome will upscale a smaller icon for that slot.`);
      continue;
    }
    const actual = iconDimensions.get(declared);
    if (actual === null || actual === undefined) say(`icons.${size} points at ${declared}, which is missing.`);
    else if (actual !== size) say(`icons.${size} points at ${declared}, which is ${actual}px wide.`);
  }

  // Remote code is the single most common rejection reason for an extension
  // that is otherwise fine, and a relaxed CSP is how it arrives.
  const csp = manifest.content_security_policy?.extension_pages;
  if (csp && /unsafe-eval|https?:/.test(csp)) {
    say(`content_security_policy allows remote or evaluated code: "${csp}".`);
  }

  return problems;
}

/** Reads a PNG's width from its IHDR chunk. Returns null if absent or not a PNG. */
async function pngWidth(path) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    return null;
  }
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return bytes.readUInt32BE(16);
}

/* -------------------------------------------------------------------------- */
/* Deterministic zip                                                            */
/* -------------------------------------------------------------------------- */

/** 1980-01-01 00:00, the earliest timestamp the format can express. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const sum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, deflated);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk
    dir.writeUInt16LE(0, 36); // internal attrs
    dir.writeUInt32LE(0o644 << 16, 38); // external attrs: regular file, rw-r--r--
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);

    offset += local.length + nameBytes.length + deflated.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

/** Every file under `dir`, as store-relative POSIX paths, sorted. */
async function collect(dir, base = dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await collect(full, base)));
    else found.push(relative(base, full).split(sep).join('/'));
  }
  return found.sort();
}

/* -------------------------------------------------------------------------- */

async function main() {
  const dist = join(root, 'dist');
  try {
    await stat(dist);
  } catch {
    fail(['dist/ does not exist. Run `npm run build` first, or use `npm run package`.']);
  }

  const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
  const { version: packageVersion } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

  const iconDimensions = new Map();
  for (const declared of Object.values(manifest.icons ?? {})) {
    iconDimensions.set(declared, await pngWidth(join(dist, declared)));
  }

  const problems = storeViolations(manifest, iconDimensions, packageVersion);

  const names = await collect(dist);
  for (const name of names) {
    const offender = FORBIDDEN.find((pattern) => pattern.test(name));
    if (offender) problems.push(`dist/${name} must not ship to the store (matched ${offender}).`);
  }
  if (!names.includes('manifest.json')) problems.push('dist/manifest.json is missing.');

  if (problems.length > 0) fail(problems);

  const entries = await Promise.all(
    names.map(async (name) => ({ name, data: await readFile(join(dist, name)) })),
  );
  const archive = zip(entries);

  await mkdir(join(root, 'release'), { recursive: true });
  const out = join(root, 'release', `glassfrog-clipper-${manifest.version}.zip`);
  await writeFile(out, archive);

  console.log(`${relative(root, out)}  ${archive.length} bytes, ${entries.length} files`);
  for (const { name, data } of entries) console.log(`  ${name}  ${data.length}`);
  console.log(
    `\nUpload at https://chrome.google.com/webstore/devconsole — see docs/store/chrome-web-store-listing.md`,
  );
}

function fail(problems) {
  for (const problem of problems) console.error(`::error::${problem}`);
  console.error(`\n${problems.length} problem(s); no package written.`);
  process.exit(1);
}

// Importable by the test without running the packaging.
if (process.argv[1] && process.argv[1].endsWith('package-chrome.mjs')) await main();

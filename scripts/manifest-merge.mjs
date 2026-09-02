/**
 * Merges the Safari manifest overlay over the Chrome manifest.
 *
 * Pure and separate from the build script so a test can exercise it without
 * running a build — the merged permission list is a stop condition under the
 * Definition of Done, and a stop condition that is only checked by looking at
 * build output is not checked.
 *
 * A key whose overlay value is `null` is removed. Anything else replaces
 * wholesale rather than deep-merging: a half-merged permission array is exactly
 * the silent widening manifest.test.ts exists to prevent.
 */
export function mergeManifest(base, overlay) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    // Documentation for the human reading the overlay, not a manifest key.
    if (key === '$comment') continue;
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

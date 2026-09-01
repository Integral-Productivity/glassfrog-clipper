/**
 * Artifact checks for the built service-worker bundle.
 *
 * The rule graduated into `fitness/checks/bundle-shape.ts` (issue #69) and is
 * now reported by `npm run fitness:self` as well. This file stays as its entry
 * point so `.github/workflows/ci.yml`'s "Check the service worker bundle" step
 * keeps working unchanged — there is one implementation, called from two
 * places, rather than two implementations that drift.
 *
 * Run after `npm run build`. Exits non-zero with a message naming the cause.
 */
import { runBundleShapeCheck } from '../fitness/checks/bundle-shape.ts';

const result = await runBundleShapeCheck();

if (!result.compliant) {
  for (const violation of result.violations) {
    console.error(`::error::${violation.where} ${violation.detail}`);
  }
  process.exit(1);
}

console.log(result.summary);

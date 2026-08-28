import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/background.ts', 'src/popup.ts', 'src/options.ts'],
  outDir: 'dist',
  format: ['esm'],
  // Keep in step with `minimum_chrome_version` in public/manifest.json.
  target: 'chrome120',
  splitting: false,
  clean: true,
  // An MV3 service worker has no module resolver, so a bare specifier left in
  // the output fails registration. tsup externalizes `dependencies` by default;
  // this forces the SDK into the bundle.
  noExternal: [/^@integral-productivity\//],
});

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/background.ts', 'src/popup.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'chrome120',
  splitting: false,
  clean: true,
});

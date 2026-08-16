import { defineConfig } from 'tsdown'

/**
 * The interactive front door ships one node bundle. pi-tui, diff, and saxes
 * are runtime dependencies of the installing tree (the profile module
 * fallback links them), so they stay external; the Loader imports the plugin
 * by package name and resolves them from the same tree.
 */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})

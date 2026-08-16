import { defineConfig } from 'tsdown'

/**
 * Mirrors the dsh-tui bundle: tsc first emits src → lib/types (JS + d.ts,
 * declaration consumers read lib/types directly), then tsdown bundles the
 * emitted JS into one node file per export. cordis peers and commander stay
 * external; the Loader imports the plugin by package name and resolves them
 * from the host tree.
 */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/startup.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})

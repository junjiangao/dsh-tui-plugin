import { defineConfig } from 'tsdown'

/**
 * The git-installable root bundle: one self-contained ESM file per entry.
 * pi-tui (with this workspace patch applied), diff, saxes, commander, and
 * marked are BUNDLED in — the profile pnpm install must not need them from
 * a registry, and baking pi-tui in is how the editor patch ships. Only the
 * @deepseek-ai/* seam stays external: the host closure provides it through
 * the profiles fallback links. The artifacts land in lib/ and are COMMITTED,
 * so a git install needs no build step (CI re-builds and diffs them).
 */
export default defineConfig({
  entry: {
    tui: 'packages/tui/src/index.ts',
    startup: 'packages/tui-app/src/startup.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  bundle: true,
  external: [/^@deepseek-ai\//],
  dts: false,
  clean: false,
  minify: false,
})

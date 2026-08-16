import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * The workspace test suite: both packages' specs run headless (the TUI is
 * driven through tests/headless-terminal.ts over @xterm/headless). The alias
 * resolves the workspace-internal peer @deepseek-ai/dsh-tui to its source so
 * tui-app specs import the sibling package without a prior build.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-tui': resolve(__dirname, 'packages/tui/src/index.ts'),
    },
  },
  test: {
    include: ['packages/tui/tests/**/*.spec.ts', 'packages/tui-app/tests/**/*.spec.ts'],
  },
})

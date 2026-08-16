/**
 * The Cordis entry fails loud on a non-TTY pair before any terminal takeover:
 * raw mode, the alternate screen, and the cursor never change state, and the
 * error names the interactive requirement.
 */

import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import * as tui from '../src/index.ts'

describe('tui entry', () => {
  it('fails loud on a non-TTY stdin or stdout without touching the terminal', () => {
    const originalStdin = process.stdin.isTTY
    const originalStdout = process.stdout.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    try {
      expect(() => { tui.apply(new Context(), {}) })
        .toThrow(/both stdin and stdout must be TTYs/)
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdin, configurable: true })
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdout, configurable: true })
    }
  })

  it('disposes the whole root and reports the exit code once', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const exits: number[] = []
    tui.disposeRootAndExit(ctx, 7, code => void exits.push(code))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(exits).toEqual([7])
  })
})

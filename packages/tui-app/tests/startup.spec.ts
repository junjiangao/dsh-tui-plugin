/**
 * The terminal app's ordinary command-line provider over a real Loader tree:
 * the flags become injected tui-row config, while help and usage errors leave
 * the consumer pending.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { TUI_STARTUP_SERVICE as TUI_SERVICE_KEY } from '@deepseek-ai/dsh-tui'
import { afterEach, describe, expect, it } from 'vitest'
import { TUI_STARTUP_SERVICE, apply, type TuiStartupValues } from '../src/startup.ts'

/** What one boot of the fixture tree observed. */
interface Observed {
  exits: number[]
  out: string
  tuiConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/**
 * Mount the real provider over a tui-row stand-in.
 * @param args - the invocation's inner arguments.
 * @param tty - whether stdin/stdout report as TTYs.
 * @returns the resolved service value and observed row/process effects.
 */
async function bootStartup(
  args: string[],
  tty = true,
): Promise<{ startup: TuiStartupValues | undefined; observed: Observed }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-startup-'))
  const observed: Observed = { exits: [], out: '' }
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  writeFileSync(join(dir, 'row.mjs'), 'export function apply(_ctx, config) { globalThis.__tuiStartupObserved.tuiConfig = config }\n')
  // Loader imports through Node's resolver, so this fixture delegates to the
  // source-plane plugin already imported by the test.
  writeFileSync(join(dir, 'startup.mjs'), `
export const name = 'tui-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__tuiStartupApply(ctx)
`)
  const rowUrl = pathToFileURL(join(dir, 'row.mjs')).href
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: tui',
    `  name: ${rowUrl}`,
    `  inject: [${TUI_STARTUP_SERVICE}]`,
    '  config:',
    "    sessionId: !!js ctx.tuiStartup.resumeSessionId ?? ctx.tuiStartup.sessionId ?? 'main'",
    '    model: !!js ctx.tuiStartup.model',
    '- id: tui-startup',
    `  name: ${pathToFileURL(join(dir, 'startup.mjs')).href}`,
    '',
  ].join('\n'))
  const originalIsTty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY }
  Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: tty, configurable: true })
  const globals = globalThis as unknown as {
    __tuiStartupApply: typeof apply
    __tuiStartupObserved: Observed
  }
  globals.__tuiStartupApply = apply
  globals.__tuiStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => {
    await ctx.fiber.dispose()
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTty.stdin, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTty.stdout, configurable: true })
  })
  return {
    startup: ctx.get(TUI_STARTUP_SERVICE),
    observed,
  }
}

describe('tui command-line provider', () => {
  it('publishes under the same service key the tui row reads', () => {
    // The root bundle's startup entry is self-contained and duplicates the
    // key; any drift here would silently disconnect the flags from the row.
    expect(TUI_STARTUP_SERVICE).toBe(TUI_SERVICE_KEY)
  })

  it('publishes every named flag into the tui-row config', async () => {
    const { startup, observed } = await bootStartup(['--resume', 'sess-1', '--model', 'deepseek-official/deepseek-v4-pro', '--tool-mode', 'code', '--preset', 'minimal'])
    expect(startup).toEqual({ resumeSessionId: 'sess-1', model: 'deepseek-official/deepseek-v4-pro', toolMode: 'code', preset: 'minimal' })
    expect(observed.tuiConfig).toEqual({ sessionId: 'sess-1', model: 'deepseek-official/deepseek-v4-pro' })
    expect(observed.exits).toEqual([])
  })

  it('resolves --session to the fresh-session identity when no --resume is given', async () => {
    const { startup, observed } = await bootStartup(['--session', 'explicit-id'])
    expect(startup).toEqual({ sessionId: 'explicit-id' })
    expect(observed.tuiConfig).toEqual({ sessionId: 'explicit-id', model: undefined })
  })

  it('mints a unique fresh-session identity when no session flag is given', async () => {
    const first = await bootStartup([])
    const second = await bootStartup([])
    const idPattern = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
    expect(first.startup?.sessionId).toMatch(idPattern)
    expect(first.observed.tuiConfig).toEqual({ sessionId: first.startup?.sessionId, model: undefined })
    expect(second.startup?.sessionId).toMatch(idPattern)
    expect(second.startup?.sessionId).not.toBe(first.startup?.sessionId)
  })

  it.each([
    { args: ['--resume', 'a', '--session', 'b'], reason: 'resume and session conflict' },
    { args: ['--tool-mode', 'hybrid'], reason: 'invalid tool mode' },
    { args: ['--model', 'novalue'], reason: 'model without a provider' },
    { args: ['--preset', 'Not-A-Valid-Id'], reason: 'preset id that is not a roster directory name' },
  ])('rejects $reason', async ({ args }) => {
    const { startup, observed } = await bootStartup(args)
    expect(observed.out).toContain('error:')
    expect(startup).toBeUndefined()
    expect(observed.tuiConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('prints its own help and leaves the tui row pending', async () => {
    const { startup, observed } = await bootStartup(['--help'], false)
    expect(observed.out).toContain('dsh --profile tui')
    expect(startup).toBeUndefined()
    expect(observed.tuiConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })

  it('fails loud on a non-TTY stdin or stdout', async () => {
    const { startup, observed } = await bootStartup([], false)
    expect(observed.out).toContain('interactive TTYs')
    expect(startup).toBeUndefined()
    expect(observed.tuiConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })
})

/**
 * The mounted `ctx.tui` extension service through the live channel: the
 * semantic theme facade, the overlay placement, error containment, and
 * owner-disposal settlement.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { TuiComponent } from '../src/extension/types.ts'
import { createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

async function setup(): Promise<{
  harness: Awaited<ReturnType<typeof createTuiTestHarness<HeadlessTerminal, (code: number) => void>>>
  terminal: HeadlessTerminal
}> {
  const terminal = new HeadlessTerminal(96, 36)
  const harness = await createTuiTestHarness(terminal, () => {}, {})
  await terminal.waitForFrame()
  return { harness, terminal }
}

/**
 * Poll the terminal until the predicate holds. pi-tui throttles renders to
 * its 16ms minimum interval, and a mid-render failure settles its overlay
 * before the follow-up frame lands, so an assertion may need to look past
 * the first post-settlement frame.
 */
async function waitForSnapshot(
  terminal: HeadlessTerminal,
  predicate: (snapshot: string) => boolean,
  timeoutMs = 2_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    if (predicate(snapshot)) return snapshot
    if (Date.now() >= deadline) {
      throw new Error(`snapshot did not satisfy the predicate within ${timeoutMs}ms`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

describe('ctx.tui extension overlays in the live channel', () => {
  it('opens an overlay through the theme facade and closes it', async () => {
    const { harness, terminal } = await setup()
    const session = harness.ctx.tui.openOverlay({
      create: (host) => {
        const component: TuiComponent = {
          render: () => [
            host.theme.bold(host.theme.accent('Extension overlay')),
            host.theme.text(host.theme.brand('branded')),
            host.theme.dim(`view ${host.viewport.columns}x${host.viewport.rows}`),
            host.theme.success('ok') + host.theme.warning('warn'),
            host.theme.error(host.display('raw\u0007text')),
          ],
          invalidate() {},
        }
        return component
      },
      options: { width: 40, maxHeight: 10, anchor: 'center', margin: { top: 1, left: 2 } },
    })
    await terminal.waitForFrame()
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Extension overlay')
    expect(snapshot).toContain('branded')
    expect(snapshot).toContain('view 96x36')
    expect(snapshot).toContain('raw\\\\x07text')
    expect(session.state).toBe('active')
    await session.close()
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('Extension overlay')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('contains an overlay render failure as a notice and an error settlement', async () => {
    const { harness, terminal } = await setup()
    const session = harness.ctx.tui.openOverlay({
      create: () => ({
        render: () => { throw new Error('overlay boom') },
        invalidate() {},
      }),
    })
    const outcome = await session.closed
    expect(outcome).toEqual({ reason: 'error', error: expect.any(Error) as Error })
    const snapshot = await waitForSnapshot(
      terminal,
      value => value.includes('TUI overlay failed: overlay boom'),
    )
    expect(snapshot).toContain('TUI overlay failed: overlay boom')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('settles an overlay owner-disposed when its fiber unloads', async () => {
    const { harness, terminal } = await setup()
    const settled = new Promise<unknown>((resolve) => {
      const fiber = harness.ctx.plugin((ctx: Context) => {
        const session = ctx.tui.openOverlay({
          create: () => ({
            render: () => ['owned overlay'],
            invalidate() {},
          }),
        })
        void session.closed.then(resolve)
      })
      setTimeout(() => void fiber.dispose(), 20)
    })
    const outcome = await settled
    expect(outcome).toEqual({ reason: 'owner-disposed' })
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

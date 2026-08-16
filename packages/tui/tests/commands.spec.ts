/**
 * Slash commands through the live channel: the agent-scoped registrations,
 * the /goal lifecycle (create/show/edit/pause/resume/clear) through the real
 * command-goal producer, and the goal status row from the projection feed.
 */

import { describe, expect, it } from 'vitest'
import GoalService from '@deepseek-ai/dsh-goal'
import * as commandGoal from '@deepseek-ai/dsh-command-goal'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

async function setup(): Promise<{
  harness: Awaited<ReturnType<typeof createTuiTestHarness<HeadlessTerminal, (code: number) => void>>>
  terminal: HeadlessTerminal
}> {
  const terminal = new HeadlessTerminal(96, 36)
  const harness = await createTuiTestHarness(terminal, () => {}, {})
  await harness.ctx.plugin(GoalService)
  await harness.ctx.plugin(commandGoal)
  // The /resume command reads the session query service; the TUI only
  // consumes listSessions and the title batch, so a stub answers for the
  // engine's own tests.
  harness.ctx.provide('sessionQuery', {
    listSessions: async () => [{
      header: { id: 'persisted-1', cwd: '/workspace', createdAt: 1_700_000_000_000 },
      live: false,
      persisted: true,
    }],
    readTitleSnapshots: async (ids: readonly string[]) => ids.map(sessionId => ({
      sessionId,
      status: 'fulfilled',
      value: { session: { id: sessionId, createdAt: 1_700_000_000_000 } },
    })),
  } as never)
  await terminal.waitForFrame()
  return { harness, terminal }
}

/** Type a line into the editor and submit it. */
async function submit(terminal: HeadlessTerminal, line: string): Promise<void> {
  terminal.send(line)
  await terminal.waitForFrame()
  terminal.send('\r')
}

describe('slash commands in the live channel', () => {
  it('runs the /goal lifecycle and refreshes the goal status row', async () => {
    const { harness, terminal } = await setup()
    // The /goal grammar treats any non-control input as the objective.
    await submit(terminal, '/goal do the thing')
    await terminal.waitForFrame()
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Goal created')
    expect(snapshot).toContain('Status: active')
    // The projection change feed appended the compact status row.
    expect(snapshot).toContain('goal: active · 0/256 · armed')

    // A bare /goal line shows the current goal.
    await submit(terminal, '/goal')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Goal')
    expect(snapshot).toContain('Objective: do the thing')

    await submit(terminal, '/goal edit the other thing')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Goal updated')
    expect(snapshot).toContain('Objective: the other thing')

    await submit(terminal, '/goal pause')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Goal paused')
    expect(snapshot).toContain('Status: paused')
    expect(snapshot).toContain('goal: paused · 0/256 · disarmed')

    await submit(terminal, '/goal resume')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Goal resumed')
    expect(snapshot).toContain('goal: active · 0/256 · armed')

    await submit(terminal, '/goal clear')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Goal cleared.')
    // The durable goal is gone; the earlier status rows stay as history.
    expect(harness.ctx.goals.get(harness.agent)).toBeUndefined()
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('reports unknown commands and lists registrations via /help', async () => {
    const { harness, terminal } = await setup()
    await submit(terminal, '/nope')
    await terminal.waitForFrame()
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Unknown command: /nope')

    await submit(terminal, '/help')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Keyboard shortcuts')
    // Rows truncate to the terminal width, so each assertion names a prefix.
    expect(snapshot).toContain('/goal [<objective>|clear|edit <objective>|pause|resume] — set or view the goal')
    expect(snapshot).toContain('/help — Show keyboard shortcuts and commands')
    expect(snapshot).toContain('/exit — Exit after the active turn reaches idle')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('applies /details, /palette, /status, /model, and /resume', async () => {
    const { harness, terminal } = await setup()
    await submit(terminal, '/details hidden reasoning off')
    await terminal.waitForFrame()
    await submit(terminal, '/palette')
    await terminal.waitForFrame()
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Palette')
    expect(snapshot).toContain('Colors — exactly one per span')

    await submit(terminal, '/status')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Session status')
    expect(snapshot).toContain('Session:')
    expect(snapshot).toContain('main-session')
    expect(snapshot).toContain('deepseek-official/deepseek-v4-flash')

    // A bare /model line opens the selector with the catalog and the current
    // route; Esc closes it again.
    await submit(terminal, '/model')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Select model')
    expect(snapshot).toContain('deepseek-official/deepseek-v4-')
    terminal.send('\x1b')
    await terminal.waitForFrame()
    // Selecting a different advertised model applies it and reports the route.
    await submit(terminal, '/model deepseek-official/deepseek-v4-pro')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Model selected: deepseek-official/deepseek-v4-pro')
    // The status footer follows the selection, including its default effort.
    expect(snapshot).toContain('model deepseek-v4-pro high')

    await submit(terminal, '/resume')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Resume session')
    expect(snapshot).toContain('persisted-1')
    terminal.send('\x1b')
    await terminal.waitForFrame()
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('clears the transcript with /clear without touching the session log', async () => {
    const { harness, terminal } = await setup()
    harness.session.append('user/message', {
      turn: 1,
      content: [{ type: 'text', text: 'seed' }],
      source: { kind: 'user' },
    } as never, { surfaceOp: 'append' } as never)
    await terminal.waitForFrame()
    await submit(terminal, '/clear')
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('seed')
    expect(harness.session.events.length).toBeGreaterThan(0)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
  it('reports an unset model route and details parse errors', async () => {
    const { harness, terminal } = await setup()
    // The fake agent starts with a default route; clear both the agent
    // options and the shared selection for the unset paths.
    Object.assign(harness.agent, { options: {} })
    harness.selection.current = undefined
    await submit(terminal, '/status')
    await terminal.waitForFrame()
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Model:')
    expect(snapshot).toContain('unset')
    await submit(terminal, '/model')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Select model')
    terminal.send('\x1b')
    await terminal.waitForFrame()

    // A route without a provider names the placeholder provider.
    Object.assign(harness.agent, { options: { model: 'only-model' } })
    harness.selection.current = { provider: 'provider', model: 'only-model' }
    await submit(terminal, '/status')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('provider/only-model')
    // An unadvertised model is rejected by the selector.
    await submit(terminal, '/model provider/only-model')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Unknown model: provider/only-model. Run /model to list available models.')

    await submit(terminal, '/details collapsed collapsed')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Duplicate visibility \\"collapsed\\"')
    await submit(terminal, '/details reasoning reasoning')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Duplicate reasoning keyword')
    await submit(terminal, '/details on')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('requires the reasoning keyword')
    // Each single-argument form applies its own half of /details.
    await submit(terminal, '/details collapsed')
    await terminal.waitForFrame()
    await submit(terminal, '/details reasoning on')
    await terminal.waitForFrame()
    await submit(terminal, '/details nope')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Unknown /details argument \\"nope\\"')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('reports an unavailable or empty session listing', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    await harness.ctx.plugin(GoalService)
    await harness.ctx.plugin(commandGoal)
    // No sessionQuery in this composition: /resume explains itself.
    await terminal.waitForFrame()
    await submit(terminal, '/resume')
    await terminal.waitForFrame()
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Resume is not available: session query is not mounted.')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()

    const terminal2 = new HeadlessTerminal(96, 36)
    const harness2 = await createTuiTestHarness(terminal2, () => {}, {})
    await harness2.ctx.plugin(GoalService)
    await harness2.ctx.plugin(commandGoal)
    harness2.ctx.provide('sessionQuery', {
      listSessions: async () => [
        { header: { id: 'cwdless', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
      ],
      readTitleSnapshots: async (ids: readonly string[]) => ids.map(sessionId => ({
        sessionId,
        status: 'fulfilled',
        value: { session: { id: sessionId, createdAt: 1_700_000_000_000 } },
      })),
    } as never)
    await terminal2.waitForFrame()
    await submit(terminal2, '/resume')
    await terminal2.waitForFrame()
    snapshot = await terminal2.snapshot({ includeScrollback: true })
    // The cwd-less row sits outside the workspace scope, so Tab reveals it.
    expect(snapshot).toContain('Resume session')
    expect(snapshot).toContain('No matching sessions.')
    terminal2.send('\t')
    await terminal2.waitForFrame()
    snapshot = await terminal2.snapshot({ includeScrollback: true })
    // The picker opens with the cwd-less row disabled and names the reason.
    expect(snapshot).toContain('cwdless')
    expect(snapshot).toContain('unavailable: session has no recorded workspace')
    terminal2.send('\x1b')
    await terminal2.waitForFrame()
    await disposeTuiTestHarness(harness2)
    await terminal2.dispose()

    // An empty listing names the empty state.
    const terminal3 = new HeadlessTerminal(96, 36)
    const harness3 = await createTuiTestHarness(terminal3, () => {}, {})
    await harness3.ctx.plugin(GoalService)
    await harness3.ctx.plugin(commandGoal)
    harness3.ctx.provide('sessionQuery', {
      listSessions: async () => [],
      readTitleSnapshots: async () => [],
    } as never)
    await terminal3.waitForFrame()
    await submit(terminal3, '/resume')
    await terminal3.waitForFrame()
    snapshot = await terminal3.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Resume session')
    expect(snapshot).toContain('No matching sessions.')
    terminal3.send('\x1b')
    await terminal3.waitForFrame()
    await disposeTuiTestHarness(harness3)
    await terminal3.dispose()
  })

  it('contains a failing and an aborted command execution', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    await harness.ctx.plugin(GoalService)
    await harness.ctx.plugin(commandGoal)
    harness.ctx.provide('sessionQuery', {
      listSessions: async () => { throw new Error('listing exploded') },
    } as never)
    await terminal.waitForFrame()
    await submit(terminal, '/resume')
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Resume session scan failed: listing exploded')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()

    // A command that settles after shutdown starts lands silently: the
    // disposal aborts the controller and the late settle sees the channel
    // already gone.
    const terminal2 = new HeadlessTerminal(96, 36)
    const harness2 = await createTuiTestHarness(terminal2, () => {}, {})
    await harness2.ctx.plugin(GoalService)
    await harness2.ctx.plugin(commandGoal)
    harness2.ctx.provide('sessionQuery', {
      listSessions: async () => { await new Promise(resolve => setTimeout(resolve, 10)); return [] },
    } as never)
    await terminal2.waitForFrame()
    terminal2.send('/resume')
    await terminal2.waitForFrame()
    terminal2.send('\r')
    // Dispose synchronously after the submit, before the handler settles.
    await harness2.controller.dispose()
    await terminal2.dispose()
  })

  it('ignores goal changes from sessions this terminal does not drive', async () => {
    const { harness, terminal } = await setup()
    await submit(terminal, '/goal run other')
    await terminal.waitForFrame()
    const other = harness.ctx.sessions.create(SessionId('other-session'))
    other.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: { id: 'goal-other' as never, revision: 1, objective: 'other', phase: 'active', maxGoalRounds: 10 },
      roundsStarted: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('goal: active · 0/10')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('paints the palette on when colors are enabled', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      config: { theme: { color: true } },
    })
    await harness.ctx.plugin(GoalService)
    await harness.ctx.plugin(commandGoal)
    await terminal.waitForFrame()
    await submit(terminal, '/palette')
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('dark scheme · color on')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

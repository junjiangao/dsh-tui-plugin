import { describe, expect, it } from 'vitest'
import { appendUser, createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'
import type { Session } from '@deepseek-ai/dsh-session'

/** Seed `count` user turns, each with a short assistant reply. */
function seedTurns(session: Session, count: number): void {
  for (let turn = 1; turn <= count; turn += 1) {
    session.append('turn/start', { turn })
    appendUser(session, `turn-${turn} question`)
    session.append('step/start', { turn, step: 1 })
    session.append('assistant/message', {
      turn,
      step: 1,
      message: {
        id: `answer-${turn}` as never,
        role: 'assistant',
        content: [{ type: 'text', text: `turn-${turn} answer` }],
        source: { kind: 'model', provider: 'mock', model: 'm' },
      },
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
}

describe('long-session performance', () => {
  it('mounts a huge log within the visible window, not the whole log', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const startedAt = performance.now()
    const harness = await createTuiTestHarness(terminal, () => {}, {
      config: { maxInitialMessages: 50, historyPageSize: 100 },
      beforeMount: (session) => { seedTurns(session, 2_000) },
    })
    const elapsed = performance.now() - startedAt
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    // The newest window renders; the earliest turns never entered the tree.
    expect(snapshot).toContain('turn-2000 question')
    expect(snapshot).toContain('turn-1951 question')
    expect(snapshot).not.toContain('turn-1 question')
    // Mounting a 2k-turn log stays comfortably under the frame budget.
    expect(elapsed).toBeLessThan(1_000)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('keeps steady-state keystrokes within the frame budget', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      beforeMount: (session) => { seedTurns(session, 500) },
    })
    await terminal.waitForFrame()
    // Type a 40-character line one chunk at a time and measure the whole
    // interaction; the per-key average must stay far below the frame budget.
    const startedAt = performance.now()
    const line = 'steady keystroke latency measurement line'
    for (const character of line) {
      terminal.send(character)
    }
    await terminal.waitForFrame()
    const elapsed = performance.now() - startedAt
    const perKey = elapsed / line.length
    expect(perKey).toBeLessThan(50)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('releases timers across repeated running mount/teardown cycles', async () => {
    const cycles = async (): Promise<void> => {
      const terminal = new HeadlessTerminal(96, 36)
      const harness = await createTuiTestHarness(terminal, () => {}, { status: 'running' })
      await terminal.waitForFrame()
      // Let the status interval fire before teardown.
      await new Promise(resolve => setTimeout(resolve, 30))
      await disposeTuiTestHarness(harness)
      await terminal.dispose()
    }
    // One warm cycle, then let the framework's own timers settle.
    await cycles()
    await new Promise(resolve => setTimeout(resolve, 50))
    const baseline = process.getActiveResourcesInfo().filter(type => type === 'Timeout').length
    for (let index = 0; index < 20; index += 1) await cycles()
    await new Promise(resolve => setTimeout(resolve, 50))
    // A leaked status interval would keep a Timeout handle alive per cycle;
    // framework-timer teardown jitter is bounded to one or two handles.
    expect(process.getActiveResourcesInfo().filter(type => type === 'Timeout').length)
      .toBeLessThanOrEqual(baseline + 2)
  })
})

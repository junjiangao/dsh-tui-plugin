import { describe, expect, it } from 'vitest'
import { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { appendChunk, appendStepStart, appendUser, createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

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

/** Set the fake agent running and publish the status transition. */
function setRunning(harness: { ctx: import('@deepseek-ai/cordis').Context; agent: { status: string } }): void {
  harness.agent.status = 'running'
  emitAgentEvent(harness.ctx, harness.agent as never, 'agent/status', { status: 'running' })
}

async function submit(terminal: HeadlessTerminal, line: string): Promise<void> {
  terminal.send(line)
  await terminal.waitForFrame()
  terminal.send('\r')
}

describe('status footer and terminal title', () => {
  it('shows phase glyph, elapsed, and queued steering while running', async () => {
    let clock = 10_000
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      runtime: { now: () => clock },
    })
    await terminal.waitForFrame()
    // Steer a message while running: it stays queued until the inbox claims it.
    setRunning(harness)
    clock += 1_500
    await submit(terminal, 'continue please')
    let snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('1 queued') && snapshot.includes('1.5s'))
    expect(snapshot).toContain('1 queued')
    expect(snapshot).toContain('1.5s')
    // An open step adds its phase glyph.
    appendStepStart(harness.session)
    appendChunk(harness.session, 'working', 0)
    await terminal.waitForFrame()
    snapshot = await waitForSnapshot(terminal, snapshot => snapshot.includes('● responding'))
    expect(snapshot).toContain('● responding')
    // Back to idle: the elapsed and queued segments disappear.
    clock += 1_000
    harness.agent.status = 'idle'
    emitAgentEvent(harness.ctx, harness.agent as never, 'agent/status', { status: 'idle' })
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('1 queued')
    expect(snapshot).toContain('idle ·')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('shows token buckets, cache rate, and context occupancy', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      tokenMeter: { measure: () => ({ totalTokens: 42_000 }) },
    })
    await terminal.waitForFrame()
    harness.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'deepseek-v4-flash' } }),
      usage: { inputTokens: 1_250, outputTokens: 340, cacheReadTokens: 3_000, cacheWriteTokens: 250 },
    }, { surfaceOp: 'append' })
    // The context-window resolution lands asynchronously; poll for the full footer.
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('↑1.3k ↓340 · cache 67%') && snapshot.includes('33% context'))
    expect(snapshot).toContain('↑1.3k ↓340 · cache 67%')
    expect(snapshot).toContain('33% context')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('truncates the footer on a narrow terminal', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      tokenMeter: { measure: () => ({ totalTokens: 42_000 }) },
    })
    await terminal.waitForFrame()
    terminal.resize(44, 36)
    // A resize alone does not re-run the footer's truncation; the next render
    // re-measures against the new width.
    appendUser(harness.session, 'narrow now')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('…') && snapshot.includes('model deepseek'))
    expect(snapshot).toContain('model deepseek…')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('ticks the footer on the status interval while running', async () => {
    let clock = 10_000
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      runtime: { now: () => clock },
      config: { statusIntervalMs: 50 },
    })
    await terminal.waitForFrame()
    harness.agent.status = 'running'
    emitAgentEvent(harness.ctx, harness.agent as never, 'agent/status', { status: 'running' })
    // The interval drives a fresh render with the advancing clock.
    await new Promise(resolve => setTimeout(resolve, 80))
    clock += 60_000
    await new Promise(resolve => setTimeout(resolve, 80))
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('1m00.0s')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('updates the terminal title with the session title', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      config: { title: 'DSH test' },
    })
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('title "DSH test"')
    harness.session.append('session/title', {
      title: 'My session',
      messageSeqs: [],
      source: { kind: 'fallback' },
    })
    const updated = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('title "My session — DSH test"'))
    expect(updated).toContain('title "My session — DSH test"')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

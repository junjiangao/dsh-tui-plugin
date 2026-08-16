import { describe, expect, it } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { appendUser, createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'
import { mountWindowStart } from '../src/index.ts'

/** Seed a session with `count` user turns, each with an assistant reply. */
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

describe('mountWindowStart', () => {
  it('windows to the newest user messages and aligns to a boundary', () => {
    // 5 user messages with no boundary events; the window of 3 opens at the
    // third-from-last user message.
    const windowed = [
      { type: 'user/message', seq: 1, time: 2, data: createUserMessage({ content: [{ type: 'text', text: 'a' }], source: { kind: 'user' } }) },
      { type: 'user/message', seq: 2, time: 3, data: createUserMessage({ content: [{ type: 'text', text: 'b' }], source: { kind: 'user' } }) },
      { type: 'user/message', seq: 3, time: 4, data: createUserMessage({ content: [{ type: 'text', text: 'c' }], source: { kind: 'user' } }) },
      { type: 'user/message', seq: 4, time: 5, data: createUserMessage({ content: [{ type: 'text', text: 'd' }], source: { kind: 'user' } }) },
      { type: 'user/message', seq: 5, time: 6, data: createUserMessage({ content: [{ type: 'text', text: 'e' }], source: { kind: 'user' } }) },
    ] as never
    // Window of 3 user messages: the third-from-last is 'c' at index 2; no
    // boundary event precedes it, so the window opens there.
    expect(mountWindowStart(windowed, 3)).toBe(2)
    // Injected (non-user) messages do not count toward the window.
    const injected = [
      { type: 'user/message', seq: 0, time: 1, data: createUserMessage({ content: [], source: { kind: 'plugin', plugin: 'goal' } }) },
      { type: 'user/message', seq: 1, time: 2, data: createUserMessage({ content: [{ type: 'text', text: 'x' }], source: { kind: 'user' } }) },
    ] as never
    expect(mountWindowStart(injected, 1)).toBe(1)
    // A window larger than the log replays everything.
    // An empty log starts at zero.
    expect(mountWindowStart([], 10)).toBe(0)
    expect(mountWindowStart(windowed, 99)).toBe(0)
  })

  it('aligns the window back to the nearest turn boundary', () => {
    const events = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } },
      { type: 'user/message', seq: 1, time: 2, data: createUserMessage({ content: [{ type: 'text', text: 'a' }], source: { kind: 'user' } }) },
      { type: 'user/message', seq: 2, time: 3, data: createUserMessage({ content: [{ type: 'text', text: 'b' }], source: { kind: 'user' } }) },
      { type: 'user/message', seq: 3, time: 4, data: createUserMessage({ content: [{ type: 'text', text: 'c' }], source: { kind: 'user' } }) },
    ] as never
    // The window of 1 ends at 'c' (seq 3); the alignment walk lands on the
    // turn/start at seq 0.
    expect(mountWindowStart(events, 1)).toBe(0)
  })
})

describe('transcript virtualization in the live channel', () => {
  it('mounts only the newest window and loads earlier pages on demand', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      config: { maxInitialMessages: 4, historyPageSize: 2 },
      beforeMount: (session) => { seedTurns(session, 10) },
    })
    await terminal.waitForFrame()
    // The newest four user turns are visible; the earliest ones are not.
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('turn-10 question')
    expect(snapshot).toContain('turn-7 question')
    expect(snapshot).not.toContain('turn-1 question')
    // /more loads the previous page; the load renders on the next frame.
    terminal.send('/more')
    await terminal.waitForFrame()
    terminal.send('\r')
    await new Promise(resolve => setTimeout(resolve, 80))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('turn-5 question')
    expect(snapshot).not.toContain('turn-1 question')
    // PageUp loads the next page, then the final one.
    terminal.send('\x1b[5~')
    await new Promise(resolve => setTimeout(resolve, 80))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('turn-3 question')
    terminal.send('\x1b[5~')
    await new Promise(resolve => setTimeout(resolve, 80))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('turn-1 question')
    // A further request reports the start.
    terminal.send('/more')
    await terminal.waitForFrame()
    terminal.send('\r')
    await new Promise(resolve => setTimeout(resolve, 80))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Already at the beginning of the transcript.')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('evicts tool and context cards and stops at a live streaming step', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      config: { cardCacheEntries: 100, transcriptResidentMaxBytes: 32 },
      beforeMount: (session) => {
        // Four settled steps in one turn (the eviction ledger drains the
        // turn's step list, then hits the deleted map for the fourth), a tool
        // card, a context card, and one open step that never ends.
        session.append('turn/start', { turn: 1 })
        appendUser(session, 'first')
        for (let step = 1; step <= 4; step += 1) {
          session.append('step/start', { turn: 1, step })
          session.append('assistant/message', {
            turn: 1,
            step,
            message: { id: `step-msg-${step}` as never, role: 'assistant', content: [{ type: 'text', text: `step-${step}` }], source: { kind: 'model', provider: 'mock', model: 'm' } },
          }, { surfaceOp: 'append' })
          session.append('step/end', { turn: 1, step })
        }
        session.append('tool/call', { turn: 1, step: 4, callId: CallId('c1'), name: 'bash', arguments: '{"command":"ls"}' })
        session.append('tool/result', {
          turn: 1,
          step: 4,
          message: { id: 'result-c1' as never, role: 'user', content: [{ type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: 'ok' }] }], source: { kind: 'tool', callId: CallId('c1') } },
        }, { surfaceOp: 'append' })
        // The open step precedes the context card so the eviction pass
        // re-arms the live step once before draining the card behind it.
        session.append('step/start', { turn: 1, step: 5 })
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'injected context' }],
          source: { kind: 'plugin', plugin: 'goal' },
        }), { surfaceOp: 'append' })
      },
    })
    await terminal.waitForFrame()
    await new Promise(resolve => setTimeout(resolve, 50))
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    // The live step stays; older settled rows and cards evicted.
    expect(snapshot).toContain('Assistant')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('evicts the oldest resident rows when the budgets overflow', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      config: { cardCacheEntries: 4, transcriptResidentMaxBytes: 1024 },
      beforeMount: (session) => { seedTurns(session, 10) },
    })
    // Ten user turns: the oldest rows evict as the budget overflows.
    await terminal.waitForFrame()
    await new Promise(resolve => setTimeout(resolve, 50))
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('turn-10 question')
    expect(snapshot).not.toContain('turn-1 question')
    // The newest rows stay resident.
    expect(snapshot).toContain('turn-9 question')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

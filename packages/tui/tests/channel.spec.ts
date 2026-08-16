/**
 * Channel behavior beyond the semantic snapshots: input routing, keyboard
 * shortcuts, command lines, and shutdown sequencing, driven through the
 * production createTuiChat with a headless terminal.
 */

import { describe, expect, it } from 'vitest'
import { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  appendAssistant,
  appendChunk,
  appendStepEnd,
  appendStepStart,
  appendUser,
  createFakeAgent,
  createTuiTestHarness,
  disposeTuiTestHarness,
  type TuiHarness,
} from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

async function setup(
  options: Parameters<typeof createTuiTestHarness>[2] = {},
): Promise<{ harness: TuiHarness<HeadlessTerminal, (code: number) => void>; terminal: HeadlessTerminal; exits: number[] }> {
  const terminal = new HeadlessTerminal(80, 24)
  const exits: number[] = []
  const harness = await createTuiTestHarness(terminal, code => void exits.push(code), options)
  await terminal.waitForFrame()
  return { harness, terminal, exits }
}

describe('channel behavior', () => {
  it('submits a follow-up while idle and steering while running', async () => {
    const { harness, terminal } = await setup()
    // Let each keystroke batch render before the next, so every submission
    // produces its own diff frame (the editor is cleared on submit).
    terminal.send('hello')
    await terminal.waitForFrame()
    terminal.send('\r')
    await terminal.waitForFrame()
    expect(harness.agent.followups).toHaveLength(1)
    expect(harness.agent.followups[0]).toEqual([{ type: 'text', text: 'hello' }])
    harness.agent.status = 'running'
    emitAgentEvent(harness.ctx, harness.agent, 'agent/status', { status: 'running' })
    await terminal.waitForFrame()
    terminal.send('steer me')
    await terminal.waitForFrame()
    terminal.send('\r')
    await terminal.waitForFrame()
    expect(harness.agent.steered).toHaveLength(1)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('ignores empty submissions and clears the view with /clear', async () => {
    const { harness, terminal } = await setup()
    terminal.send('   ')
    await terminal.waitForFrame()
    terminal.send('\r')
    await terminal.waitForFrame()
    expect(harness.agent.followups).toHaveLength(0)
    appendUser(harness.session, 'one message')
    await terminal.waitForFrame()
    terminal.send('/clear')
    await terminal.waitForFrame()
    terminal.send('\r')
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('one message')
    expect(harness.agent.followups).toHaveLength(0)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('cancels with Esc and Ctrl+C while running, clears input with Ctrl+C, and exits with an empty Ctrl+C', async () => {
    const { harness, terminal, exits } = await setup({
      runtime: { goodbyeMessage: 'resume with: dsh --profile tui --resume x' },
    })
    harness.agent.status = 'running'
    emitAgentEvent(harness.ctx, harness.agent, 'agent/status', { status: 'running' })
    await terminal.waitForFrame()
    // Cancellation does not change the visible view until the loop publishes
    // the idle transition, so no frame follows the consumed key; observe the
    // recorded calls instead.
    terminal.send('\x1b')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(harness.agent.cancelled).toEqual([{ kind: 'user' }])
    terminal.send('\x03')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(harness.agent.cancelled).toHaveLength(2)
    harness.agent.status = 'idle'
    emitAgentEvent(harness.ctx, harness.agent, 'agent/status', { status: 'idle' })
    await terminal.waitForFrame()
    terminal.send('draft')
    await terminal.waitForFrame()
    terminal.send('\x03')
    await terminal.waitForFrame()
    expect(harness.agent.followups).toHaveLength(0)
    // Exiting stops the TUI, so no further frame is produced; observe the
    // exit through the recorded calls instead.
    terminal.send('\x03')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(exits).toEqual([0])
    expect(harness.agent.disposed).toEqual([true])
    expect(terminal.stopped).toBe(1)
    expect(terminal.title).toBe('DeepSeek Harness')
    await harness.ctx.fiber.dispose()
    await terminal.dispose()
  })

  it('exits via Ctrl+D and via /exit and /quit, flushing the session first', async () => {
    const { harness, terminal, exits } = await setup()
    terminal.send('\x04')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(exits).toEqual([0])
    expect(harness.agent.disposed).toEqual([true])
    await harness.ctx.fiber.dispose()
    await terminal.dispose()

    const second = await setup()
    second.terminal.send('/exit')
    await second.terminal.waitForFrame()
    second.terminal.send('\r')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(second.exits).toEqual([0])
    await second.harness.ctx.fiber.dispose()
    await second.terminal.dispose()

    const third = await setup()
    third.terminal.send('/quit')
    await third.terminal.waitForFrame()
    third.terminal.send('\r')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(third.exits).toEqual([0])
    await third.harness.ctx.fiber.dispose()
    await third.terminal.dispose()
  })

  it('defers exit until the active turn reaches idle', async () => {
    const { harness, terminal, exits } = await setup()
    harness.agent.status = 'running'
    emitAgentEvent(harness.ctx, harness.agent, 'agent/status', { status: 'running' })
    await terminal.waitForFrame()
    terminal.send('\x04')
    // The fake's whenIdle resolves on a microtask, so the deferred shutdown
    // has not run yet on this synchronous line.
    expect(exits).toEqual([])
    expect(harness.agent.cancelled).toEqual([{ kind: 'user' }])
    harness.agent.status = 'idle'
    // whenIdle resolves immediately on the fake, so the deferred exit settles
    // on the next microtask turn; no further frame is produced after stop.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(exits).toEqual([0])
    expect(harness.agent.disposed).toEqual([true])
    await harness.ctx.fiber.dispose()
    await terminal.dispose()
  })

  it('settles streamed assistant text on assistant/message and skips non-text chunks', async () => {
    const { harness, terminal } = await setup()
    appendStepStart(harness.session)
    await terminal.waitForFrame()
    appendChunk(harness.session, 'partial ')
    await terminal.waitForFrame()
    appendChunk(harness.session, 'text')
    await terminal.waitForFrame()
    // A non-text delta changes nothing, so no frame is produced for it.
    harness.session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } })
    await new Promise(resolve => setTimeout(resolve, 20))
    appendAssistant(harness.session, [{ type: 'text', text: 'settled' }])
    await terminal.waitForFrame()
    appendStepEnd(harness.session)
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot()
    expect(snapshot).toContain('settled')
    expect(snapshot).not.toContain('partial text')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('renders injected context as a context card and empty assistant messages as header-only steps', async () => {
    const { harness, terminal } = await setup()
    harness.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'goal context' }],
      source: { kind: 'plugin', plugin: 'goal' },
    }), { surfaceOp: 'append' })
    await terminal.waitForFrame()
    appendAssistant(harness.session, [])
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Context · goal')
    expect(snapshot).toContain('goal context')
    expect(snapshot).toContain('Assistant')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('renders a git branch in the prompt line when the runtime reports one', async () => {
    const { harness, terminal } = await setup({
      runtime: { gitBranch: () => 'tui-staging' },
    })
    // The branch is part of the first frame; no further render is needed.
    const snapshot = await terminal.snapshot()
    expect(snapshot).toContain('(tui-staging)')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('replays the durable log on mount and skips chunk deltas while replaying', async () => {
    const { harness, terminal } = await setup({
      beforeMount(session) {
        appendUser(session, 'replayed question')
        appendChunk(session, 'replayed part')
        appendChunk(session, 'two')
        appendAssistant(session, [{ type: 'text', text: 'replayed answer' }])
      },
    })
    // The replay is painted with the first frame; chunk deltas are skipped
    // (only the settled message renders).
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('replayed question')
    expect(snapshot).toContain('replayed answer')
    expect(snapshot).not.toContain('replayed parttwo')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('ignores empty user text and events of other sessions and unknown types', async () => {
    const { harness, terminal } = await setup()
    appendUser(harness.session, '   ')
    await new Promise(resolve => setTimeout(resolve, 20))
    harness.session.append('turn/start', { turn: 2 })
    await new Promise(resolve => setTimeout(resolve, 20))
    const other = harness.ctx.sessions.create(SessionId('other-session'))
    appendUser(other, 'other session text')
    await new Promise(resolve => setTimeout(resolve, 20))
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('other session text')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('replaces the streamed buffer when the settling message is empty', async () => {
    const { harness, terminal } = await setup()
    appendStepStart(harness.session)
    await terminal.waitForFrame()
    appendChunk(harness.session, 'kept text')
    await terminal.waitForFrame()
    // The settled message is authoritative: an empty one clears the streamed
    // buffer, leaving a header-only step.
    appendAssistant(harness.session, [])
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot()
    expect(snapshot).not.toContain('kept text')
    expect(snapshot).toContain('Assistant')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('ignores Esc while idle and status events of other agents', async () => {
    const { harness, terminal } = await setup()
    const other = harness.ctx.sessions.create(SessionId('other-session-2'))
    const otherAgent = createFakeAgent(harness.ctx, other)
    emitAgentEvent(harness.ctx, otherAgent, 'agent/status', { status: 'running' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(harness.agent.cancelled).toEqual([])
    terminal.send('\x1b')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(harness.agent.cancelled).toEqual([])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('disposes a running channel: cancels, waits, flushes, and releases the terminal', async () => {
    const { harness, terminal } = await setup()
    harness.agent.status = 'running'
    emitAgentEvent(harness.ctx, harness.agent, 'agent/status', { status: 'running' })
    await terminal.waitForFrame()
    await harness.controller.dispose()
    expect(harness.agent.cancelled).toEqual([{ kind: 'user' }])
    expect(harness.agent.disposed).toEqual([true])
    expect(terminal.stopped).toBe(1)
    await harness.ctx.fiber.dispose()
    await terminal.dispose()
  })
})

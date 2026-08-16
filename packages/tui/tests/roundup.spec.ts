import { describe, expect, it } from 'vitest'
import { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import { LlmError, createMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { encodeSessionReferenceUri } from '@deepseek-ai/dsh-session-reference'
import { createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

const ABC = encodeSessionReferenceUri(SessionId('abc'))

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

async function submit(terminal: HeadlessTerminal, line: string): Promise<void> {
  terminal.send(line)
  await terminal.waitForFrame()
  terminal.send('\r')
}

describe('roundup', () => {
  it('keeps the elapsed clock on repeated running transitions', async () => {
    let clock = 5_000
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      runtime: { now: () => clock },
    })
    await terminal.waitForFrame()
    harness.agent.status = 'running'
    emitAgentEvent(harness.ctx, harness.agent as never, 'agent/status', { status: 'running' })
    await terminal.waitForFrame()
    // A second running transition must not reset the elapsed clock.
    clock += 2_000
    harness.agent.status = 'running'
    emitAgentEvent(harness.ctx, harness.agent as never, 'agent/status', { status: 'running' })
    const snapshot = await waitForSnapshot(terminal, snapshot => snapshot.includes('2.0s'))
    expect(snapshot).toContain('2.0s')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('releases steering and reference claims when the inbox settles them', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      status: 'running',
      sessionReferenceResolver: {
        listCandidates: async () => [],
        prepare: async (_agent: unknown, content: unknown[], _references: unknown[]) => ({
          content,
          additionalContext: undefined,
        }),
      },
    })
    await terminal.waitForFrame()
    // A referenced submission plus a plain steering message while running.
    await submit(terminal, `@[First](${ABC}) hello`)
    await submit(terminal, 'second message')
    let snapshot = await waitForSnapshot(terminal, snapshot => snapshot.includes('2 queued'))
    expect(snapshot).toContain('2 queued')
    // Claim the plain message: its steering claim releases.
    const message = harness.agent.steeredMessages[1] as never
    expect(message).toBeDefined()
    emitAgentEvent(harness.ctx, harness.agent as never, 'agent/inbox/claimed', {
      message,
      turn: 1,
    })
    snapshot = await waitForSnapshot(terminal, snapshot => snapshot.includes('1 queued'))
    expect(snapshot).toContain('1 queued')
    // Discard the referenced one: its steering and reference claims release.
    const referenced = harness.agent.steeredMessages[0] as never
    expect(referenced).toBeDefined()
    emitAgentEvent(harness.ctx, harness.agent as never, 'agent/inbox/discarded', {
      message: referenced,
    })
    snapshot = await waitForSnapshot(terminal, snapshot => !snapshot.includes('queued'))
    expect(snapshot).not.toContain('queued')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('settles a prepare that lands after shutdown silently', async () => {
    const gate = Promise.withResolvers<undefined>()
    const harness = await createTuiTestHarness(new HeadlessTerminal(96, 36), () => {}, {
      sessionReferenceResolver: {
        listCandidates: async () => [],
        prepare: async () => { await gate.promise; return { content: [], additionalContext: undefined } },
      },
    })
    const terminal = harness.terminal
    await terminal.waitForFrame()
    terminal.send(`@[First](${ABC}) hello`)
    await terminal.waitForFrame()
    terminal.send('\r')
    // Dispose, then let the prepare settle: the late success must be silent.
    await disposeTuiTestHarness(harness)
    gate.resolve(undefined)
    await new Promise(resolve => setTimeout(resolve, 30))
    await terminal.dispose()
  })

  it('reports a non-NO_ADAPTER context error and a park on unset selection', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      llm: {
        listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
        listModels: async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'Flash' }],
        resolveModelInfo: async () => { throw new LlmError('boom', 'OTHER_CODE') },
      },
    })
    await terminal.waitForFrame()
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Could not resolve model context: boom'))
    expect(snapshot).toContain('Could not resolve model context: boom')
    // An unset selection parks the resolution without erroring: the re-run
    // resolves the undefined route and keeps the footer free of a context
    // segment. (The earlier boom notice stays in the scrollback.)
    harness.selection.current = undefined
    harness.ctx.events.emit('llm/adapters-updated')
    await new Promise(resolve => setTimeout(resolve, 30))
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('reports a command failure that settles after shutdown silently', async () => {
    const gate = Promise.withResolvers<undefined>()
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    harness.ctx.provide('sessionQuery', {
      listSessions: async () => { await gate.promise; throw new Error('late boom') },
    })
    await terminal.waitForFrame()
    terminal.send('/resume')
    await terminal.waitForFrame()
    terminal.send('\r')
    await disposeTuiTestHarness(harness)
    gate.resolve(undefined)
    await new Promise(resolve => setTimeout(resolve, 30))
    await terminal.dispose()
  })

  it('settles a failed prepare after shutdown silently', async () => {
    const gate = Promise.withResolvers<undefined>()
    const harness = await createTuiTestHarness(new HeadlessTerminal(96, 36), () => {}, {
      sessionReferenceResolver: {
        listCandidates: async () => [],
        prepare: async () => { await gate.promise; throw new Error('late failure') },
      },
    })
    const terminal = harness.terminal
    await terminal.waitForFrame()
    terminal.send(`@[First](${ABC}) hello`)
    await terminal.waitForFrame()
    terminal.send('\r')
    await disposeTuiTestHarness(harness)
    gate.resolve(undefined)
    await new Promise(resolve => setTimeout(resolve, 30))
    await terminal.dispose()
  })

  it('ignores inbox events from other agents', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, { status: 'running' })
    await terminal.waitForFrame()
    await submit(terminal, 'plain message')
    const snapshot = await waitForSnapshot(terminal, snapshot => snapshot.includes('1 queued'))
    expect(snapshot).toContain('1 queued')
    // A foreign agent's claim must not touch this channel's badge.
    const other = harness.ctx.sessions.create(SessionId('other-agent'))
    const otherAgent = {
      id: other.id,
      session: other,
      status: 'idle',
    } as never
    emitAgentEvent(harness.ctx, otherAgent, 'agent/inbox/claimed', {
      message: harness.agent.steeredMessages[0] as never,
      turn: 1,
    })
    emitAgentEvent(harness.ctx, otherAgent, 'agent/inbox/discarded', {
      message: harness.agent.steeredMessages[0] as never,
    })
    await new Promise(resolve => setTimeout(resolve, 40))
    const after = await terminal.snapshot({ includeScrollback: true })
    expect(after).toContain('1 queued')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('renders the status card for an empty session with created-at activity', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    await terminal.waitForFrame()
    await submit(terminal, '/status')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Session status') && snapshot.includes('Active:'))
    expect(snapshot).toContain('Active:')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('releases inbox claims for messages without references', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, { status: 'running' })
    await terminal.waitForFrame()
    await submit(terminal, 'plain message')
    const snapshot = await waitForSnapshot(terminal, snapshot => snapshot.includes('1 queued'))
    expect(snapshot).toContain('1 queued')
    // The message has no reference claims; claiming it still clears the badge.
    const message = harness.agent.steeredMessages[0] as never
    expect(message).toBeDefined()
    emitAgentEvent(harness.ctx, harness.agent as never, 'agent/inbox/claimed', {
      message,
      turn: 1,
    })
    await waitForSnapshot(terminal, snapshot => !snapshot.includes('queued'))
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('renders the full status card with usage, context, and an efforted model', async () => {
    const clock = 100
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      tokenMeter: { measure: () => ({ totalTokens: 42_000 }) },
      runtime: { now: () => clock },
    })
    harness.selection.current = { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' as never }
    await terminal.waitForFrame()
    harness.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'm' } }),
      usage: { inputTokens: 1_250, outputTokens: 340, cacheReadTokens: 3_000, cacheWriteTokens: 250 },
    }, { surfaceOp: 'append' })
    await waitForSnapshot(terminal, snapshot => snapshot.includes('33% context'))
    await submit(terminal, '/status')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Session status') && snapshot.includes('67% hit'))
    expect(snapshot).toContain('67% hit')
    expect(snapshot).toContain('1,250 input + 340 output')
    expect(snapshot).toContain('33% used (42,000 / 128,000)')
    expect(snapshot).toContain('effort low')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('renders the status card with unknown capacity and a live last-activity time', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      llm: {
        listProviders: () => [{ id: 'p', name: 'P' }],
        listModels: async () => [{ provider: 'p', id: 'm', name: 'M' }],
        resolveModelInfo: async () => ({ defaultMaxTokens: 1_024 }),
      },
      tokenMeter: { measure: () => ({ totalTokens: 10 }) },
    })
    await terminal.waitForFrame()
    // A real event supplies the last-activity timestamp.
    harness.session.append('turn/start', { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } as never)
    await submit(terminal, '/status')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Session status') && snapshot.includes('capacity unknown'))
    expect(snapshot).toContain('10 used · capacity unknown')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('resume: reads a live title, cold fallback, disabled selection, and unreadable log', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    // A live session in the store plus a cache stub with a cold fallback.
    harness.ctx.sessions.create(SessionId('live-x'))
    harness.ctx.provide('sessionProjectionCache', {
      cachedSnapshot: () => undefined,
      coldSnapshot: async (id: string) => id === 'cold-x' ? { values: { title: 'Cold title' } } : { values: {} },
    })
    harness.ctx.provide('sessionQuery', {
      listSessions: async () => [
        { header: { id: 'live-x', cwd: '/workspace', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
        { header: { id: 'cold-x', cwd: '/workspace', createdAt: 1_700_000_000_001 }, live: false, persisted: true },
        { header: { id: 'main-session', cwd: '/workspace', createdAt: 1_700_000_000_002 }, live: false, persisted: true },
      ],
      readTitleSnapshots: async () => [],
      readSession: async () => { throw new Error('log unreadable') },
    })
    await terminal.waitForFrame()
    terminal.send('/resume')
    await terminal.waitForFrame()
    terminal.send('\r')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Untitled session') && snapshot.includes('Cold title'))
    expect(snapshot).toContain('Cold title')
    // The live row's title read the live registry (no title → Untitled).
    expect(snapshot).toContain('live-x')
    // Selecting the current session is rejected by preflight.
    await waitForSnapshot(terminal, snapshot => snapshot.includes('main-session'))
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('resume: rejects an unreadable log at preflight', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    harness.ctx.provide('sessionQuery', {
      listSessions: async () => [
        { header: { id: 's-1', cwd: '/workspace', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
      ],
      readTitleSnapshots: async (ids: readonly string[]) => ids.map(id => ({
        sessionId: id,
        status: 'fulfilled',
        value: { session: { id, createdAt: 0 } },
      })),
      readSession: async () => { throw new Error('log unreadable') },
    })
    await terminal.waitForFrame()
    terminal.send('/resume')
    await terminal.waitForFrame()
    terminal.send('\r')
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Untitled session'))
    terminal.send('\r')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Resume failed: session cannot be loaded: log unreadable'))
    expect(snapshot).toContain('session cannot be loaded: log unreadable')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

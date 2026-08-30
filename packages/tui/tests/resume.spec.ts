import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

interface Record {
  header: { id: string; cwd?: string; createdAt: number }
  live: boolean
  persisted: boolean
}

const records: Record[] = [
  { header: { id: 's-1', cwd: '/workspace', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
  { header: { id: 's-2', cwd: '/workspace', createdAt: 1_700_000_000_001 }, live: false, persisted: true },
  { header: { id: 's-3', cwd: '/elsewhere', createdAt: 1_700_000_000_002 }, live: false, persisted: true },
]

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

function sessionQueryStub(overrides: {
  listSessions?: (signal?: AbortSignal) => Promise<Record[]>
  readTitleSnapshots?: (ids: readonly string[]) => Promise<unknown[]>
  readSession?: (id: string) => Promise<{ events: unknown[] }>
} = {}) {
  return {
    listSessions: overrides.listSessions ?? (async () => records),
    readTitleSnapshots: overrides.readTitleSnapshots ?? (async (ids: readonly string[]) =>
      ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { session: { id, createdAt: 0 } } }))),
    readSession: overrides.readSession ?? (async () => ({ events: [] })),
  }
}

async function setup(options: {
  status?: 'idle' | 'running'
  runtime?: Partial<import('../src/runtime.ts').TuiRuntime>
  sessionQuery?: unknown
  sessionPersistence?: unknown
  sessionProjectionCache?: unknown
} = {}): Promise<{
  harness: Awaited<ReturnType<typeof createTuiTestHarness<HeadlessTerminal, (code: number) => void>>>
  terminal: HeadlessTerminal
}> {
  const terminal = new HeadlessTerminal(96, 36)
  const harness = await createTuiTestHarness(terminal, () => {}, {
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
  })
  if (options.sessionQuery !== undefined) harness.ctx.provide('sessionQuery', options.sessionQuery)
  if (options.sessionPersistence !== undefined) harness.ctx.provide('sessionPersistence', options.sessionPersistence)
  if (options.sessionProjectionCache !== undefined) harness.ctx.provide('sessionProjectionCache', options.sessionProjectionCache)
  await terminal.waitForFrame()
  return { harness, terminal }
}

async function openResume(terminal: HeadlessTerminal): Promise<void> {
  terminal.send('/resume')
  await terminal.waitForFrame()
  terminal.send('\r')
}

describe('resume controller', () => {
  it('lists sessions without reading whole logs and Esc closes', async () => {
    const readSession = vi.fn()
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub({ readSession: readSession as never }),
    })
    await openResume(terminal)
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Untitled session') && snapshot.includes('s-2'))
    // The picker shows the two workspace rows; other-workspace rows are hidden
    // until Tab widens the scope.
    expect(snapshot).toContain('s-1')
    expect(snapshot).toContain('s-2')
    expect(snapshot).not.toContain('s-3')
    // The listing resolved titles from the batch, never reading a log.
    expect(readSession).not.toHaveBeenCalled()
    terminal.send('\x1b')
    await new Promise(resolve => setTimeout(resolve, 40))
    const closed = await terminal.snapshot({ includeScrollback: true })
    expect(closed).not.toContain('Resume session')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('cancels an in-flight scan when the picker closes', async () => {
    const gate = Promise.withResolvers<undefined>()
    let capturedSignal: AbortSignal | undefined
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub({
        listSessions: (signal) => {
          capturedSignal = signal
          return gate.promise.then(() => records)
        },
      }),
    })
    await openResume(terminal)
    await new Promise(resolve => setTimeout(resolve, 30))
    // Close while the listing is still pending: the scan must abort in flight.
    terminal.send('\x1b')
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(capturedSignal?.aborted).toBe(true)
    gate.resolve(undefined)
    await new Promise(resolve => setTimeout(resolve, 40))
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    // The cancelled scan stays silent: no failure notice, no picker.
    expect(snapshot).not.toContain('Resume session scan failed')
    expect(snapshot).not.toContain('Resume session')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('hands the process off after preflight, restoring the terminal on host failure', async () => {
    const handoffs: Array<[string, string]> = []
    const { harness, terminal } = await setup({
      runtime: {
        handoffResume: async (id: string, cwd: string) => {
          handoffs.push([id, cwd])
          throw new Error('host returned')
        },
      },
      sessionQuery: sessionQueryStub(),
    })
    const startedBefore = terminal.started
    await openResume(terminal)
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Untitled session'))
    // The newest workspace session is selected; Enter commits the handoff.
    terminal.send('\r')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Resume handoff failed: host returned'))
    expect(snapshot).toContain('Resume handoff failed: host returned')
    expect(handoffs).toEqual([['s-2', '/workspace']])
    // The terminal was released for the host and reacquired on failure.
    expect(terminal.started).toBe(startedBefore + 1)
    expect(terminal.stopped).toBe(1)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('warns when the host cannot hand off in place', async () => {
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub(),
    })
    await openResume(terminal)
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Untitled session'))
    terminal.send('\r')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Session is resumable, but this host cannot hand it off in place.'))
    expect(snapshot).toContain('Session is resumable, but this host cannot hand it off in place.')
    // No terminal lifecycle was touched.
    expect(terminal.started).toBe(1)
    expect(terminal.stopped).toBe(0)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('refuses to open while the agent is running', async () => {
    const { harness, terminal } = await setup({ status: 'running' })
    await openResume(terminal)
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Resume requires the current turn to finish or be cancelled first.'))
    expect(snapshot).toContain('Resume requires the current turn to finish or be cancelled first.')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('disables the current and already-live sessions with reasons', async () => {
    const liveSession = (harness: { ctx: import('@deepseek-ai/cordis').Context }): void => {
      harness.ctx.sessions.create(SessionId('live-1'))
    }
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub({
        listSessions: async () => [
          { header: { id: 'main-session', cwd: '/workspace', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
          { header: { id: 'live-1', cwd: '/workspace', createdAt: 1_700_000_000_001 }, live: true, persisted: true },
          { header: { id: 's-2', cwd: '/workspace', createdAt: 1_700_000_000_002 }, live: false, persisted: true },
        ],
      }),
    })
    liveSession(harness)
    await openResume(terminal)
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('unavailable: current session')
      && snapshot.includes('unavailable: session is already live in this runtime'))
    expect(snapshot).toContain('main-session')
    expect(snapshot).toContain('live-1')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('reports a failed preflight after selection', async () => {
    let listed = true
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub({
        listSessions: async () => (listed ? records : []),
      }),
    })
    await openResume(terminal)
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Untitled session'))
    // The record disappears between the scan and the handoff preflight.
    listed = false
    terminal.send('\r')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Resume failed: Session \\"s-2\\" is no longer available.'))
    expect(snapshot).toContain('Resume failed: Session \\"s-2\\" is no longer available.')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('retries a torn preflight read and resumes once the writer settles', async () => {
    let calls = 0
    const handoffs: Array<[string, string]> = []
    const { harness, terminal } = await setup({
      runtime: {
        handoffResume: async (id: string, cwd: string) => {
          handoffs.push([id, cwd])
          throw new Error('host returned')
        },
      },
      sessionQuery: sessionQueryStub({
        readSession: async () => {
          calls += 1
          if (calls <= 2) {
            throw new Error(
              'failed to inspect session "s-2": corrupt Zstandard session log: '
              + 'complete frame contains a torn JSONL record',
            )
          }
          return { events: [] }
        },
      }),
    })
    await openResume(terminal)
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Untitled session'))
    terminal.send('\r')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Resume handoff failed: host returned'))
    expect(snapshot).toContain('Resume handoff failed: host returned')
    expect(calls).toBe(3)
    expect(handoffs).toEqual([['s-2', '/workspace']])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('rejects a session whose route is currently unavailable', async () => {
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub({
        readSession: async () => ({
          events: [
            {
              type: 'request/header',
              data: { header: { config: { provider: 'gone-provider', model: 'm' } } },
            },
          ],
        }),
      }),
    })
    await openResume(terminal)
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Untitled session'))
    terminal.send('\r')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('route is currently unavailable (gone-provider/m)'))
    expect(snapshot).toContain('route is currently unavailable (gone-provider/m)')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('uses the projection-cache ladder for titles', async () => {
    const cached = new Map<string, unknown>([
      ['s-1', { values: { title: 'Cached title' } }],
    ])
    const coldTitles = new Map<string, unknown>([
      ['s-2', { values: { title: 'Cold title' } }],
    ])
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub(),
      sessionProjectionCache: {
        cachedSnapshot: (meta: { id: string }) => cached.get(meta.id),
        coldSnapshot: async (id: string) => coldTitles.get(id) ?? { values: {} },
      },
    })
    await openResume(terminal)
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Cached title') && snapshot.includes('Cold title'))
    expect(snapshot).toContain('Cached title')
    expect(snapshot).toContain('Cold title')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('falls back to artifact mtime for activity and isolates corrupt titles', async () => {
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub({
        readTitleSnapshots: async (ids: readonly string[]) => ids.map((id, index) => ({
          sessionId: id,
          status: index === 0 ? 'rejected' : 'fulfilled',
          reason: new Error('corrupt log'),
          value: index === 0 ? undefined : { session: { id, createdAt: 0 } },
        })),
      }),
      sessionPersistence: {
        locate: () => ({ path: '/nonexistent/artifact.jsonl' }),
      },
    })
    await openResume(terminal)
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Unreadable session') && snapshot.includes('corrupt log'))
    expect(snapshot).toContain('Unreadable session')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('resolves titles through the batch fallback and cache cold paths', async () => {
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub({
        readTitleSnapshots: async (ids: readonly string[]) => ids.map(id => ({
          sessionId: id,
          status: 'fulfilled',
          value: { session: { id, createdAt: 0 }, title: { title: 'Batch title' } },
        })),
      }),
    })
    await openResume(terminal)
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Batch title') && snapshot.includes('s-2'))
    expect(snapshot).toContain('Batch title')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()

    // Cache path: a cold read without a title yields an untitled row; a cold
    // read failure degrades to an unreadable row.
    const { harness: harness2, terminal: terminal2 } = await setup({
      sessionQuery: sessionQueryStub(),
      sessionProjectionCache: {
        cachedSnapshot: () => undefined,
        coldSnapshot: async (id: string) => {
          if (id === 's-1') return { values: {} }
          throw new Error('cold broke')
        },
      },
    })
    await openResume(terminal2)
    const snapshot2 = await waitForSnapshot(terminal2, snapshot =>
      snapshot.includes('Unreadable session') && snapshot.includes('cold broke'))
    expect(snapshot2).toContain('Untitled session')
    await disposeTuiTestHarness(harness2)
    await terminal2.dispose()
  })

  it('derives the route from an assistant message when no header is logged', async () => {
    const handoffs: Array<[string, string]> = []
    const { harness, terminal } = await setup({
      runtime: {
        handoffResume: async (id: string, cwd: string) => {
          handoffs.push([id, cwd])
          throw new Error('host returned')
        },
      },
      sessionQuery: sessionQueryStub({
        readSession: async () => ({
          events: [
            {
              type: 'assistant/message',
              data: {
                message: { source: { provider: 'deepseek-official', model: 'm' } },
              },
            },
          ],
        }),
      }),
    })
    await openResume(terminal)
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Untitled session'))
    terminal.send('\r')
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Resume handoff failed: host returned'))
    expect(handoffs).toEqual([['s-2', '/workspace']])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('rejects selecting the current session inline', async () => {
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub({
        listSessions: async () => [
          { header: { id: 'main-session', cwd: '/workspace', createdAt: 1_700_000_000_003 }, live: false, persisted: true },
          { header: { id: 's-2', cwd: '/workspace', createdAt: 1_700_000_000_002 }, live: false, persisted: true },
        ],
      }),
    })
    await openResume(terminal)
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Untitled session'))
    // The current session is the newest row; the picker rejects it inline.
    terminal.send('\r')
    const current = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('current session'))
    expect(current).toContain('current session')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('rejects the handoff when the agent leaves idle before preflight', async () => {
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub(),
    })
    await openResume(terminal)
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Untitled session'))
    harness.agent.status = 'running'
    terminal.send('\r')
    const running = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Resume failed: Resume requires an idle agent (status: running).'))
    expect(running).toContain('Resume requires an idle agent (status: running)')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('ignores a re-entrant handoff and reports a host that returns without replacing the process', async () => {
    const gate = Promise.withResolvers<undefined>()
    let calls = 0
    let handoffs = 0
    const { harness, terminal } = await setup({
      runtime: {
        handoffResume: (async () => {
          handoffs += 1
          // Returns instead of throwing: the controller reports it.
          return undefined as never
        }),
      },
      sessionQuery: sessionQueryStub({
        listSessions: async () => {
          calls += 1
          // The scan's listing runs free; the preflight's re-listing gates.
          if (calls === 1) return records
          await gate.promise
          return records
        },
      }),
    })
    await openResume(terminal)
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Untitled session'))
    // First Enter starts the handoff; the preflight re-listing keeps it pending.
    terminal.send('\r')
    await new Promise(resolve => setTimeout(resolve, 40))
    // A second Enter while the first handoff is in flight is ignored.
    terminal.send('\r')
    gate.resolve(undefined)
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Resume handoff failed: resume host returned without replacing the process'))
    expect(snapshot).toContain('resume host returned without replacing the process')
    expect(handoffs).toBe(1)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('ties activity times with the session id ordering', async () => {
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub({
        listSessions: async () => [
          { header: { id: 'z-session', cwd: '/workspace', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
          { header: { id: 'a-session', cwd: '/workspace', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
        ],
      }),
    })
    await openResume(terminal)
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('a-session') && snapshot.includes('z-session'))
    // Equal activity ties break on the session id: a-session sorts first.
    const first = snapshot.indexOf('a-session')
    const second = snapshot.indexOf('z-session')
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('reports a failing session scan', async () => {
    const { harness, terminal } = await setup({
      sessionQuery: sessionQueryStub({
        listSessions: async () => { throw new Error('store down') },
      }),
    })
    await openResume(terminal)
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Resume session scan failed: store down'))
    expect(snapshot).toContain('Resume session scan failed: store down')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

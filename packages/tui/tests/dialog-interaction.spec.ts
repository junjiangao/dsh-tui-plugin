import { describe, expect, it } from 'vitest'
import { createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
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

async function submit(terminal: HeadlessTerminal, line: string): Promise<void> {
  terminal.send(line)
  await terminal.waitForFrame()
  terminal.send('\r')
}

describe('dialog interactions', () => {
  it('clears the model filter with Esc and shows the no-match state', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    await terminal.waitForFrame()
    await submit(terminal, '/model')
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Select model'))
    // A filter with no matches names the empty state.
    terminal.send('zzz')
    const empty = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('No models match the filter'))
    expect(empty).toContain('No models match the filter')
    // Esc clears the filter, restoring the full list.
    terminal.send('\x1b')
    const restored = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('DeepSeek V4 Flash') && !snapshot.includes('No models match'))
    expect(restored).toContain('DeepSeek V4 Flash')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('tolerates a key that leaves the model filter unchanged', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    await terminal.waitForFrame()
    await submit(terminal, '/model')
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Select model'))
    // A NUL byte changes neither the filter nor the list.
    terminal.send('\x00')
    await new Promise(resolve => setTimeout(resolve, 40))
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Select model')
    expect(snapshot).toContain('DeepSeek V4 Flash')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('cycles an empty selection harmlessly', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    await terminal.waitForFrame()
    await submit(terminal, '/model')
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Select model'))
    // Narrow to nothing, then Shift+Tab: no selection to cycle.
    terminal.send('zzz')
    await waitForSnapshot(terminal, snapshot => snapshot.includes('No models match the filter'))
    terminal.send('\x1b[Z')
    await new Promise(resolve => setTimeout(resolve, 40))
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('No models match the filter')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('searches the resume picker by title, id, and workspace label', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    harness.ctx.provide('sessionQuery', {
      listSessions: async () => [
        { header: { id: 's-1', cwd: '/alpha', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
        { header: { id: 's-2', cwd: '/beta', createdAt: 1_700_000_000_001 }, live: false, persisted: true },
      ],
      readTitleSnapshots: async (ids: readonly string[]) => ids.map(id => ({
        sessionId: id,
        status: 'fulfilled',
        value: { session: { id, createdAt: 0 }, title: { title: `Title ${id}` } },
      })),
      readSession: async () => ({ events: [] }),
    })
    await terminal.waitForFrame()
    await submit(terminal, '/resume')
    // Settle the scan, then widen to all workspaces so the other-workspace
    // rows and their labels join the search fields.
    await new Promise(resolve => setTimeout(resolve, 60))
    terminal.send('\t')
    await new Promise(resolve => setTimeout(resolve, 40))
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Title s-1')
    // Title search narrows the rows.
    terminal.send('s-2')
    await new Promise(resolve => setTimeout(resolve, 40))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Title s-2')
    expect(snapshot).not.toContain('Title s-1')
    // Clear and search by id.
    terminal.send('\x1b')
    await new Promise(resolve => setTimeout(resolve, 30))
    terminal.send('s-1')
    await new Promise(resolve => setTimeout(resolve, 40))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Title s-1')
    expect(snapshot).not.toContain('Title s-2')
    // Workspace label search in the all-scope.
    terminal.send('\x1b')
    await new Promise(resolve => setTimeout(resolve, 30))
    terminal.send('beta')
    await new Promise(resolve => setTimeout(resolve, 40))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Title s-2')
    expect(snapshot).not.toContain('Title s-1')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('handles bracketed paste in the resume search box', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    harness.ctx.provide('sessionQuery', {
      listSessions: async () => [
        { header: { id: 's-1', cwd: '/workspace', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
        { header: { id: 's-2', cwd: '/workspace', createdAt: 1_700_000_000_001 }, live: false, persisted: true },
      ],
      readTitleSnapshots: async (ids: readonly string[]) => ids.map(id => ({
        sessionId: id,
        status: 'fulfilled',
        value: { session: { id, createdAt: 0 } },
      })),
      readSession: async () => ({ events: [] }),
    })
    await terminal.waitForFrame()
    await submit(terminal, '/resume')
    await new Promise(resolve => setTimeout(resolve, 60))
    // Paste the id s-2 with a typed prefix before it: the prefix and the
    // pasted text both land in the search box.
    terminal.send('pre\x1b[200~s-2\x1b[201~')
    await new Promise(resolve => setTimeout(resolve, 50))
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('pres-2')
    // A split paste (marker, then payload+end) completes the same way.
    terminal.send('\x1b[200~')
    await new Promise(resolve => setTimeout(resolve, 30))
    terminal.send('s-1\x1b[201~')
    await new Promise(resolve => setTimeout(resolve, 50))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('s-1')
    // Trailing text after the paste end is handled as ordinary input.
    terminal.send('\x1b[200~x\x1b[201~tail')
    await new Promise(resolve => setTimeout(resolve, 50))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('tail')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('handles an empty paste and keys that do not change the filter', async () => {
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
      readSession: async () => ({ events: [] }),
    })
    await terminal.waitForFrame()
    await submit(terminal, '/resume')
    await new Promise(resolve => setTimeout(resolve, 60))
    // An empty paste leaves the search value unchanged.
    terminal.send('\x1b[200~\x1b[201~')
    await new Promise(resolve => setTimeout(resolve, 40))
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Untitled session')
    // Narrow to nothing, then navigate: Up/Down/PgUp/PgDn on an empty list.
    terminal.send('zzz')
    await new Promise(resolve => setTimeout(resolve, 40))
    terminal.send('\x1b[A')
    await new Promise(resolve => setTimeout(resolve, 30))
    terminal.send('\x1b[B')
    await new Promise(resolve => setTimeout(resolve, 30))
    terminal.send('\x1b[5~')
    await new Promise(resolve => setTimeout(resolve, 30))
    terminal.send('\x1b[6~')
    await new Promise(resolve => setTimeout(resolve, 30))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('No matching sessions.')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('covers narrow picker rendering and non-persisted rows', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    harness.ctx.provide('sessionQuery', {
      listSessions: async () => [
        { header: { id: 's-1', cwd: '/workspace', createdAt: 1_700_000_000_000 }, live: true, persisted: false },
      ],
      readTitleSnapshots: async (ids: readonly string[]) => ids.map(id => ({
        sessionId: id,
        status: 'fulfilled',
        value: { session: { id, createdAt: 0 } },
      })),
      readSession: async () => ({ events: [] }),
    })
    await terminal.waitForFrame()
    // A very narrow terminal drops the picker's horizontal padding.
    terminal.resize(10, 20)
    await terminal.waitForFrame()
    await submit(terminal, '/resume')
    await new Promise(resolve => setTimeout(resolve, 60))
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    // The 10-column picker truncates its title and row text but still
    // renders the search box and the live row's unavailable state.
    expect(snapshot).toContain('⌕')
    expect(snapshot).toContain('unavail')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('cycles scope with Tab and tolerates ignored keys', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    harness.ctx.provide('sessionQuery', {
      listSessions: async () => [
        { header: { id: 's-1', cwd: '/workspace', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
        { header: { id: 's-2', cwd: '/elsewhere', createdAt: 1_700_000_000_001 }, live: false, persisted: true },
      ],
      readTitleSnapshots: async (ids: readonly string[]) => ids.map(id => ({
        sessionId: id,
        status: 'fulfilled',
        value: { session: { id, createdAt: 0 } },
      })),
      readSession: async () => ({ events: [] }),
    })
    await terminal.waitForFrame()
    await submit(terminal, '/resume')
    await new Promise(resolve => setTimeout(resolve, 60))
    // Tab widens the scope, Tab again narrows it back.
    terminal.send('\t')
    await new Promise(resolve => setTimeout(resolve, 40))
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('all workspaces')
    terminal.send('\t')
    await new Promise(resolve => setTimeout(resolve, 40))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('this workspace')
    // A NUL byte changes neither the search value nor the selection.
    terminal.send('\x00')
    await new Promise(resolve => setTimeout(resolve, 40))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('this workspace')
    // Down on a populated list moves the selection (no crash).
    terminal.send('\x1b[B')
    await new Promise(resolve => setTimeout(resolve, 40))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Resume session')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('reports loading and no-match states on Enter', async () => {
    const gate = Promise.withResolvers<undefined>()
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    harness.ctx.provide('sessionQuery', {
      listSessions: async () => {
        await gate.promise
        return [
          { header: { id: 's-1', cwd: '/workspace', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
        ]
      },
      readTitleSnapshots: async (ids: readonly string[]) => ids.map(id => ({
        sessionId: id,
        status: 'fulfilled',
        value: { session: { id, createdAt: 0 } },
      })),
      readSession: async () => ({ events: [] }),
    })
    await terminal.waitForFrame()
    await submit(terminal, '/resume')
    // The scan is gated: Enter reports the loading state.
    terminal.send('\r')
    await new Promise(resolve => setTimeout(resolve, 50))
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Sessions are still loading.')
    gate.resolve(undefined)
    // Wait for the scan to land its row before interacting.
    await new Promise(resolve => setTimeout(resolve, 60))
    const settled = await terminal.snapshot({ includeScrollback: true })
    expect(settled).toContain('Untitled session')
    // A search with no match reports it on Enter.
    terminal.send('zzz')
    await new Promise(resolve => setTimeout(resolve, 40))
    terminal.send('\r')
    await new Promise(resolve => setTimeout(resolve, 50))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('No session matches this search.')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('cancels the resume picker with Ctrl+C and moves with Up', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    harness.ctx.provide('sessionQuery', {
      listSessions: async () => [
        { header: { id: 's-1', cwd: '/workspace', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
        { header: { id: 's-2', cwd: '/workspace', createdAt: 1_700_000_000_001 }, live: false, persisted: true },
      ],
      readTitleSnapshots: async (ids: readonly string[]) => ids.map(id => ({
        sessionId: id,
        status: 'fulfilled',
        value: { session: { id, createdAt: 0 } },
      })),
      readSession: async () => ({ events: [] }),
    })
    await terminal.waitForFrame()
    await submit(terminal, '/resume')
    await new Promise(resolve => setTimeout(resolve, 60))
    // Up from the first row wraps to the last row; Ctrl+C cancels the picker.
    terminal.send('\x1b[A')
    await new Promise(resolve => setTimeout(resolve, 40))
    terminal.send('\x03')
    await new Promise(resolve => setTimeout(resolve, 50))
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('Resume session')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

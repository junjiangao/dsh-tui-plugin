import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tui-autocomplete-'))
  roots.push(root)
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'README.md'), 'readme')
  await writeFile(join(root, 'src', 'main.ts'), 'main')
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

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

function resolverStub(): unknown {
  return {
    listCandidates: async () => [{
      sessionId: 's-1',
      label: 'First session',
      cwd: '/workspace',
      createdAt: 1_700_000_000_000,
    }],
    prepare: async () => ({ content: [], additionalContext: undefined }),
  }
}

describe('editor autocomplete in the live channel', () => {
  it('completes @path files and quoted names with spaces', async () => {
    const root = await workspace()
    await writeFile(join(root, 'docs'), '')
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, { cwd: root })
    await terminal.waitForFrame()
    terminal.send('@')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Folder · src') && snapshot.includes('File · README.md'))
    expect(snapshot).toContain('Folder · src')
    expect(snapshot).toContain('File · README.md')
    // Tab applies the selected completion into the editor.
    terminal.send('\t')
    await waitForSnapshot(terminal, snapshot => snapshot.includes('│ @src/'))
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('merges session candidates for a bare @ token and none for a quoted one', async () => {
    const root = await workspace()
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      cwd: root,
      sessionReferenceResolver: resolverStub(),
    })
    await terminal.waitForFrame()
    terminal.send('@')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Session · First session') && snapshot.includes('File · README.md'))
    expect(snapshot).toContain('Session · First session')
    expect(snapshot).toContain('s-1 · /workspace ·')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('shows only files inside a quoted token and still completes base commands', async () => {
    const root = await workspace()
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      cwd: root,
      sessionReferenceResolver: resolverStub(),
    })
    await terminal.waitForFrame()
    // Slash commands complete from the base provider on Tab.
    terminal.send('/he')
    await terminal.waitForFrame()
    terminal.send('\t')
    const slash = await waitForSnapshot(terminal, snapshot => snapshot.includes('/help'))
    expect(slash).toContain('/help')
    // Dismiss the completion list; the close may not emit its own frame,
    // so the next keystroke supplies the render.
    terminal.send('\x1b')
    await new Promise(resolve => setTimeout(resolve, 40))
    // A quoted token never consults the session resolver; Tab forces the
    // file completion inside the quotes.
    terminal.send('@"')
    await terminal.waitForFrame()
    terminal.send('\t')
    const quoted = await waitForSnapshot(terminal, snapshot => snapshot.includes('File · README.md'))
    expect(quoted).not.toContain('Session ·')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('tolerates a failing session resolver', async () => {
    const root = await workspace()
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {
      cwd: root,
      sessionReferenceResolver: {
        listCandidates: async () => { throw new Error('resolver down') },
      },
    })
    await terminal.waitForFrame()
    terminal.send('@')
    const snapshot = await waitForSnapshot(terminal, snapshot => snapshot.includes('File · README.md'))
    expect(snapshot).toContain('File · README.md')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('lets Tab with no active token fall back to the base provider quietly', async () => {
    const root = await workspace()
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, { cwd: root })
    await terminal.waitForFrame()
    terminal.send('x')
    await terminal.waitForFrame()
    terminal.send('\t')
    await new Promise(resolve => setTimeout(resolve, 60))
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    // No completion list for a bare token; the text stays as typed.
    expect(snapshot).not.toContain('File ·')
    expect(snapshot).toContain('│ x')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

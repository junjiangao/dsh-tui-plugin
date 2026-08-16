import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { encodeSessionReferenceUri } from '@deepseek-ai/dsh-session-reference'
import GoalService from '@deepseek-ai/dsh-goal'
import * as commandGoal from '@deepseek-ai/dsh-command-goal'
import {
  appendAssistant,
  appendChunk,
  appendStepEnd,
  appendStepStart,
  appendUser,
  createTuiTestHarness,
  disposeTuiTestHarness,
  type TuiHarness,
  type TuiHarnessOptions,
} from './harness.ts'
import { HeadlessTerminal, type TerminalSnapshotOptions } from './headless-terminal.ts'

const SNAPSHOTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const REFRESHING = process.env.DSH_SNAPSHOT === 'refresh'

const CHECKPOINTS = [
  'minimal-chat',
  'streaming',
  'disposed-terminal',
  'goal-commands',
  'model-selector',
  'model-selector-filtered',
  'resume-sessions-loading',
  'resume-sessions',
  'resume-sessions-all-workspaces',
  'file-autocomplete',
  'session-reference',
  'status-diagnostics',
  'status-diagnostics-narrow',
] as const

type Checkpoint = typeof CHECKPOINTS[number]
type SnapshotHarness = TuiHarness<HeadlessTerminal, (code: number) => void>

const observedCheckpoints = new Set<Checkpoint>()

async function checkpoint(
  name: Checkpoint,
  terminal: HeadlessTerminal,
  options: TerminalSnapshotOptions = {},
): Promise<void> {
  observedCheckpoints.add(name)
  expect(terminal.themeViolations(), `${name} must remain theme-agnostic`).toEqual([])
  const snapshot = await terminal.snapshot(options)
  const path = join(SNAPSHOTS_DIR, `${name}.expected.txt`)
  if (REFRESHING) {
    await mkdir(SNAPSHOTS_DIR, { recursive: true })
    await writeFile(path, snapshot)
  }
  await expect(snapshot).toMatchFileSnapshot(path)
}

async function setupSnapshot(
  options: TuiHarnessOptions = {},
  size: { columns?: number; rows?: number } = {},
): Promise<SnapshotHarness> {
  const terminal = new HeadlessTerminal(size.columns ?? 96, size.rows ?? 36)
  const before = terminal.frames
  const result = await createTuiTestHarness(terminal, () => {}, {
    ...options,
    cwd: options.cwd === undefined ? '/workspace/project' : options.cwd,
    config: Object.assign({
      welcome: 'Snapshot agent ready.',
      theme: { color: true },
      title: 'DSH snapshot',
    }, options.config),
  })
  await terminal.waitForFrame(before)
  return result
}

async function renderAfter(harness: SnapshotHarness, action: () => void): Promise<void> {
  const before = harness.terminal.frames
  action()
  await harness.terminal.waitForFrame(before)
}

async function disposeSnapshot(harness: SnapshotHarness): Promise<void> {
  await disposeTuiTestHarness(harness)
  await harness.terminal.dispose()
}

describe('TUI semantic snapshots', () => {
  it('minimal-chat', async () => {
    const harness = await setupSnapshot()
    await checkpoint('minimal-chat', harness.terminal)
    await disposeSnapshot(harness)
  })

  it('streaming', async () => {
    // Pin the wall clock so event times, the live timing footer, and the
    // completion timestamp are deterministic in the snapshot.
    let clock = new Date(Date.UTC(2026, 6, 21, 6, 32, 6)).getTime()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const harness = await setupSnapshot()
    await renderAfter(harness, () => {
      clock += 1_000
      appendUser(harness.session, 'Show the live update.')
    })
    await renderAfter(harness, () => {
      clock += 1_000
      harness.agent.status = 'running'
      emitAgentEvent(harness.ctx, harness.agent, 'agent/status', { status: 'running' })
    })
    await renderAfter(harness, () => {
      clock += 1_000
      appendStepStart(harness.session)
    })
    await renderAfter(harness, () => {
      clock += 1_000
      harness.session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'reasoning-delta', index: 0, text: 'Inspecting width and styles.' },
      })
    })
    await renderAfter(harness, () => {
      clock += 1_000
      appendChunk(harness.session, 'Streaming', 1)
    })
    await renderAfter(harness, () => {
      clock += 1_000
      appendChunk(harness.session, ' visible', 1)
    })
    await renderAfter(harness, () => {
      clock += 1_000
      appendChunk(harness.session, ' state.', 1)
    })
    await checkpoint('streaming', harness.terminal)
    await renderAfter(harness, () => {
      clock += 1_000
      appendAssistant(harness.session, [
        { type: 'reasoning', text: 'Inspecting width and styles.' },
        { type: 'text', text: 'Streaming visible state.' },
      ])
    })
    await renderAfter(harness, () => {
      clock += 1_000
      appendStepEnd(harness.session)
    })
    nowSpy.mockRestore()
    await disposeSnapshot(harness)
  })

  it('goal-commands', async () => {
    // Pin the wall clock so goal timestamps are deterministic.
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => new Date(Date.UTC(2026, 6, 21, 6, 32, 6)).getTime())
    const harness = await setupSnapshot()
    // The goal domain and its /goal producer compose after the channel mounts,
    // exactly as the bundle rows load them.
    await harness.ctx.plugin(GoalService)
    await harness.ctx.plugin(commandGoal)
    await renderAfter(harness, () => {
      harness.terminal.send('/goal do the thing')
    })
    await renderAfter(harness, () => {
      harness.terminal.send('\r')
    })
    await renderAfter(harness, () => {
      harness.terminal.send('/goal pause')
    })
    await renderAfter(harness, () => {
      harness.terminal.send('\r')
    })
    await checkpoint('goal-commands', harness.terminal)
    nowSpy.mockRestore()
    await disposeSnapshot(harness)
  })

  it('model-selector', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => new Date(Date.UTC(2026, 6, 21, 6, 32, 6)).getTime())
    const harness = await setupSnapshot()
    await renderAfter(harness, () => { harness.terminal.send('/model') })
    await renderAfter(harness, () => { harness.terminal.send('\r') })
    // The dialog renders as soon as the command dispatches; the bounded poll
    // waits for the overlay frame.
    await new Promise(resolve => setTimeout(resolve, 40))
    await checkpoint('model-selector', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => { harness.terminal.send('pro') })
    await new Promise(resolve => setTimeout(resolve, 40))
    await checkpoint('model-selector-filtered', harness.terminal, { includeScrollback: true })
    nowSpy.mockRestore()
    await disposeSnapshot(harness)
  })

  it('resume-sessions', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => new Date(Date.UTC(2026, 6, 21, 6, 32, 6)).getTime())
    const harness = await setupSnapshot()
    const gate = Promise.withResolvers<undefined>()
    harness.ctx.provide('sessionQuery', {
      listSessions: async () => {
        await gate.promise
        return [
          { header: { id: 's-1', cwd: '/workspace/project', createdAt: 1_700_000_000_000 }, live: false, persisted: true },
          { header: { id: 's-2', cwd: '/workspace/other', createdAt: 1_700_000_000_001 }, live: false, persisted: true },
        ]
      },
      readTitleSnapshots: async (ids: readonly string[]) => ids.map(id => ({
        sessionId: id,
        status: 'fulfilled',
        value: { session: { id, createdAt: 0 }, title: { title: `Session ${id} title` } },
      })),
      readSession: async () => ({ events: [] }),
    })
    await renderAfter(harness, () => { harness.terminal.send('/resume') })
    await renderAfter(harness, () => { harness.terminal.send('\r') })
    await new Promise(resolve => setTimeout(resolve, 40))
    await checkpoint('resume-sessions-loading', harness.terminal, { includeScrollback: true })
    gate.resolve(undefined)
    await new Promise(resolve => setTimeout(resolve, 60))
    await checkpoint('resume-sessions', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => { harness.terminal.send('\t') })
    await new Promise(resolve => setTimeout(resolve, 40))
    await checkpoint('resume-sessions-all-workspaces', harness.terminal, { includeScrollback: true })
    nowSpy.mockRestore()
    await disposeSnapshot(harness)
  })

  it('file-autocomplete', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => new Date(Date.UTC(2026, 6, 21, 6, 32, 6)).getTime())
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-snapshot-files-'))
    const harness = await setupSnapshot({
      cwd: root,
      runtime: { formatCwd: () => '~/snapshot-project' },
    })
    await renderAfter(harness, () => { harness.terminal.send('@') })
    await new Promise(resolve => setTimeout(resolve, 60))
    await checkpoint('file-autocomplete', harness.terminal, { includeScrollback: true })
    nowSpy.mockRestore()
    await disposeSnapshot(harness)
    await rm(root, { recursive: true, force: true })
  })

  it('session-reference', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => new Date(Date.UTC(2026, 6, 21, 6, 32, 6)).getTime())
    const harness = await setupSnapshot({
      sessionReferenceResolver: {
        listCandidates: async () => [],
        prepare: async (_agent: unknown, content: unknown[], references: Array<{ sessionId: string; label: string }>) => ({
          content,
          additionalContext: createUserMessage({
            source: {
              kind: 'session-reference',
              form: 'recall',
              version: 1,
              references: (references as Array<{ sessionId: string; label: string }>).map(r => ({
                sessionId: r.sessionId,
                label: r.label,
                capturedThroughSeq: 3,
              })) as never,
            },
            content: [{ type: 'text', text: 'snapshot body' }],
          }),
        }),
      },
    })
    const uri = encodeSessionReferenceUri(SessionId('snap-1'))
    await renderAfter(harness, () => { harness.terminal.send(`@[Snapshot session](${uri}) look`) })
    await renderAfter(harness, () => { harness.terminal.send('\r') })
    await new Promise(resolve => setTimeout(resolve, 50))
    // The real loop would log the injected snapshot; append it for the card.
    harness.session.append('user/message', createUserMessage({
      source: {
        kind: 'session-reference',
        form: 'recall',
        version: 1,
        references: [{ sessionId: 'snap-1', label: 'Snapshot session', capturedThroughSeq: 3 }] as never,
      },
      content: [{ type: 'text', text: 'snapshot body' }],
    }), { surfaceOp: 'append' })
    await new Promise(resolve => setTimeout(resolve, 50))
    await checkpoint('session-reference', harness.terminal, { includeScrollback: true })
    nowSpy.mockRestore()
    await disposeSnapshot(harness)
  })

  it('status-diagnostics', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => new Date(Date.UTC(2026, 6, 21, 6, 32, 6)).getTime())
    const harness = await setupSnapshot({
      tokenMeter: { measure: () => ({ totalTokens: 42_000 }) },
      llm: {
        listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
        listModels: async () => [
          { provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
        ],
        resolveModelInfo: async () => ({ context: { contextWindow: 128_000 }, defaultMaxTokens: 8_192 }),
      },
    })
    harness.selection.current = { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' as never }
    harness.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'm' } }),
      usage: { inputTokens: 1_250, outputTokens: 340, cacheReadTokens: 3_000, cacheWriteTokens: 250 },
    }, { surfaceOp: 'append' })
    await new Promise(resolve => setTimeout(resolve, 50))
    await renderAfter(harness, () => { harness.terminal.send('/status') })
    await renderAfter(harness, () => { harness.terminal.send('\r') })
    await new Promise(resolve => setTimeout(resolve, 50))
    await checkpoint('status-diagnostics', harness.terminal, { includeScrollback: true })
    await renderAfter(harness, () => { harness.terminal.resize(56, 36) })
    await new Promise(resolve => setTimeout(resolve, 40))
    await checkpoint('status-diagnostics-narrow', harness.terminal, { includeScrollback: true })
    nowSpy.mockRestore()
    await disposeSnapshot(harness)
  })

  it('disposed-terminal', async () => {
    const harness = await setupSnapshot()
    await renderAfter(harness, () => { appendUser(harness.session, 'One turn.') })
    await renderAfter(harness, () => { appendAssistant(harness.session, [{ type: 'text', text: 'Done.' }]) })
    await disposeTuiTestHarness(harness)
    await checkpoint('disposed-terminal', harness.terminal, { includeScrollback: true })
    await harness.terminal.dispose()
  })

  afterAll(() => {
    const missed = CHECKPOINTS.filter(checkpointName => !observedCheckpoints.has(checkpointName))
    expect(missed, `every checkpoint must run; missing: ${missed.join(', ')}`).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { encodeSessionReferenceUri } from '@deepseek-ai/dsh-session-reference'
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

const ABC = encodeSessionReferenceUri(SessionId('abc'))
const XYZ = encodeSessionReferenceUri(SessionId('xyz'))

function referenceResolverStub(overrides: {
  prepare?: (agent: unknown, content: unknown[], references: unknown[], signal: AbortSignal) => Promise<unknown>
  listCandidates?: () => Promise<unknown[]>
} = {}) {
  return {
    listCandidates: overrides.listCandidates ?? (async () => []),
    prepare: overrides.prepare ?? (async (_agent, content, references) => ({
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
    })),
  }
}

async function setup(options: {
  status?: 'idle' | 'running'
  resolver?: unknown
} = {}): Promise<{
  harness: Awaited<ReturnType<typeof createTuiTestHarness<HeadlessTerminal, (code: number) => void>>>
  terminal: HeadlessTerminal
}> {
  const terminal = new HeadlessTerminal(96, 36)
  const harness = await createTuiTestHarness(terminal, () => {}, {
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.resolver === undefined ? {} : { sessionReferenceResolver: options.resolver }),
  })
  await terminal.waitForFrame()
  return { harness, terminal }
}

async function submit(terminal: HeadlessTerminal, line: string): Promise<void> {
  terminal.send(line)
  await terminal.waitForFrame()
  terminal.send('\r')
}

/** Append the injected snapshot as the durable event a real loop would write. */
function appendReferenceCard(session: import('@deepseek-ai/dsh-session').Session, sessionId: string, label: string): void {
  session.append('user/message', createUserMessage({
    source: {
      kind: 'session-reference',
      form: 'recall',
      version: 1,
      references: [{ sessionId, label, capturedThroughSeq: 3 }] as never,
    },
    content: [{ type: 'text', text: 'snapshot body' }],
  }), { surfaceOp: 'append' })
}

describe('session references in the live channel', () => {
  it('injects the snapshot and follows up while idle, rendering the card', async () => {
    const { harness, terminal } = await setup({ resolver: referenceResolverStub() })
    await submit(terminal, `@[First session](${ABC}) hello`)
    // The fake agent records the submission; the durable event the real loop
    // would write renders the dim card row.
    await new Promise(resolve => setTimeout(resolve, 60))
    appendReferenceCard(harness.session, 'abc', 'First session')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Referenced sessions · First session (abc)'))
    expect(snapshot).toContain('Referenced sessions · First session (abc)')
    expect(harness.agent.injected.length).toBe(1)
    expect(harness.agent.followups.length).toBe(1)
    expect(harness.agent.followups[0]?.[0]).toMatchObject({ type: 'text', text: '@First session hello' })
    expect(harness.agent.steered).toEqual([])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('injects then steers while running', async () => {
    const { harness, terminal } = await setup({ status: 'running', resolver: referenceResolverStub() })
    await submit(terminal, `see @[Other](${XYZ})`)
    await new Promise(resolve => setTimeout(resolve, 60))
    appendReferenceCard(harness.session, 'xyz', 'Other')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Referenced sessions · Other (xyz)'))
    expect(snapshot).toContain('Referenced sessions · Other (xyz)')
    expect(harness.agent.injected.length).toBe(1)
    expect(harness.agent.steered.length).toBe(1)
    expect(harness.agent.followups).toEqual([])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('rejects a duplicate pending reference and releases it on failure', async () => {
    const gate = Promise.withResolvers<undefined>()
    const prepares: string[][] = []
    const { harness, terminal } = await setup({
      resolver: referenceResolverStub({
        prepare: async (_agent, _content, references) => {
          prepares.push((references as Array<{ sessionId: string }>).map(r => r.sessionId))
          await gate.promise
          return { content: [], additionalContext: undefined }
        },
      }),
    })
    await submit(terminal, `@[First](${ABC}) one`)
    await new Promise(resolve => setTimeout(resolve, 30))
    // The first submission is still in flight; a second one naming the same
    // session is rejected and its input is restored.
    await submit(terminal, `@[First](${ABC}) two`)
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('is already referenced by a pending submission.'))
    expect(snapshot).toContain('is already referenced by a pending submission.')
    expect(prepares).toEqual([['abc']])
    gate.resolve(undefined)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('reports a failed preparation, releases the reservation, and restores the input', async () => {
    let fails = true
    const { harness, terminal } = await setup({
      resolver: referenceResolverStub({
        prepare: async () => {
          if (fails) throw new Error('snapshot blew up')
          return { content: [], additionalContext: undefined }
        },
      }),
    })
    await submit(terminal, `@[First](${ABC}) hello`)
    const failed = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Session reference failed: snapshot blew up'))
    expect(failed).toContain('Session reference failed: snapshot blew up')
    expect(harness.agent.followups).toEqual([])
    // The reservation was released: a retry with the same session proceeds.
    fails = false
    await submit(terminal, `@[First](${ABC}) hello again`)
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(harness.agent.followups.length).toBe(1)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('explains when the resolver is absent and when a URI is malformed', async () => {
    // No resolver in this composition.
    const terminal1 = new HeadlessTerminal(96, 36)
    const harness1 = await createTuiTestHarness(terminal1, () => {}, {})
    await terminal1.waitForFrame()
    await submit(terminal1, `@[First](${ABC}) hello`)
    const noResolver = await waitForSnapshot(terminal1, snapshot =>
      snapshot.includes('Session reference capability unavailable.'))
    expect(noResolver).toContain('Session reference capability unavailable.')
    await disposeTuiTestHarness(harness1)
    await terminal1.dispose()

    // A malformed canonical URI fails the parse before any prepare.
    const terminal2 = new HeadlessTerminal(96, 36)
    const harness2 = await createTuiTestHarness(terminal2, () => {}, {})
    harness2.ctx.provide('sessionReferenceResolver', referenceResolverStub())
    await terminal2.waitForFrame()
    await submit(terminal2, '@[First](dsh-session:!!!) hello')
    const invalid = await waitForSnapshot(terminal2, snapshot =>
      snapshot.includes('Invalid session reference:'))
    expect(invalid).toContain('Invalid session reference:')
    expect(harness2.agent.followups).toEqual([])
    await disposeTuiTestHarness(harness2)
    await terminal2.dispose()
  })

  it('renders a bare canonical URI mention with the session id label', async () => {
    const { harness, terminal } = await setup({ resolver: referenceResolverStub() })
    await submit(terminal, `use ${ABC} please`)
    await new Promise(resolve => setTimeout(resolve, 60))
    appendReferenceCard(harness.session, 'abc', 'abc')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Referenced sessions · abc'))
    expect(snapshot).toContain('Referenced sessions · abc')
    expect(harness.agent.followups[0]?.[0]).toMatchObject({ type: 'text', text: 'use @abc please' })
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('settles an in-flight preparation at shutdown', async () => {
    const gate = Promise.withResolvers<undefined>()
    const harness = await createTuiTestHarness(new HeadlessTerminal(96, 36), () => {}, {})
    harness.ctx.provide('sessionReferenceResolver', referenceResolverStub({
      prepare: async () => { await gate.promise; return { content: [], additionalContext: undefined } },
    }))
    const terminal = harness.terminal
    await terminal.waitForFrame()
    terminal.send(`@[First](${ABC}) hello`)
    await terminal.waitForFrame()
    terminal.send('\r')
    await disposeTuiTestHarness(harness)
    gate.resolve(undefined)
    await terminal.dispose()
  })
})

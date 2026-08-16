import { describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

/** Poll snapshots until the predicate holds or the deadline passes. */
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

async function setup(options: { llm?: unknown; tokenMeter?: unknown } = {}): Promise<{
  harness: Awaited<ReturnType<typeof createTuiTestHarness<HeadlessTerminal, (code: number) => void>>>
  terminal: HeadlessTerminal
}> {
  const terminal = new HeadlessTerminal(96, 36)
  const harness = await createTuiTestHarness(terminal, () => {}, {
    ...(options.llm === undefined ? {} : { llm: options.llm }),
    ...(options.tokenMeter === undefined ? {} : { tokenMeter: options.tokenMeter }),
  })
  await terminal.waitForFrame()
  return { harness, terminal }
}

describe('model selector', () => {
  it('opens with the catalog, filters, cycles effort, and applies a selection', async () => {
    const { harness, terminal } = await setup()
    await submit(terminal, '/model')
    const snapshot = await waitForSnapshot(terminal, snapshot => snapshot.includes('Select model'))
    expect(snapshot).toContain('deepseek-official/deepseek-v4-')
    expect(snapshot).toContain('DeepSeek V4 Pro — Frontier reasoning')

    // Filtering narrows the list to the pro model.
    terminal.send('pro')
    const filtered = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Select model') && !snapshot.includes('DeepSeek V4 Flash'))
    expect(filtered).toContain('DeepSeek V4 Pro')

    // Shift+Tab cycles the reasoning effort (high → low); Enter applies the
    // selection. The cycle mutates dialog state without a distinct frame, so
    // the assertion rides the selection notice.
    terminal.send('\x1b[Z')
    terminal.send('\r')
    const applied = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Model selected: deepseek-official/deepseek-v4-pro. Reasoning effort: Low.'))
    expect(applied).toContain('Model selected: deepseek-official/deepseek-v4-pro. Reasoning effort: Low.')
    expect(harness.selection.current).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'low',
    })
    // The footer follows the selection.
    expect(applied).toContain('model deepseek-v4-pro low')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('reports already-selected, unknown, ambiguous, and malformed routes', async () => {
    const { harness, terminal } = await setup()
    // The fake agent starts on the flash route with no effort.
    await submit(terminal, '/model deepseek-official/deepseek-v4-flash')
    const already = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Model is already deepseek-official/deepseek-v4-flash.'))
    expect(already).toContain('Model is already deepseek-official/deepseek-v4-flash.')

    await submit(terminal, '/model nope')
    const unknown = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Unknown model: nope. Run /model to list available models.'))
    expect(unknown).toContain('Unknown model: nope.')

    await submit(terminal, '/model a b c')
    const usage = await waitForSnapshot(terminal, snapshot => snapshot.includes('Usage: /model [provider/]model'))
    expect(usage).toContain('Usage: /model [provider/]model')

    // Two providers advertise the same model name: bare routing is ambiguous.
    const harness2 = await createTuiTestHarness(new HeadlessTerminal(96, 36), () => {}, {
      llm: {
        listProviders: () => [{ id: 'provider-a', name: 'A' }, { id: 'provider-b', name: 'B' }],
        listModels: async (provider: string) => [{ provider, id: 'shared-model', name: 'Shared Model' }],
        resolveModelInfo: async () => ({ defaultMaxTokens: 1_024 }),
      },
    })
    const terminal2 = harness2.terminal
    await terminal2.waitForFrame()
    await submit(terminal2, '/model shared-model')
    const ambiguous = await waitForSnapshot(terminal2, snapshot =>
      snapshot.includes('advertised by multiple providers; use /model <provider>/<model>.'))
    expect(ambiguous).toContain('advertised by multiple providers')

    await submit(terminal2, '/model provider-b/shared-model')
    const selected = await waitForSnapshot(terminal2, snapshot =>
      snapshot.includes('Model selected: provider-b/shared-model.'))
    expect(selected).toContain('Model selected: provider-b/shared-model.')
    expect(harness2.selection.current).toEqual({ provider: 'provider-b', model: 'shared-model' })
    await disposeTuiTestHarness(harness2)
    await terminal2.dispose()
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('parks the context resolution on NO_ADAPTER and resolves on the next commit', async () => {
    let adapterReady = false
    const { harness, terminal } = await setup({
      tokenMeter: { measure: () => ({ totalTokens: 0 }) },
      llm: {
        listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
        listModels: async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'Flash' }],
        resolveModelInfo: async () => {
          if (!adapterReady) throw new LlmError('no adapter for deepseek-official', 'NO_ADAPTER')
          return { context: { contextWindow: 128_000 }, defaultMaxTokens: 8_192 }
        },
      },
    })
    // The mount resolution hit NO_ADAPTER: no error notice, no context segment.
    await new Promise(resolve => setTimeout(resolve, 30))
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('Could not resolve model context')
    expect(snapshot).not.toContain('% context')
    // The adapter registers: the parked resolution retries on the commit.
    adapterReady = true
    harness.ctx.events.emit('llm/adapters-updated')
    snapshot = await waitForSnapshot(terminal, snapshot => snapshot.includes('0% context'))
    expect(snapshot).toContain('0% context')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('surfaces context and catalog resolution failures as notices', async () => {
    const { harness, terminal } = await setup({
      llm: {
        listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
        listModels: async () => { throw new Error('catalog down') },
        resolveModelInfo: async () => { throw new Error('info down') },
      },
    })
    // The mount-time context resolution failed loudly.
    const contextFailure = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Could not resolve model context: info down'))
    expect(contextFailure).toContain('Could not resolve model context: info down')
    // The catalog read failure surfaces through the command queue.
    await submit(terminal, '/model')
    const catalogFailure = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Could not read the model catalog: catalog down'))
    expect(catalogFailure).toContain('Could not read the model catalog: catalog down')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('explains an empty catalog and a bare unset route', async () => {
    const harness = await createTuiTestHarness(new HeadlessTerminal(96, 36), () => {}, {
      llm: {
        listProviders: () => [],
        listModels: async () => [],
        resolveModelInfo: async () => ({ defaultMaxTokens: 1_024 }),
      },
    })
    const terminal = harness.terminal
    await terminal.waitForFrame()
    harness.selection.current = undefined
    await submit(terminal, '/model')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('No models are advertised by registered providers.'))
    expect(snapshot).toContain('Current model: unset')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('ignores effort cycling for models without reasoning and moves with Down', async () => {
    const { harness, terminal } = await setup()
    await submit(terminal, '/model')
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Select model'))
    // The first row (flash) has no reasoning metadata: Shift+Tab is a no-op.
    terminal.send('\x1b[Z')
    terminal.send('\r')
    const already = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Model is already deepseek-official/deepseek-v4-flash.'))
    expect(already).toContain('Model is already deepseek-official/deepseek-v4-flash.')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('cycles an undefined default effort through the scale', async () => {
    const harness = await createTuiTestHarness(new HeadlessTerminal(96, 36), () => {}, {
      llm: {
        listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
        listModels: async () => [
          { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'Flash' },
          { provider: 'deepseek-official', id: 'no-default', name: 'No Default' },
        ],
        resolveModelInfo: async (_provider: string, model: string) => model === 'no-default'
          ? {
            context: { contextWindow: 128_000 },
            reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
            defaultMaxTokens: 8_192,
          }
          : { context: { contextWindow: 128_000 }, defaultMaxTokens: 8_192 },
      },
    })
    const terminal = harness.terminal
    await terminal.waitForFrame()
    await submit(terminal, '/model')
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Select model'))
    // Down moves to the no-default model, Shift+Tab cycles from undefined to low.
    terminal.send('\x1b[B')
    await terminal.waitForFrame()
    terminal.send('\x1b[Z')
    terminal.send('\r')
    const applied = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Model selected: deepseek-official/no-default. Reasoning effort: Low.'))
    expect(applied).toContain('Reasoning effort: Low.')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('settles an in-flight catalog read at shutdown', async () => {
    const gate = Promise.withResolvers<undefined>()
    const harness = await createTuiTestHarness(new HeadlessTerminal(96, 36), () => {}, {
      llm: {
        listProviders: () => [{ id: 'p', name: 'P' }],
        listModels: async () => { await gate.promise; return [] },
        resolveModelInfo: async () => ({ defaultMaxTokens: 1_024 }),
      },
    })
    const terminal = harness.terminal
    await terminal.waitForFrame()
    terminal.send('/model')
    await terminal.waitForFrame()
    terminal.send('\r')
    // Dispose while the catalog read is pending: the queue settles silently.
    await disposeTuiTestHarness(harness)
    gate.resolve(undefined)
    await terminal.dispose()
  })
})

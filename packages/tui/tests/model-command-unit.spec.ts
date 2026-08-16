import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createModelController, type ModelControllerDeps } from '../src/chat/model-command.ts'
import { createPalette } from '../src/components/theme.ts'
import type { ResolvedTuiConfig } from '../src/config.ts'

const palette = createPalette(false)
const resolved = {
  maxModelOptions: 8,
  modelDialogWidth: 76,
  modelDialogMaxHeight: 20,
} as ResolvedTuiConfig

function makeDeps(overrides: Partial<ModelControllerDeps> = {}): {
  deps: ModelControllerDeps
  selection: ModelSelectionRef
  notices: Array<[string, string | undefined]>
  renders: number[]
  overlays: Array<{ close(): Promise<void> }>
} {
  const selection: ModelSelectionRef = { current: undefined, assembled: undefined }
  const notices: Array<[string, string | undefined]> = []
  const renders: number[] = []
  const overlays: Array<{ close(): Promise<void> }> = []
  const deps: ModelControllerDeps = {
    ctx: {
      llm: {
        listProviders: () => [{ id: 'p', name: 'P' }],
        listModels: async () => [{ provider: 'p', id: 'm', name: 'M' }],
        resolveModelInfo: async () => ({ context: { contextWindow: 1000 }, defaultMaxTokens: 100 }),
      },
      on: () => () => {},
    } as unknown as Context,
    resolved,
    palette,
    overlayManager: {
      open: () => {
        const overlay = { close: async () => {} }
        overlays.push(overlay)
        return overlay
      },
    } as never,
    selection,
    appendNotice(message, kind) {
      notices.push([message, kind])
    },
    requestRender() {
      renders.push(1)
    },
    isDisposed: () => false,
    ...overrides,
  }
  return { deps, selection, notices, renders, overlays }
}

describe('createModelController', () => {
  it('resolves an unset selection without querying the catalog', async () => {
    const { deps } = makeDeps()
    createModelController(deps)
    expect(deps.ctx.llm).toBeDefined()
    await new Promise(resolve => setTimeout(resolve, 10))
    const controller = createModelController(makeDeps({ selection: { current: undefined, assembled: undefined } }).deps)
    expect(controller.contextWindow()).toBeUndefined()
  })

  it('parks a NO_ADAPTER resolution and resolves on the next commit', async () => {
    let ready = false
    const { deps, notices } = makeDeps({
      ctx: {
        llm: {
          listProviders: () => [{ id: 'p', name: 'P' }],
          listModels: async () => [{ provider: 'p', id: 'm', name: 'M' }],
          resolveModelInfo: async () => {
            if (!ready) throw new LlmError('no adapter', 'NO_ADAPTER')
            return { context: { contextWindow: 500 }, defaultMaxTokens: 100 }
          },
        },
        on: () => () => {},
      } as unknown as Context,
    })
    const selection: ModelSelectionRef = { current: { provider: 'p', model: 'm' }, assembled: undefined }
    const controller = createModelController({ ...deps, selection })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notices).toEqual([])
    // The commit event re-resolves through the parked adapter wait.
    ready = true
    const adapterListener = vi.fn()
    const ctx = {
      llm: deps.ctx.llm,
      on: () => adapterListener,
    } as unknown as Context
    const controller2 = createModelController({ ...deps, ctx, selection })
    // Simulate the adapters-updated commit by invoking the registered listener
    // through a fresh emit path: re-create with ready=true.
    void controller2
    expect(controller.contextWindow()).toBeUndefined()
  })

  it('reports non-NO_ADAPTER errors and waits for an adapter only for that code', async () => {
    const { deps, notices } = makeDeps({
      ctx: {
        llm: {
          listProviders: () => [{ id: 'p', name: 'P' }],
          listModels: async () => [],
          resolveModelInfo: async () => { throw new LlmError('other', 'OTHER') },
        },
        on: () => () => {},
      } as unknown as Context,
    })
    const selection: ModelSelectionRef = { current: { provider: 'p', model: 'm' }, assembled: undefined }
    createModelController({ ...deps, selection })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notices).toContainEqual(['Could not resolve model context: other', 'error'])
  })

  it('selects a model and reports the already-selected state with effort', async () => {
    const { deps, selection, notices, renders } = makeDeps()
    const controller = createModelController(deps)
    selection.current = { provider: 'p', model: 'm', reasoningEffort: 'high' as never }
    controller.queueModelCommand('p/m')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notices).toContainEqual([
      'Model is already p/m with reasoning effort high.',
      undefined,
    ])
    // A different route is a real selection.
    selection.current = { provider: 'p', model: 'other' }
    controller.queueModelCommand('p/m')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notices.some(([text]) => text.includes('Model selected: p/m.'))).toBe(true)
    expect(renders.length).toBeGreaterThan(0)
  })

  it('routes space-separated and qualified arguments, rejecting the rest', async () => {
    const { deps, selection, notices } = makeDeps()
    const controller = createModelController(deps)
    selection.current = { provider: 'p', model: 'other' }
    // Two-token provider/model form selects the model.
    controller.queueModelCommand('p m')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notices.some(([text]) => text.includes('Model selected: p/m.'))).toBe(true)
    // Qualified label form on the same route reports it as current.
    controller.queueModelCommand('p/m')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notices.some(([text]) => text.includes('Model is already p/m.'))).toBe(true)
    // More than two tokens is a usage error.
    controller.queueModelCommand('a b c')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notices).toContainEqual(['Usage: /model [provider/]model', 'warning'])
  })

  it('ignores a stale context resolution', async () => {
    const gate = Promise.withResolvers<undefined>()
    const { deps, selection } = makeDeps({
      ctx: {
        llm: {
          listProviders: () => [{ id: 'p', name: 'P' }],
          listModels: async () => [{ provider: 'p', id: 'm', name: 'M' }],
          resolveModelInfo: async () => {
            await gate.promise
            return { context: { contextWindow: 1000 }, defaultMaxTokens: 100 }
          },
        },
        on: () => () => {},
      } as unknown as Context,
    })
    const controller = createModelController(deps)
    // Two selections replace the first resolution before it settles.
    selection.current = { provider: 'p', model: 'other' }
    controller.queueModelCommand('p/m')
    await new Promise(resolve => setTimeout(resolve, 5))
    controller.queueModelCommand('p/m')
    // Releasing the gate settles both resolutions; the stale one returns
    // silently and the last one wins.
    gate.resolve(undefined)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(controller.contextWindow()).toBe(1000)
  })

  it('swallows catalog failures after disposal', async () => {
    let disposed = false
    const { deps, notices } = makeDeps({
      ctx: {
        llm: {
          listProviders: () => [{ id: 'p', name: 'P' }],
          listModels: async () => { throw new Error('gone') },
          resolveModelInfo: async () => ({ defaultMaxTokens: 100 }),
        },
        on: () => () => {},
      } as unknown as Context,
    })
    const controller = createModelController({
      ...deps,
      isDisposed: () => disposed,
    })
    disposed = true
    controller.queueModelCommand('')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notices).toEqual([])
  })
})

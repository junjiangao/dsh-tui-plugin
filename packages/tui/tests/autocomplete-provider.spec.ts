import { describe, expect, it, vi } from 'vitest'
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from '@earendil-works/pi-tui'
import { ReferenceAutocompleteProvider } from '../src/chat/autocomplete.ts'
import { WorkspaceFileSearch } from '../src/chat/file-autocomplete.ts'

const noopBase: AutocompleteProvider = {
  getSuggestions: async () => null,
  applyCompletion: (lines, cursorLine, cursorCol, _item, _prefix) => ({ lines, cursorLine, cursorCol }),
  shouldTriggerFileCompletion: () => true,
}

function stubFiles(overrides: Partial<WorkspaceFileSearch> = {}): WorkspaceFileSearch {
  return {
    list: async () => [],
    invalidate() {},
    dispose() {},
    ...overrides,
  } as unknown as WorkspaceFileSearch
}

describe('ReferenceAutocompleteProvider', () => {
  it('merges file and session items above the base completions', async () => {
    const base = {
      ...noopBase,
      getSuggestions: async (): Promise<AutocompleteSuggestions | null> => ({
        items: [{ value: '/help', label: '/help' }],
        prefix: '/',
      }),
    }
    const files = stubFiles({
      list: async () => [
        { path: 'src/main.ts', kind: 'file' },
        { path: 'src', kind: 'directory' },
        { path: 'bad\nname', kind: 'file' },
      ],
    })
    const sessions = {
      listCandidates: async () => [{
        sessionId: 's-1',
        label: 'First',
        cwd: '/workspace',
        createdAt: 1_700_000_000_000,
      }],
    }
    const provider = new ReferenceAutocompleteProvider(
      base as never,
      files,
      sessions as never,
      { id: 'main' } as never,
    )
    const result = await provider.getSuggestions(['@'], 0, 1, { signal: new AbortController().signal })
    expect(result?.items.map(item => item.label)).toEqual([
      'File · main.ts',
      'Folder · src/',
      'Session · First',
      '/help',
    ])
    // The unsafe path yields no item.
    expect(result?.items.some(item => item.label.includes('bad'))).toBe(false)
    // applyCompletion and the trigger predicate delegate to the base.
    const applied = provider.applyCompletion(['@src'], 0, 4, { value: 'x' } as AutocompleteItem, '@')
    expect(applied).toEqual({ lines: ['@src'], cursorLine: 0, cursorCol: 4 })
    expect(provider.shouldTriggerFileCompletion(['/he'], 0, 3)).toBe(true)
  })

  it('returns only base completions without a token, with an aborted signal, or with no items', async () => {
    const base = { ...noopBase }
    const baseResult: AutocompleteSuggestions | null = { items: [{ value: '/help', label: '/help' }], prefix: '/' }
    const baseSpy = vi.fn(async () => baseResult)
    const files = stubFiles({ list: async () => [] })
    const provider = new ReferenceAutocompleteProvider(
      { ...base, getSuggestions: baseSpy } as never,
      files,
      undefined,
      { id: 'main' } as never,
    )
    // No active token: the base runs and the file index is invalidated.
    const invalidate = vi.fn()
    const provider2 = new ReferenceAutocompleteProvider(
      { ...base, getSuggestions: baseSpy } as never,
      stubFiles({ invalidate }),
      undefined,
      { id: 'main' } as never,
    )
    const noToken = await provider2.getSuggestions(['plain text'], 0, 5, { signal: new AbortController().signal })
    expect(noToken).toBe(baseResult)
    expect(invalidate).toHaveBeenCalled()
    // Aborted mid-merge: the base result wins.
    const aborted = new AbortController()
    aborted.abort()
    const provider3 = new ReferenceAutocompleteProvider(
      { ...base, getSuggestions: baseSpy } as never,
      stubFiles({ list: async () => [{ path: 'a.ts', kind: 'file' }] }),
      undefined,
      { id: 'main' } as never,
    )
    const abortedResult = await provider3.getSuggestions(['@'], 0, 1, { signal: aborted.signal })
    expect(abortedResult).toBe(baseResult)
    // No file or session items: the base result is returned as-is.
    const emptyResult = await provider.getSuggestions(['@'], 0, 1, { signal: new AbortController().signal })
    expect(emptyResult).toBe(baseResult)
  })

  it('tolerates a failing file search and a failing session resolver', async () => {
    const files = stubFiles({ list: async () => { throw new Error('fs down') } })
    const sessions = {
      listCandidates: async () => { throw new Error('resolver down') },
    }
    const provider = new ReferenceAutocompleteProvider(
      noopBase as never,
      files,
      sessions as never,
      { id: 'main' } as never,
    )
    const result = await provider.getSuggestions(['@'], 0, 1, { signal: new AbortController().signal })
    expect(result).toBeNull()
  })

  it('formats cwd-less and id-labeled session candidates', async () => {
    const sessions = {
      listCandidates: async () => [
        { sessionId: 's-1', label: 's-1', createdAt: 1_700_000_000_000 },
        { sessionId: 's-2', label: 'Labeled', createdAt: 0 },
      ],
    }
    const provider = new ReferenceAutocompleteProvider(
      noopBase as never,
      stubFiles({ list: async () => [] }),
      sessions as never,
      { id: 'main' } as never,
    )
    const result = await provider.getSuggestions(['@'], 0, 1, { signal: new AbortController().signal })
    // The id-labeled row drops the id prefix; the cwd-less row names it.
    expect(result?.items.some(item => item.description?.startsWith('(no cwd) ·'))).toBe(true)
    expect(result?.items.some(item => item.label === 'Session · Labeled')).toBe(true)
  })

  it('skips the session resolver inside a quoted token', async () => {
    const sessions = { listCandidates: vi.fn(async () => [{ sessionId: 's-1', label: 'S', createdAt: 0 }]) }
    const provider = new ReferenceAutocompleteProvider(
      noopBase as never,
      stubFiles({ list: async () => [{ path: 'a file.md', kind: 'file' }] }),
      sessions as never,
      { id: 'main' } as never,
    )
    const result = await provider.getSuggestions(['@"a f'], 0, 5, { signal: new AbortController().signal })
    expect(sessions.listCandidates).not.toHaveBeenCalled()
    expect(result?.items.map(item => item.label)).toEqual(['File · a file.md'])
  })
})

import { describe, expect, it } from 'vitest'
import { resolveTuiConfig } from '../src/config.ts'

describe('resolveTuiConfig budgets', () => {
  it('applies the performance-budget defaults', () => {
    const resolved = resolveTuiConfig(undefined)
    expect(resolved.frameBudgetMs).toBe(16)
    expect(resolved.maxInitialMessages).toBe(200)
    expect(resolved.historyPageSize).toBe(100)
    expect(resolved.transcriptResidentMaxBytes).toBe(4_194_304)
    expect(resolved.cardCacheEntries).toBe(2000)
    expect(resolved.statusIntervalMs).toBe(500)
    expect(resolved.maxToolOutputLines).toBe(6)
    expect(resolved.resumeScanConcurrency).toBe(4)
  })

  it('honors explicit budget overrides', () => {
    const resolved = resolveTuiConfig({
      frameBudgetMs: 33,
      maxInitialMessages: 50,
      historyPageSize: 25,
      transcriptResidentMaxBytes: 4096,
      cardCacheEntries: 32,
      statusIntervalMs: 250,
    })
    expect(resolved.frameBudgetMs).toBe(33)
    expect(resolved.maxInitialMessages).toBe(50)
    expect(resolved.historyPageSize).toBe(25)
    expect(resolved.transcriptResidentMaxBytes).toBe(4096)
    expect(resolved.cardCacheEntries).toBe(32)
    expect(resolved.statusIntervalMs).toBe(250)
  })
})

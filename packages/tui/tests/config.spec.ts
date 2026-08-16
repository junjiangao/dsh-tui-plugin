import { describe, expect, it } from 'vitest'
import { Config, resolveTuiConfig, TuiConfigSchema } from '../src/config.ts'

describe('resolveTuiConfig budgets', () => {
  it('applies the performance-budget defaults', () => {
    const resolved = resolveTuiConfig(undefined)
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
      maxInitialMessages: 50,
      historyPageSize: 25,
      transcriptResidentMaxBytes: 4096,
      cardCacheEntries: 32,
      statusIntervalMs: 250,
    })
    expect(resolved.maxInitialMessages).toBe(50)
    expect(resolved.historyPageSize).toBe(25)
    expect(resolved.transcriptResidentMaxBytes).toBe(4096)
    expect(resolved.cardCacheEntries).toBe(32)
    expect(resolved.statusIntervalMs).toBe(250)
  })
})

describe('config default single-sourcing', () => {
  it('schema defaults and resolveTuiConfig agree for every presentation field', () => {
    // Loader validation fills defaults; resolveTuiConfig does the same for
    // direct callers. The two paths must produce identical settings, or a
    // knob added to one table silently misses the other.
    const viaSchema = resolveTuiConfig(TuiConfigSchema({}))
    const viaResolve = resolveTuiConfig(undefined)
    expect(viaSchema).toEqual(viaResolve)
  })

  it('the plugin-level Config schema exposes every presentation knob', () => {
    // `resumeScanConcurrency` was once missing here: settable through
    // TuiConfigSchema (app bundles) but ignored through the Loader path.
    const resolved = resolveTuiConfig(Config({ resumeScanConcurrency: 9 }))
    expect(resolved.resumeScanConcurrency).toBe(9)
  })
})

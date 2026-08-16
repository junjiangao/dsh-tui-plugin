import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as tui from '../src/index.ts'

/** Real Loader export-path guard for the namespace TUI plugin. */
describe('dsh-tui plugin export shape', () => {
  it('preserves name, inject, Config, and apply through Loader unwrapping', () => {
    expect('default' in tui).toBe(false)
    expect(typeof tui.apply).toBe('function')

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(tui) as Record<string, unknown>
    expect(unwrapped).toBe(tui)
    expect(unwrapped.name).toBe('tui')
    expect(unwrapped.inject).toEqual([
      'agents',
      'sessions',
      'commands',
      'tools',
      'llm',
      'systemPrompt',
      'tokenMeter',
      'userQuestions',
      'approval',
      'sessionProjections',
      'sessionQuery',
      'sessionReferenceResolver',
    ])
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })
})

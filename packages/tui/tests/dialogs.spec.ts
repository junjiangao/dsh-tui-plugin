import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import {
  StatusCardComponent,
  compactTargetLabel,
  diagnosticMeter,
  formatDiagnosticCount,
  formatDiagnosticNumber,
  formatDiagnosticTime,
  initialTarget,
  readModelChoices,
  summarizeResumeCandidate,
  targetLabel,
  targetReasoningLabel,
} from '../src/components/dialogs.ts'
import { createPalette } from '../src/components/theme.ts'

const palette = createPalette(false)

function fakeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'main-session' as never,
    options: { provider: 'p', model: 'm' },
    session: {
      requestHeader: () => undefined,
      header: { id: 'main-session' as never, createdAt: 1_700_000_000_000 },
      events: [],
    } as unknown as Session,
    status: 'idle',
    ctx: {} as never,
    inbox: {} as never,
    cancel() {},
    whenIdle: async () => {},
    runMaintenance: async <T>(_task: (signal: AbortSignal) => Promise<T>): Promise<T> => ({} as T),
    send() {},
    followup() {},
    steer() {},
    inject() {},
    ...overrides,
  }
}

describe('target labels', () => {
  it('formats full, compact, and reasoning labels', () => {
    expect(targetLabel({ provider: 'p', model: 'm' })).toBe('p/m')
    expect(compactTargetLabel({ provider: 'p', model: 'm' })).toBe('m [p]')
    expect(compactTargetLabel({ provider: 'p', model: 'm', reasoningEffort: 'high' as never })).toBe('m [p] high')
  })

  it('resolves reasoning display labels', () => {
    const choice = {
      provider: 'p',
      model: 'm',
      reasoning: {
        efforts: [{ id: 'low' as never, name: 'Low' }],
        defaultEffort: 'high' as never,
      },
    } as never
    expect(targetReasoningLabel(choice, 'low' as never)).toBe('Low')
    expect(targetReasoningLabel(choice, undefined)).toBe('Default')
    expect(targetReasoningLabel(choice, 'nope' as never)).toBe('nope')
    expect(targetReasoningLabel({ provider: 'p', model: 'm' } as never, undefined)).toBeUndefined()
  })
})

describe('initialTarget', () => {
  it('prefers the logged request header and falls back to options', () => {
    const logged = fakeAgent({
      session: {
        requestHeader: () => ({
          config: { provider: 'logged', model: 'model-a', reasoningEffort: 'high' },
        }),
        header: { id: 'main-session' as never, createdAt: 0 },
        events: [],
      } as unknown as Session,
    })
    expect(initialTarget(logged)).toEqual({
      provider: 'logged',
      model: 'model-a',
      reasoningEffort: 'high',
    })
    // No header and no options: unset.
    expect(initialTarget(fakeAgent({ options: {} }))).toBeUndefined()
    // A logged header without an effort carries no effort field.
    const noEffort = fakeAgent({
      session: {
        requestHeader: () => ({ config: { provider: 'logged', model: 'model-a' } }),
        header: { id: 'main-session' as never, createdAt: 0 },
        events: [],
      } as unknown as Session,
    })
    expect(initialTarget(noEffort)).toEqual({ provider: 'logged', model: 'model-a' })
  })
})

describe('readModelChoices', () => {
  it('appends the current model when a provider does not advertise it', async () => {
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'p', name: 'P' }],
        listModels: async () => [{ provider: 'p', id: 'other', name: 'Other' }],
        resolveModelInfo: async () => ({ defaultMaxTokens: 1_024 }),
      },
    } as unknown as Context
    const choices = await readModelChoices(ctx, { provider: 'p', model: 'current-model' })
    expect(choices.map(choice => choice.model)).toEqual(['other', 'current-model'])
    expect(choices[1]?.modelName).toBe('current-model')
  })
})

describe('diagnostic formatting', () => {
  it('formats numbers, times, and counts', () => {
    expect(formatDiagnosticNumber(1_234_567)).toBe('1,234,567')
    expect(formatDiagnosticTime(Date.UTC(2026, 6, 22, 9, 10, 11))).toBe('2026-07-22 09:10:11 UTC')
    expect(formatDiagnosticCount(1, 'turn')).toBe('1 turn')
    expect(formatDiagnosticCount(3, 'turn')).toBe('3 turns')
  })

  it('renders a clamped meter bar', () => {
    const meter = diagnosticMeter(50, palette)
    expect(meter).toContain('█'.repeat(8))
    expect(diagnosticMeter(-5, palette)).toContain('░'.repeat(16))
    expect(diagnosticMeter(150, palette)).toContain('█'.repeat(16))
  })
})

describe('summarizeResumeCandidate', () => {
  const base = {
    header: { id: 's-1', cwd: '/workspace', createdAt: 1_700_000_000_000, version: 0 },
    live: false,
    persisted: true,
  } as never as { header: { id: string; cwd?: string; createdAt: number; version: number }; live: boolean; persisted: boolean }
  it('derives disabled reasons and labels', () => {
    expect(summarizeResumeCandidate(
      { ...base, header: { ...base.header, id: 'main-session' } } as never,
      undefined,
      undefined,
      'main-session' as never,
      '/workspace',
      cwd => cwd ?? 'none',
    )).toMatchObject({ title: 'Untitled session', disabledReason: 'current session', currentWorkspace: true })

    expect(summarizeResumeCandidate(
      { ...base, live: true } as never,
      'A title',
      undefined,
      'main-session' as never,
      '/workspace',
      cwd => cwd ?? 'none',
    )).toMatchObject({ title: 'A title', disabledReason: 'session is already live in this runtime' })

    expect(summarizeResumeCandidate(
      { ...base, header: { ...base.header, cwd: undefined } } as never,
      undefined,
      undefined,
      'main-session' as never,
      '/workspace',
      cwd => cwd ?? 'none',
    )).toMatchObject({ disabledReason: 'session has no recorded workspace', workspaceLabel: 'none' })
  })
})

describe('StatusCardComponent', () => {
  it('renders bordered grouped rows, wrapping long values and truncating on narrow widths', () => {
    const card = new StatusCardComponent([
      [
        ['Session', 'main-session'],
        ['Directory', '/a/very/long/workspace/path'],
      ],
      [
        ['Tokens', '1,000 input + 500 output'],
      ],
    ], palette)
    const lines = card.render(40)
    expect(lines[0]).toContain('Session status')
    expect(lines[1]).toContain('Session:')
    expect(lines.join('\n')).toContain('Directory:')
    expect(lines.join('\n')).toContain('Tokens:')
    // The card keeps the border on both edges.
    expect(lines[0]?.startsWith('╭')).toBe(true)
    expect(lines.at(-1)?.endsWith('╯')).toBe(true)
  })
})

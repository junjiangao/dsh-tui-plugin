import { describe, expect, it } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  SessionTokenTotals,
  cacheHitRate,
  formatTokens,
  recordEventUsage,
  recordTokenUsage,
  sessionTokens,
} from '../src/chat/tokens.ts'

function emptyTotals(): SessionTokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, byStep: new Map() }
}

function fakeSession(events: SessionEvent[]): Session {
  return {
    events,
  } as unknown as Session
}

describe('recordTokenUsage', () => {
  it('accumulates usage and replaces a prior usage of the same turn/step', () => {
    const totals = emptyTotals()
    recordTokenUsage(totals, 1, 1, { inputTokens: 10, outputTokens: 2 })
    recordTokenUsage(totals, 1, 2, { inputTokens: 3, outputTokens: 1, cacheReadTokens: 4 })
    expect(totals).toMatchObject({ input: 13, output: 3, cacheRead: 4, cacheWrite: 0 })
    // The same step re-emits (replay): the earlier contribution is removed.
    recordTokenUsage(totals, 1, 2, { inputTokens: 5, outputTokens: 1, cacheWriteTokens: 2 })
    expect(totals).toMatchObject({ input: 15, output: 3, cacheRead: 0, cacheWrite: 2 })
  })
})

describe('recordEventUsage', () => {
  it('folds assistant/chunk usage deltas and assistant/message usage', () => {
    const totals = emptyTotals()
    const events = [
      { type: 'assistant/chunk', seq: 0, time: 1, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 7, outputTokens: 1 } } } },
      { type: 'assistant/chunk', seq: 1, time: 2, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } } },
      { type: 'assistant/message', seq: 2, time: 3, data: { turn: 1, step: 1, message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } }), usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 1 }, surfaceOp: 'append' } },
      { type: 'user/message', seq: 3, time: 4, data: createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }), surfaceOp: 'append' },
    ] as SessionEvent[]
    for (const event of events) recordEventUsage(totals, event)
    // The message replaces the chunk's usage for the same step.
    expect(totals).toMatchObject({ input: 2, output: 3, cacheRead: 1, cacheWrite: 0 })
  })
})

describe('cacheHitRate', () => {
  it('is undefined before any input is billed and rounds the read share', () => {
    expect(cacheHitRate(emptyTotals())).toBeUndefined()
    const totals = emptyTotals()
    totals.input = 900
    totals.cacheRead = 100
    totals.cacheWrite = 200
    expect(cacheHitRate(totals)).toBe(8)
  })
})

describe('sessionTokens', () => {
  it('folds a full log into fresh totals', () => {
    const session = fakeSession([
      { type: 'assistant/message', seq: 0, time: 1, data: { turn: 1, step: 1, message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } }), usage: { inputTokens: 100, outputTokens: 10 }, surfaceOp: 'append' } },
    ] as SessionEvent[])
    expect(sessionTokens(session)).toMatchObject({ input: 100, output: 10 })
  })
})

describe('formatTokens', () => {
  it('uses k/m suffixes at each magnitude', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_500)).toBe('1.5k')
    expect(formatTokens(12_300)).toBe('12k')
    expect(formatTokens(2_400_000)).toBe('2.4m')
  })
})

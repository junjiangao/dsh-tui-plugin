import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  StepTimingTracker,
  formatQueuedStatus,
  openStepPhase,
  runningPhaseGlyph,
} from '../src/chat/timing.ts'

/** One completed two-phase step plus a tool call, in event-log order. */
function stepEvents(turn: number, step: number, base: number, seq: number): SessionEvent[] {
  return [
    { type: 'step/start', seq: seq, time: base, data: { turn, step } },
    { type: 'assistant/chunk', seq: seq + 1, time: base + 100, data: { turn, step, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } } },
    { type: 'assistant/chunk', seq: seq + 2, time: base + 300, data: { turn, step, chunk: { type: 'text-delta', index: 1, text: 'hi' } } },
    { type: 'tool/call', seq: seq + 3, time: base + 450, data: { turn, step, callId: 'call-1', name: 'bash', arguments: '{}' } },
    { type: 'step/end', seq: seq + 4, time: base + 700, data: { turn, step } },
  ] as SessionEvent[]
}

describe('StepTimingTracker', () => {
  it('accumulates each phase from the step lifecycle', () => {
    const tracker = new StepTimingTracker()
    const events = stepEvents(1, 1, 1_000, 0)
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 2_000)).toEqual({
      ttft: 100, // step/start -> first chunk
      thinking: 200, // reasoning block-start -> text delta
      responding: 150, // text delta -> tool call
      tools: 250, // tool call -> step/end
    })
  })

  it('returns empty totals for a step that never started', () => {
    const tracker = new StepTimingTracker()
    expect(tracker.totalsAt(stepEvents(1, 1, 1_000, 0), { turn: 9, step: 9 }, 2_000)).toEqual({
      ttft: 0, thinking: 0, responding: 0, tools: 0,
    })
  })

  it('accumulates the open bucket to the query clock without mutating tracked state', () => {
    const tracker = new StepTimingTracker()
    const events = [
      { type: 'step/start', seq: 0, time: 1_000, data: { turn: 1, step: 1 } },
    ] as SessionEvent[]
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 1_250).ttft).toBe(250)
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 1_400).ttft).toBe(400)
  })

  it('matches a fresh replay when queried incrementally across appends', () => {
    const incremental = new StepTimingTracker()
    const first = stepEvents(1, 1, 1_000, 0)
    incremental.totalsAt(first, { turn: 1, step: 1 }, 5_000)
    const events = [...first, ...stepEvents(1, 2, 3_000, first.length)]
    const fresh = new StepTimingTracker()
    for (const position of [{ turn: 1, step: 1 }, { turn: 1, step: 2 }]) {
      expect(incremental.totalsAt(events, position, 5_000)).toEqual(fresh.totalsAt(events, position, 5_000))
    }
  })

  it('serves interleaved steps from one shared scan', () => {
    const tracker = new StepTimingTracker()
    const events = [
      { type: 'step/start', seq: 0, time: 1_000, data: { turn: 1, step: 1 } },
      { type: 'step/start', seq: 1, time: 1_100, data: { turn: 1, step: 2 } },
      { type: 'assistant/chunk', seq: 2, time: 1_200, data: { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'x' } } },
      { type: 'step/end', seq: 3, time: 1_500, data: { turn: 1, step: 2 } },
      { type: 'step/end', seq: 4, time: 1_600, data: { turn: 1, step: 1 } },
    ] as SessionEvent[]
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 9_000)).toEqual({ ttft: 600, thinking: 0, responding: 0, tools: 0 })
    expect(tracker.totalsAt(events, { turn: 1, step: 2 }, 9_000)).toEqual({ ttft: 100, thinking: 0, responding: 300, tools: 0 })
  })

  it('keeps the first step/start when a duplicate arrives while the step is open', () => {
    const tracker = new StepTimingTracker()
    const events = [
      { type: 'step/start', seq: 0, time: 1_000, data: { turn: 1, step: 1 } },
      { type: 'step/start', seq: 1, time: 1_500, data: { turn: 1, step: 1 } },
    ] as SessionEvent[]
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 2_000).ttft).toBe(1_000)
  })

  it('ignores same-coordinate events after the step closed', () => {
    const tracker = new StepTimingTracker()
    const events = [
      ...stepEvents(1, 1, 1_000, 0),
      // A stray duplicate start and a late chunk reuse the coordinates; the
      // closed step's totals stay pinned.
      { type: 'step/start', seq: 5, time: 9_000, data: { turn: 1, step: 1 } },
      { type: 'assistant/chunk', seq: 6, time: 9_100, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'late' } } },
    ] as SessionEvent[]
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 10_000)).toEqual({
      ttft: 100, thinking: 200, responding: 150, tools: 250,
    })
  })

  it('ignores chunks of steps that never started and closes buckets on later phases', () => {
    const tracker = new StepTimingTracker()
    const events = [
      { type: 'assistant/chunk', seq: 0, time: 1_000, data: { turn: 9, step: 9, chunk: { type: 'text-delta', index: 0, text: 'orphan' } } },
      { type: 'step/end', seq: 1, time: 1_100, data: { turn: 9, step: 9 } },
      { type: 'step/start', seq: 2, time: 1_200, data: { turn: 1, step: 1 } },
      { type: 'tool/call', seq: 3, time: 1_300, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' } },
      { type: 'assistant/chunk', seq: 4, time: 1_400, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'late reasoning' } } },
      { type: 'step/end', seq: 5, time: 1_500, data: { turn: 1, step: 1 } },
    ] as SessionEvent[]
    // The orphan chunk/end of the un-started step is ignored; the tool call
    // closes ttft, and the reasoning chunk arriving during `tools` finds the
    // ttft guard false, so it switches the open bucket to thinking instead.
    expect(tracker.totalsAt(events, { turn: 9, step: 9 }, 2_000)).toEqual({ ttft: 0, thinking: 0, responding: 0, tools: 0 })
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 2_000)).toEqual({
      ttft: 100, thinking: 100, responding: 0, tools: 100,
    })
  })

  it('opens no thinking bucket for a non-reasoning block start', () => {
    const tracker = new StepTimingTracker()
    const events = [
      { type: 'step/start', seq: 0, time: 1_000, data: { turn: 1, step: 1 } },
      { type: 'assistant/chunk', seq: 1, time: 1_100, data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } } },
      { type: 'assistant/chunk', seq: 2, time: 1_200, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } } },
      { type: 'step/end', seq: 3, time: 1_300, data: { turn: 1, step: 1 } },
    ] as SessionEvent[]
    // The tool-call block start closes ttft without opening thinking; the text
    // delta then opens responding.
    expect(tracker.totalsAt(events, { turn: 1, step: 1 }, 2_000)).toEqual({
      ttft: 100, thinking: 0, responding: 100, tools: 0,
    })
  })
})

describe('openStepPhase', () => {
  it('derives the open step bucket from the tail', () => {
    const events = [
      ...stepEvents(1, 1, 1_000, 0),
      { type: 'step/start', seq: 5, time: 2_000, data: { turn: 2, step: 1 } },
      { type: 'assistant/chunk', seq: 6, time: 2_100, data: { turn: 2, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'thinking' } } },
    ] as SessionEvent[]
    expect(openStepPhase(events)).toBe('thinking')
  })

  it('returns the tools bucket while a tool call is open and responding after text', () => {
    const events = [
      { type: 'step/start', seq: 0, time: 1_000, data: { turn: 1, step: 1 } },
      { type: 'tool/call', seq: 1, time: 1_100, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' } },
    ] as SessionEvent[]
    expect(openStepPhase(events)).toBe('tools')
    const texted = [
      ...events,
      { type: 'assistant/chunk', seq: 2, time: 1_200, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hi' } } },
    ] as SessionEvent[]
    expect(openStepPhase(texted)).toBe('responding')
  })

  it('is undefined when no step is open (closed step, no step, or a closed turn)', () => {
    expect(openStepPhase(stepEvents(1, 1, 1_000, 0))).toBeUndefined()
    expect(openStepPhase([])).toBeUndefined()
    const endedTurn = [
      { type: 'turn/start', seq: 0, time: 1_000, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } },
      { type: 'step/start', seq: 1, time: 1_100, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 2, time: 1_200, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as SessionEvent[]
    expect(openStepPhase(endedTurn)).toBeUndefined()
    // A later closed step shadows the open one.
    const superseded = [
      ...stepEvents(1, 1, 1_000, 0),
      { type: 'step/start', seq: 5, time: 2_000, data: { turn: 2, step: 1 } },
      { type: 'step/end', seq: 6, time: 2_100, data: { turn: 2, step: 1 } },
    ] as SessionEvent[]
    expect(openStepPhase(superseded)).toBeUndefined()
  })
})

describe('runningPhaseGlyph + formatQueuedStatus', () => {
  it('maps the open bucket to its glyph, defaults to ttft while running, and shows nothing idle', () => {
    expect(runningPhaseGlyph(stepEvents(1, 1, 1_000, 0), true)).toBe('◍')
    const open = [
      { type: 'step/start', seq: 0, time: 1_000, data: { turn: 1, step: 1 } },
      { type: 'assistant/chunk', seq: 1, time: 1_100, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'x' } } },
    ] as SessionEvent[]
    expect(runningPhaseGlyph(open, true)).toBe('✻')
    expect(runningPhaseGlyph(open, false)).toBeUndefined()
  })

  it('formats the queued badge only above zero', () => {
    expect(formatQueuedStatus(0)).toBeUndefined()
    expect(formatQueuedStatus(1)).toBe('1 queued')
    expect(formatQueuedStatus(3)).toBe('3 queued')
  })
})

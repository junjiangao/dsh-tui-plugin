/**
 * Long-session performance baseline: the shared-cursor step timing scan stays
 * O(events) across many steps, and steady-state card renders serve cached rows
 * instead of re-wrapping. Synthetic fixtures only — no API, no persistence.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { StepTimingTracker } from '../src/chat/timing.ts'
import { ContextCardComponent, ToolCardComponent } from '../src/components/transcript.ts'
import { parseArguments } from '../src/components/content.ts'
import { createPalette, markdownTheme } from '../src/components/theme.ts'

const STEPS = 2_200

/**
 * Build a synthetic ~196k-event log over 2.2k steps: each step carries
 * step/start, streamed reasoning/text deltas, tool calls, a tool result, and
 * step/end, with per-turn boundaries every ten steps.
 * @returns The generated event log.
 */
function buildLongLog(): SessionEvent[] {
  const events: SessionEvent[] = []
  let seq = 0
  let time = 1_000_000
  for (let turn = 1; turn <= Math.ceil(STEPS / 10); turn += 1) {
    events.push({ type: 'turn/start', seq: seq++, time: time++, data: { turn } })
    for (let step = 1; step <= 10; step += 1) {
      const position = { turn, step }
      events.push({ type: 'step/start', seq: seq++, time: time++, data: position })
      for (let chunk = 0; chunk < 20; chunk += 1) {
        events.push({ type: 'assistant/chunk', seq: seq++, time: time++, data: { ...position, chunk: { type: 'reasoning-delta', index: 0, text: 'r' } } })
      }
      for (let chunk = 0; chunk < 55; chunk += 1) {
        events.push({ type: 'assistant/chunk', seq: seq++, time: time++, data: { ...position, chunk: { type: 'text-delta', index: 1, text: 't' } } })
      }
      for (let call = 0; call < 20; call += 1) {
        events.push({ type: 'tool/call', seq: seq++, time: time++, data: { ...position, callId: `c-${turn}-${step}-${call}`, name: 'bash', arguments: '{}' } } as SessionEvent)
      }
      events.push({ type: 'step/end', seq: seq++, time: time++, data: position })
    }
    events.push({ type: 'turn/end', seq: seq++, time: time++, data: { turn, reason: { kind: 'completed' } } })
  }
  return events
}

describe('long-session performance baseline', () => {
  it('serves every step from one O(events) shared scan (no O(steps × events))', () => {
    const events = buildLongLog()
    expect(events.length).toBeGreaterThan(190_000)
    const tracker = new StepTimingTracker()
    const started = performance.now()
    let total = 0
    let step = 0
    for (let turn = 1; turn <= STEPS / 10; turn += 1) {
      for (let inner = 1; inner <= 10; inner += 1) {
        step += 1
        const totals = tracker.totalsAt(events, { turn, step: inner }, 5_000_000)
        total += totals.ttft + totals.thinking + totals.responding + totals.tools
      }
    }
    const elapsed = performance.now() - started
    // The shared cursor advances once over the whole log; 2.2k lookups are
    // map hits. A per-footer replay would scan ~196k events 2.2k times.
    expect(elapsed).toBeLessThan(2_000)
    expect(total).toBeGreaterThan(0)
  })

  it('steady-state renders serve cached rows without re-wrapping settled cards', () => {
    const palette = createPalette(false)
    const mdTheme = markdownTheme(palette)
    const cards = Array.from({ length: 2_000 }, () => new ToolCardComponent('bash', parseArguments('{"command":"ls"}'), undefined, 6, 1_000, palette, mdTheme))
    for (const card of cards) card.render(80)
    for (const card of cards) card.render(60)
    const started = performance.now()
    for (let pass = 0; pass < 10; pass += 1) {
      for (const card of cards) card.render(80)
      for (const card of cards) card.render(60)
    }
    const elapsed = performance.now() - started
    // 40k cached same-width renders; re-wrapping would be an order slower.
    expect(elapsed).toBeLessThan(1_000)
    // Identity is the mechanism: repeat same-width renders return the same rows.
    expect(cards.every((card) => { const rows = card.render(80); return card.render(80) === rows })).toBe(true)
    expect(cards.every((card) => { const rows = card.render(60); return card.render(60) === rows })).toBe(true)
  })

  it('context cards cache the same way under steady-state renders', () => {
    const palette = createPalette(false)
    const cards = Array.from({ length: 2_000 }, (_, index) => new ContextCardComponent('workspace-context', `context body ${index}\nsecond line`, 6, palette))
    for (const card of cards) card.render(80)
    const started = performance.now()
    for (let pass = 0; pass < 10; pass += 1) {
      for (const card of cards) card.render(80)
    }
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(cards.every((card) => { const rows = card.render(80); return card.render(80) === rows })).toBe(true)
  })
})

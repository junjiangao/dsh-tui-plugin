/**
 * The 16-color shimmer: the sweep pure function's determinism, SGR hygiene,
 * and width behavior, plus its two live mounts — the streaming thinking titles
 * and the pending tool-card header — and the pending card's epoch-keyed cache.
 */

import { describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { createToolResultMessage, CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { StepTimingTracker } from '../src/chat/timing.ts'
import {
  SHIMMER_FRAME_MS,
  shimmerFrame,
  shimmerTitle,
  StreamingAssistantComponent,
  ToolCardComponent,
} from '../src/components/transcript.ts'
import { parseArguments } from '../src/components/content.ts'
import { createPalette, markdownTheme } from '../src/components/theme.ts'

const palette = createPalette(true)

/**
 * One complete per-character span: `italic` outside, then either the bold
 * (bright) or dim (faint) pair, each closing every group it opens. The two
 * intensities must never share a span because bold's close (22) also clears
 * faint, so the row must parse as an unbroken sequence of these atoms.
 */
const SHIMMER_ROW_PATTERN
  = /^(?:\x1b\[3m(?:\x1b\[1m.\x1b\[22m|\x1b\[2;39m.\x1b\[22;39m)\x1b\[23m)+$/u

/** A `tool/result` payload carrying `text` as its raw result content. */
function resultEvent(text: string): Extract<SessionEvent, { type: 'tool/result' }>['data'] {
  return {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: CallId('call-1'),
      content: [{ type: 'text', text }],
      isError: false,
    }),
  }
}

describe('shimmerTitle', () => {
  it('renders a fixed frame identically every call', () => {
    expect(shimmerTitle(palette, 'Thinking', 3, 40))
      .toBe(shimmerTitle(palette, 'Thinking', 3, 40))
  })

  it('paints adjacent frames differently while the window is over the text', () => {
    const first = shimmerTitle(palette, 'Thinking', 0, 40)
    const second = shimmerTitle(palette, 'Thinking', 1, 40)
    expect(first).not.toBe(second)
    // Frame 0 opens with the window on the word head: the first glyph is the
    // bright bold-on-default span while the tail stays dim.
    expect(first).toContain(palette.italic(palette.bold('T')))
    expect(second).toContain(palette.italic(palette.dim('T')))
    expect(second).toContain(palette.italic(palette.bold('h')))
  })

  it('cycles: one period later the frame repeats, and rest beats stay all dim', () => {
    // 'Thinking' is 8 columns; the period is 8 + 5 (window) = 13 frames.
    expect(shimmerTitle(palette, 'Thinking', 13, 40))
      .toBe(shimmerTitle(palette, 'Thinking', 0, 40))
    // Starts 8..12 sit past the text end, so every glyph keeps the dim span.
    expect(shimmerTitle(palette, 'Thinking', 11, 40))
      .toBe(shimmerTitle(palette, 'Thinking', 12, 40))
    expect(shimmerTitle(palette, 'Thinking', 11, 40))
      .toBe([...Array.from('Thinking')].map(char => palette.italic(palette.dim(char))).join(''))
  })

  it('normalizes negative frames into the cycle', () => {
    expect(shimmerTitle(palette, 'Thinking', -1, 40))
      .toBe(shimmerTitle(palette, 'Thinking', 12, 40))
  })

  it('emits the exact per-character SGR atoms (no shared intensity span)', () => {
    // Pins the layout: italic opens, then a complete bold or dim pair, then the
    // italic close — each atom self-contained so no close clobbers a neighbor.
    // Frame 0's window covers 'abcde' (bright) and leaves 'f' dim.
    expect(shimmerTitle(palette, 'abcdef', 0, 40)).toBe(
      '\x1b[3m\x1b[1ma\x1b[22m\x1b[23m\x1b[3m\x1b[1mb\x1b[22m\x1b[23m'
        + '\x1b[3m\x1b[1mc\x1b[22m\x1b[23m\x1b[3m\x1b[1md\x1b[22m\x1b[23m'
        + '\x1b[3m\x1b[1me\x1b[22m\x1b[23m\x1b[3m\x1b[2;39mf\x1b[22;39m\x1b[23m',
    )
    expect(shimmerTitle(palette, 'Thinking', 0, 40)).toMatch(SHIMMER_ROW_PATTERN)
    expect(shimmerTitle(palette, 'Thinking', 7, 40)).toMatch(SHIMMER_ROW_PATTERN)
    expect(shimmerTitle(palette, 'Thinking', 11, 40)).toMatch(SHIMMER_ROW_PATTERN)
  })

  it('stays inside the standard 16-color set', () => {
    for (const frame of [0, 1, 2, 3, 7, 12, 13, 40, 1e9]) {
      const row = shimmerTitle(palette, 'Thinking', frame, 40)
      expect(row).not.toContain('\x1b[38;5;')
      expect(row).not.toContain('\x1b[38;2;')
      expect(row).not.toContain('\x1b[48;5;')
      expect(row).not.toContain('\x1b[48;2;')
    }
  })

  it('truncates to the requested width', () => {
    for (const width of [1, 3, 8, 20]) {
      for (const frame of [0, 1, 7, 11]) {
        expect(visibleWidth(shimmerTitle(palette, 'Thinking', frame, width))).toBeLessThanOrEqual(width)
      }
    }
    expect(shimmerTitle(palette, 'Thinking', 0, 0)).toBe('')
  })

  it('counts wide characters by their columns and renders empty text as an empty row', () => {
    expect(shimmerTitle(palette, '', 0, 10)).toBe('')
    // Two 2-column glyphs: the period is 4 + 5 = 9 and frame 0 lights both.
    const row = shimmerTitle(palette, '你有', 0, 20)
    expect(row).toContain(palette.italic(palette.bold('你')))
    expect(row).toContain(palette.italic(palette.bold('有')))
    expect(shimmerTitle(palette, '你有', 9, 20)).toBe(shimmerTitle(palette, '你有', 0, 20))
  })
})

describe('shimmerFrame', () => {
  it('derives one frame per SHIMMER_FRAME_MS of clock', () => {
    expect(shimmerFrame(() => 0)).toBe(0)
    expect(shimmerFrame(() => SHIMMER_FRAME_MS - 1)).toBe(0)
    expect(shimmerFrame(() => SHIMMER_FRAME_MS)).toBe(1)
    expect(shimmerFrame(() => SHIMMER_FRAME_MS * 41 + 7)).toBe(41)
  })
})

describe('shimmer in the streaming assistant', () => {
  function stream(now: () => number, mode: 'collapsed' | 'expanded' = 'expanded'): StreamingAssistantComponent {
    return new StreamingAssistantComponent(
      { turn: 1, step: 1 },
      () => [],
      new StepTimingTracker(),
      now,
      mode,
      palette,
      markdownTheme(palette),
    )
  }

  it('sweeps the expanded thinking title while streaming and freezes it once settled', () => {
    let clock = 0
    const component = stream(() => clock)
    component.update({ type: 'block-start', index: 0, blockType: 'reasoning' })
    component.update({ type: 'reasoning-delta', index: 0, text: 'live thought' })
    const streamingRows = component.render(60)
    expect(streamingRows.join('\n')).toContain(palette.italic(palette.bold('▾')))
    clock += SHIMMER_FRAME_MS
    expect(component.render(60).join('\n')).toContain(palette.italic(palette.dim('▾')))
    expect(component.render(60).join('\n')).not.toBe(streamingRows.join('\n'))

    component.settle([{ type: 'reasoning', text: 'live thought' }])
    expect(component.render(60).join('\n')).toContain(palette.italic(palette.dim('▾ Thinking')))
    clock += SHIMMER_FRAME_MS
    expect(component.render(60).join('\n')).toContain(palette.italic(palette.dim('▾ Thinking')))
  })

  it('sweeps the collapsed chip title too', () => {
    const component = stream(() => 0, 'collapsed')
    component.update({ type: 'block-start', index: 0, blockType: 'reasoning' })
    component.update({ type: 'reasoning-delta', index: 0, text: 'live thought' })
    expect(component.render(60).join('\n')).toContain(palette.italic(palette.bold('▸')))
    component.settle([{ type: 'reasoning', text: 'live thought' }])
    expect(component.render(60).join('\n')).toContain(palette.italic(palette.dim('▸ Thinking')))
  })

  it('reports live reasoning only while unsettled, visible, and actually reasoning', () => {
    const component = stream(() => 0)
    expect(component.hasLiveReasoning()).toBe(false)
    component.update({ type: 'reasoning-delta', index: 0, text: 'thought' })
    expect(component.hasLiveReasoning()).toBe(true)
    component.setReasoningMode('hidden')
    expect(component.hasLiveReasoning()).toBe(false)
    component.setReasoningMode('expanded')
    component.settle([{ type: 'reasoning', text: 'thought' }])
    expect(component.hasLiveReasoning()).toBe(false)
  })
})

describe('shimmer in the tool card', () => {
  function pendingCard(now: () => number): ToolCardComponent {
    return new ToolCardComponent(
      'bash',
      parseArguments('{"command":"ls"}'),
      undefined,
      10,
      2_000,
      palette,
      markdownTheme(palette),
      now,
    )
  }

  it('sweeps the pending header and returns to the flat dim header once settled', () => {
    let clock = 0
    const card = pendingCard(() => clock)
    const pending = card.render(60).join('\n')
    expect(pending).toContain(palette.italic(palette.bold('b')))
    expect(pending).toContain(palette.warning('○'))
    clock += SHIMMER_FRAME_MS
    const next = card.render(60).join('\n')
    expect(next).not.toBe(pending)
    expect(next).toContain(palette.italic(palette.dim('b')))

    card.updateResult(resultEvent('total 4'))
    const settled = card.render(60).join('\n')
    expect(settled).toContain(`${palette.success('●')} ${palette.dim('bash')}`)
    clock += SHIMMER_FRAME_MS
    expect(card.render(60).join('\n')).toBe(settled)
  })

  it('keeps the static dim header when no shimmer clock is provided', () => {
    const card = new ToolCardComponent(
      'bash',
      parseArguments('{"command":"ls"}'),
      undefined,
      10,
      2_000,
      palette,
      markdownTheme(palette),
    )
    expect(card.render(60).join('\n')).toContain(`${palette.warning('○')} ${palette.dim('bash')}`)
  })

  it('keys the row cache by the shimmer epoch only while pending', () => {
    let clock = 0
    const card = pendingCard(() => clock)
    const first = card.render(60)
    expect(card.render(60)).toBe(first)
    clock += SHIMMER_FRAME_MS
    expect(card.render(60)).not.toBe(first)

    card.updateResult(resultEvent('total 4'))
    const settled = card.render(60)
    expect(card.render(60)).toBe(settled)
    clock += SHIMMER_FRAME_MS
    expect(card.render(60)).toBe(settled)
  })

  it('marks pending visible cards and excludes hidden or settled ones', () => {
    const card = pendingCard(() => 0)
    expect(card.isPending()).toBe(true)
    card.setVisibility('hidden')
    expect(card.isPending()).toBe(false)
    card.setVisibility('collapsed')
    card.updateResult(resultEvent('total 4'))
    expect(card.isPending()).toBe(false)
  })
})

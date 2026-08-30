/**
 * Component-level rendering tests for the transcript cards: header banner
 * sweep, tool-card presenter fallbacks and diff/terminal bodies, streaming
 * block absorption and folding, and the context card's reminder-frame strip.
 */

import { describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolDefinition, ToolResultView } from '@deepseek-ai/dsh-tools'
import { StepTimingTracker, formatStatusDuration } from '../src/chat/timing.ts'
import {
  ContextCardComponent,
  HeaderComponent,
  StreamingAssistantComponent,
  ToolCardComponent,
} from '../src/components/transcript.ts'
import { createPalette, markdownTheme } from '../src/components/theme.ts'

const palette = createPalette(true)
const mdTheme = markdownTheme(palette)

/** A presenter-enabled definition whose views the test controls. */
function definition(call: ToolCallView, result?: ToolResultView): ToolDefinition {
  return {
    name: 'tool',
    description: 'test tool',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    execute: async () => 'ok',
    presentCall: () => call,
    ...(result === undefined ? {} : { presentResult: () => result }),
  }
}

/** One `tool/result` payload carrying `text` as its raw result content. */
function resultEvent(text: string, isError = false): Extract<SessionEvent, { type: 'tool/result' }>['data'] {
  return {
    turn: 1,
    step: 1,
    message: {
      id: 'result-1' as never,
      role: 'user',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-1' as never,
        content: [{ type: 'text', text }],
        ...(isError ? { isError: true } : {}),
      }],
      source: { kind: 'tool', callId: 'call-1' as never },
    },
  }
}

describe('HeaderComponent', () => {
  const agent = { session: { id: 'session-1' } } as unknown as Agent

  it('sweeps the banner in with a gradient title', () => {
    const header = new HeaderComponent(agent, () => 'Snapshot agent ready.', palette, true)
    const rows = header.render(40)
    // The gradient paints each letter of the brand separately, so only the
    // bold HARNESS span stays contiguous.
    expect(rows.join('\n')).toContain('HARNESS')
    expect(rows.join('\n')).toContain('Snapshot agent ready.')
    header.setRevealWidth(6)
    const revealed = header.render(40)
    expect(revealed.every(row => visibleWidth(row) <= 6)).toBe(true)
    header.setRevealWidth(undefined)
    expect(header.render(40)).toEqual(rows)
  })

  it('renders without a subtitle and without a gradient', () => {
    const header = new HeaderComponent(agent, () => undefined, palette, false)
    const rows = header.render(40).join('\n')
    expect(rows).toContain('DEEPSEEK')
    expect(rows).toContain('session-1')
    expect(rows).not.toContain('Snapshot agent ready.')
  })
})

describe('ToolCardComponent', () => {
  it('escapes a raw string arguments payload verbatim', () => {
    const component = new ToolCardComponent('tool', { value: 'a\x1bb', valid: false }, undefined, 6, 1000, palette, mdTheme)
    expect(component.render(60).join('\n')).toContain('a\\x1bb')
  })

  it('falls back to the parsed arguments when the presenter declines', () => {
    const component = new ToolCardComponent('tool', { value: { a: 1 }, valid: true }, {
      ...definition({ card: 'generic', title: 'Run', rawInput: {} }),
      presentCall: () => undefined,
    }, 6, 1000, palette, mdTheme)
    expect(component.render(60).join('\n')).toContain('"a": 1')
  })

  it('renders a presenter failure as a generic card', () => {
    const component = new ToolCardComponent('tool', { value: { a: 1 }, valid: true }, {
      ...definition({ card: 'generic', title: 'Run', rawInput: {} }),
      presentCall: () => { throw new Error('boom') },
    }, 6, 1000, palette, mdTheme)
    expect(component.render(60).join('\n')).toContain('Presenter failed: Error: boom')
  })

  it('settles with the raw result when the result presenter declines', () => {
    const component = new ToolCardComponent('bash', { value: {}, valid: true }, {
      ...definition({ card: 'terminal', title: 'ls -la' }),
      presentResult: () => undefined,
    }, 6, 1000, palette, mdTheme)
    component.updateResult(resultEvent('total 4'))
    const rows = component.render(60).join('\n')
    // Settled terminal cards drop the pending command line.
    expect(rows).not.toContain('$ ls -la')
    expect(rows).toContain('total 4')
  })

  it('renders a result presenter failure as generic content', () => {
    const component = new ToolCardComponent('tool', { value: {}, valid: true }, {
      ...definition({ card: 'generic', title: 'Run', rawInput: {} }),
      presentResult: () => { throw new Error('nope') },
    }, 6, 1000, palette, mdTheme)
    component.updateResult(resultEvent('result text'))
    expect(component.render(60).join('\n')).toContain('Presenter failed: Error: nope')
  })

  it('falls back to String() for a symbol raw input', () => {
    const component = new ToolCardComponent('tool', { value: {}, valid: true }, {
      ...definition({ card: 'generic', title: 'Run', rawInput: {} }),
      presentCall: () => ({ card: 'generic', title: 'Run', rawInput: Symbol('sym') }),
    }, 6, 1000, palette, mdTheme)
    expect(component.render(60).join('\n')).toContain('Symbol(sym)')
  })

  it('marks an error result and carries result metadata', () => {
    const component = new ToolCardComponent('tool', { value: {}, valid: true }, definition(
      { card: 'generic', title: 'Run', rawInput: {} },
      { card: 'generic', title: 'done' },
    ), 6, 1000, palette, mdTheme)
    component.updateResult({ ...resultEvent('result text', true), meta: { verbose: true } })
    const rows = component.render(60).join('\n')
    expect(rows).toContain(`${palette.error('●')} ${palette.dim('Tool / tool')}`)
    expect(rows).toContain('result text')
  })

  it('renders a read card from its structured content', () => {
    const component = new ToolCardComponent('tool', { value: {}, valid: true }, definition(
      { card: 'generic', title: 'Read file', rawInput: {} },
      { card: 'read', path: 'a.txt', offset: 1, totalLines: 2, lines: [], content: [{ type: 'text', text: 'line one\n\nline two' }] },
    ), 6, 1000, palette, mdTheme)
    component.updateResult(resultEvent('line one'))
    const rows = component.render(60).join('\n')
    expect(rows).toContain('line one')
    expect(rows).toContain('line two')
  })

  it('renders a search result from the raw result content', () => {
    const component = new ToolCardComponent('tool', { value: {}, valid: true }, definition(
      { card: 'generic', title: 'Search', rawInput: {} },
      { card: 'search', shape: 'paths', paths: ['a.txt'], truncated: false, total: 1 },
    ), 6, 1000, palette, mdTheme)
    component.updateResult(resultEvent('found a.txt'))
    const rows = component.render(60).join('\n')
    expect(rows).toContain('found a.txt')
  })

  it('adds the terminal description to the header and keeps an empty one out', () => {
    const described = new ToolCardComponent('bash', { value: {}, valid: true }, definition(
      { card: 'terminal', title: 'ls -la', description: 'List files' },
    ), 6, 1000, palette, mdTheme)
    expect(described.render(60).join('\n')).toContain(' / List files')
    const plain = new ToolCardComponent('bash', { value: {}, valid: true }, definition(
      { card: 'terminal', title: 'ls -la', description: '' },
    ), 6, 1000, palette, mdTheme)
    expect(plain.render(60).join('\n')).not.toContain(' / List files')
  })

  it('renders terminal output, exit code, signal, and cwd', () => {
    const component = new ToolCardComponent('bash', { value: {}, valid: true }, definition(
      { card: 'terminal', title: 'ls -la', cwd: '/workspace' },
      { card: 'terminal', title: 'ls -la', output: 'a\n\nb', exitCode: 0, signal: 'SIGTERM' },
    ), 6, 1000, palette, mdTheme)
    component.updateResult(resultEvent('ignored'))
    const rows = component.render(60).join('\n')
    expect(rows).toContain('/workspace')
    expect(rows).toContain('[exit 0]')
    expect(rows).toContain('[signal SIGTERM]')
    expect(rows).toContain('a')
    expect(rows).toContain('b')
  })

  it('renders a terminal result with no output or exit status', () => {
    const component = new ToolCardComponent('bash', { value: {}, valid: true }, definition(
      { card: 'terminal', title: 'ls -la' },
      { card: 'terminal', title: 'ls -la' },
    ), 6, 1000, palette, mdTheme)
    component.updateResult(resultEvent('raw output'))
    const rows = component.render(60).join('\n')
    // A terminal result view with no output/status renders just the header:
    // the presenter opted to show nothing, so the raw content is not echoed.
    expect(rows).toContain(`${palette.success('●')} ${palette.dim('Tool / bash')}`)
    expect(rows).not.toContain('raw output')
    expect(rows).not.toContain('[exit')
    expect(rows).not.toContain('[signal')
  })

  it('renders a create-file diff with no before image', () => {
    const component = new ToolCardComponent('write', { value: {}, valid: true }, definition(
      { card: 'diff', title: 'Write new.txt', diffs: [{ path: 'new.txt', oldText: null, newText: 'line one\nline two' }] },
    ), 6, 1000, palette, mdTheme)
    const rows = component.render(60).join('\n')
    expect(rows).toContain('new.txt')
    expect(rows).toContain('+ line one')
    expect(rows).toContain('+ line two')
    expect(rows).toContain('└ +2 -0 · 1 file')
  })

  it('renders an empty new-file diff without body rows', () => {
    const component = new ToolCardComponent('write', { value: {}, valid: true }, definition(
      { card: 'diff', title: 'Write empty', diffs: [{ path: 'empty.txt', oldText: null, newText: '' }] },
    ), 6, 1000, palette, mdTheme)
    const rows = component.render(60).join('\n')
    expect(rows).toContain('empty.txt')
    expect(rows).toContain('└ +0 -0 · 1 file')
  })

  it('renders whole sides when a diff exceeds the edit budget', () => {
    const component = new ToolCardComponent('edit', { value: {}, valid: true }, definition(
      { card: 'diff', title: 'Edit files', diffs: [
        { path: 'a.txt', oldText: 'a\nb\nc\nd\ne\nf\ng', newText: 'A\nB\nC\nD\nE\nF\nG' },
        { path: 'b.txt', oldText: 'x', newText: 'y' },
      ] },
    ), 6, 2, palette, mdTheme)
    const rows = component.render(60).join('\n')
    // The first file exceeds the 2-line edit budget and falls back to whole
    // sides; the second stays an exact diff. The collapsed preview folds the
    // bulk of both sides away.
    expect(rows).toContain('[exact line diff omitted: >2 changed lines]')
    expect(rows).toContain('- a')
    expect(rows).toContain('└ +8 -8 · 2 files · approximate')
  })
})

describe('StreamingAssistantComponent', () => {
  function stream(): StreamingAssistantComponent {
    const tracker = new StepTimingTracker()
    return new StreamingAssistantComponent({ turn: 1, step: 1 }, () => [], tracker, () => 5_000, true, palette, mdTheme)
  }

  it('absorbs block-start and block-end chunks', () => {
    const component = stream()
    component.update({ type: 'block-start', index: 0, blockType: 'reasoning' })
    component.update({ type: 'text-delta', index: 1, text: 'hi' })
    component.update({ type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } })
    component.update({ type: 'block-end', index: 1, block: { type: 'text', text: 'hi' } })
    const rows = component.render(60).join('\n')
    expect(rows).toContain('think')
    expect(rows).toContain('hi')
  })

  it('drops non-text streamed blocks from the presented content', () => {
    const component = stream()
    component.update({ type: 'block-start', index: 0, blockType: 'tool-call' })
    component.update({ type: 'text-delta', index: 1, text: 'answer' })
    component.update({ type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-1' as never, name: 'bash', arguments: '{}' } })
    const rows = component.render(60).join('\n')
    expect(rows).toContain('answer')
    expect(rows).not.toContain('bash')
  })

  it('folds a bodyless continuation away entirely and restores it', () => {
    const component = stream()
    component.setFoldedContinuation(true)
    expect(component.render(60)).toEqual([])
    component.setFoldedContinuation(true)
    component.setFoldedContinuation(false)
    expect(component.render(60).join('\n')).toContain('Assistant')
  })

  it('keeps a folded continuation\'s body without its header', () => {
    const component = stream()
    component.update({ type: 'text-delta', index: 0, text: 'continued' })
    component.setFoldedContinuation(true)
    const rows = component.render(60).join('\n')
    expect(rows).toContain('continued')
    expect(rows).not.toContain('Assistant')
  })
})

describe('ContextCardComponent', () => {
  it('strips a surrounding reminder frame', () => {
    const component = new ContextCardComponent('goal', '<reminder>\nDo the thing.\n\nAnd more.\n</reminder>', 6, palette)
    const rows = component.render(60).join('\n')
    expect(rows).toContain('Context · goal')
    expect(rows).not.toContain('reminder')
    expect(rows).toContain('Do the thing.')
  })

  it('renders a frame-only body as header-only', () => {
    const component = new ContextCardComponent('goal', '<reminder>\n</reminder>', 6, palette)
    expect(component.render(60)).toEqual([palette.dim('Context · goal')])
  })

  it('keeps blank lines and folds long bodies', () => {
    const component = new ContextCardComponent('goal', 'a\n\nb\nc\nd\ne\nf\ng', 6, palette)
    const rows = component.render(60).join('\n')
    expect(rows).toContain('… +2 lines (Ctrl+O to expand)')
    component.setExpanded(true)
    const expanded = component.render(60).join('\n')
    expect(expanded).toContain('g')
    expect(expanded).not.toContain('(Ctrl+O to expand)')
  })
})

describe('formatStatusDuration', () => {
  it('formats minute-scale durations', () => {
    expect(formatStatusDuration(61_000)).toBe('1m01.0s')
    expect(formatStatusDuration(600_000)).toBe('10m00.0s')
    expect(formatStatusDuration(-5)).toBe('0.0s')
  })
})

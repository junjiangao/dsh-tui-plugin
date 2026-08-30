/**
 * Pure presentation helpers: terminal-text sanitization, the role palette,
 * brand art, and content flattening. These are the keyless, deterministic
 * units behind the semantic snapshots.
 */

import { describe, expect, it } from 'vitest'
import {
  displayInlineText,
  displayText,
  sanitizePastedText,
} from '../src/components/text.ts'
import {
  brandText,
  createPalette,
  gradientText,
  markdownTheme,
  paletteSpec,
  selectTheme,
} from '../src/components/theme.ts'
import { CallId } from '@deepseek-ai/dsh-llm'
import { contentText, parseArguments } from '../src/components/content.ts'

describe('displayText', () => {
  it('escapes C0/C1 controls but keeps line feeds structural', () => {
    expect(displayText('a\x1b[31mb\x07c')).toBe('a\\x1b[31mb\\x07c')
    expect(displayText('line1\nline2')).toBe('line1\nline2')
    expect(displayText('\u0000')).toBe('\\x00')
    expect(displayText('\u009f')).toBe('\\x9f')
  })

  it('renders newlines inline as \\x0a for single-line fields', () => {
    expect(displayInlineText('a\nb')).toBe('a\\x0ab')
  })

  it('strips OSC, CSI, escape, and control sequences from pasted text', () => {
    expect(sanitizePastedText('\x1b]0;title\x07ok')).toBe('ok')
    expect(sanitizePastedText('\x1b[31mred\x1b[0m')).toBe('red')
    expect(sanitizePastedText('\x1bMok')).toBe('ok')
    expect(sanitizePastedText('\x00\x1b\x9d')).toBe('')
  })
})

describe('palette', () => {
  it('derives wrappers from the single SGR spec table', () => {
    expect(paletteSpec('dark').colors.accent.open).toBe('95')
    expect(paletteSpec('light').colors.code.open).toBe('34')
    expect(paletteSpec('dark').colors.code.open).toBe('36')
    expect(paletteSpec('dark').backgrounds.panel.open).toBe('100')
    expect(paletteSpec('dark').attributes.bold.open).toBe('1')
  })

  it('emits paired SGR when enabled and passes text through when disabled', () => {
    const enabled = createPalette(true)
    expect(enabled.accent('x')).toBe('\x1b[95mx\x1b[39m')
    expect(enabled.bold('x')).toBe('\x1b[1mx\x1b[22m')
    expect(enabled.text('x')).toBe('x')
    expect(enabled.panel('x')).toBe('\x1b[100mx\x1b[49m')
    expect(enabled.bold(enabled.accent('x'))).toBe('\x1b[1m\x1b[95mx\x1b[39m\x1b[22m')
    const disabled = createPalette(false)
    expect(disabled.accent('x')).toBe('x')
    expect(disabled.bold('x')).toBe('x')
    expect(disabled.panel('x')).toBe('x')
  })

  it('paints brand art with fixed truecolor ink and the gradient per character', () => {
    expect(brandText('dsh')).toBe('\x1b[38;2;77;107;254mdsh\x1b[39m')
    expect(gradientText('ab')).toMatch(/^\x1b\[38;2;\d+;\d+;\d+ma\x1b\[38;2;\d+;\d+;\d+mb\x1b\[39m$/)
  })

  it('wires the Markdown and select-list themes to palette roles', () => {
    const palette = createPalette(true)
    const md = markdownTheme(palette)
    expect(md.heading('h')).toBe(palette.accent('h'))
    expect(md.link('l')).toBe(palette.accent('l'))
    expect(md.linkUrl('u')).toBe(palette.dim('u'))
    expect(md.code('c')).toBe(palette.code('c'))
    expect(md.codeBlock('b')).toBe(palette.code('b'))
    expect(md.codeBlockBorder('```ts')).toBe(palette.dim('ts'))
    expect(md.quote('q')).toBe(palette.dim('q'))
    expect(md.quoteBorder('q')).toBe(palette.accent('q'))
    expect(md.hr('-')).toBe(palette.dim('-'))
    expect(md.listBullet('*')).toBe(palette.accent('*'))
    expect(md.bold('b')).toBe(palette.bold('b'))
    expect(md.italic('i')).toBe(palette.italic('i'))
    expect(md.strikethrough('s')).toBe(palette.strike('s'))
    expect(md.underline('u')).toBe(palette.underline('u'))
    const select = selectTheme(palette)
    expect(select.selectedPrefix('>')).toBe(palette.accent('>'))
    expect(select.selectedText('x')).toBe(palette.accent('x'))
    expect(select.description('d')).toBe(palette.dim('d'))
    expect(select.scrollInfo('s')).toBe(palette.dim('s'))
    expect(select.noMatch('n')).toBe(palette.warning('n'))
  })
})

describe('contentText', () => {
  it('flattens every block kind and names unknown ones', () => {
    expect(contentText([{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'r' }])).toBe('ar')
    expect(contentText([{ type: 'tool-call', name: 'bash', arguments: '{}', id: CallId('c1') }])).toBe('bash({})')
    expect(contentText([{ type: 'tool-result', content: [{ type: 'text', text: 'out' }], toolCallId: CallId('c1') }])).toBe('out')
    expect(contentText([{ type: 'unknown' } as never])).toBe('[unknown]')
    expect(contentText([{ type: undefined } as never])).toBe('[content]')
  })

  it('parses tool arguments with a validity flag', () => {
    expect(parseArguments('{"a":1}')).toEqual({ value: { a: 1 }, valid: true })
    expect(parseArguments('not json')).toEqual({ value: 'not json', valid: false })
  })
})

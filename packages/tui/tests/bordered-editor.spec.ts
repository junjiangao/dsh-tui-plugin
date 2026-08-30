import { describe, expect, it } from 'vitest'
import { Editor, TUI, visibleWidth } from '@earendil-works/pi-tui'
import { BorderedEditor, composeTopBorder } from '../src/components/bordered-editor.ts'
import { createPalette, selectTheme } from '../src/components/theme.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

const LEFT = ' dsh '

function createInputBox(color = false, focused = true, columns = 96, rows = 36): {
  editor: Editor
  inputBox: BorderedEditor
  terminal: HeadlessTerminal
} {
  const terminal = new HeadlessTerminal(columns, rows)
  const ui = new TUI(terminal)
  const palette = createPalette(color)
  const editor = new Editor(ui, {
    borderColor: palette.dim,
    selectList: selectTheme(palette),
  }, {
    paddingX: 1,
    frame: 'none',
    prompt: {
      first: 'dsh > ',
      continuation: ' '.repeat(6),
    },
  })
  editor.focused = focused
  const inputBox = new BorderedEditor(editor, palette, { leftLabel: LEFT })
  return { editor, inputBox, terminal }
}

describe('composeTopBorder', () => {
  it('renders a no-chip top border at exactly the requested width', () => {
    for (const width of [4, 20, 56, 96]) {
      const line = composeTopBorder(width, LEFT, undefined)
      expect(visibleWidth(line)).toBe(width)
      expect(line.endsWith('╮')).toBe(true)
      if (width >= 20) {
        expect(line.startsWith('╭─ dsh ')).toBe(true)
      }
    }
  })

  it('renders a chip top border without overflowing', () => {
    for (const width of [56, 96]) {
      const line = composeTopBorder(width, LEFT, 'model deepseek-v4-pro')
      expect(visibleWidth(line)).toBe(width)
      expect(line).toContain('model deepseek-v4-pro')
      expect(line.startsWith('╭─ dsh ')).toBe(true)
      expect(line.endsWith('╮')).toBe(true)
    }
    // At width 20 the chip is truncated, but the border still fits exactly.
    const narrow = composeTopBorder(20, LEFT, 'model deepseek-v4-pro')
    expect(visibleWidth(narrow)).toBe(20)
    expect(narrow).toContain('…')
  })

  it('truncates an over-long chip with an ellipsis and still fits the width', () => {
    const line = composeTopBorder(20, LEFT, 'model extremely-long-model-name')
    expect(visibleWidth(line)).toBe(20)
    expect(line).toContain('…')
  })

  it('drops the chip entirely when even a truncated chip cannot fit', () => {
    // At width 8 the left label already consumes most of the border; the chip
    // must be dropped rather than overflowing.
    const line = composeTopBorder(8, LEFT, 'model deepseek-v4-pro')
    expect(visibleWidth(line)).toBe(8)
    expect(line).not.toContain('model')
  })

  it('handles an empty left label and very narrow widths without overflowing', () => {
    expect(visibleWidth(composeTopBorder(96, '', undefined))).toBe(96)
    expect(visibleWidth(composeTopBorder(96, '', 'model x'))).toBe(96)
    for (const width of [1, 2, 3]) {
      expect(visibleWidth(composeTopBorder(width, LEFT, 'model x'))).toBe(width)
    }
  })
})

describe('BorderedEditor', () => {
  it('wraps editor output with a rounded border and full-width lines', () => {
    const { inputBox } = createInputBox()
    const lines = inputBox.render(96)
    expect(lines.length).toBeGreaterThanOrEqual(3)
    expect(lines[0]?.startsWith('╭')).toBe(true)
    expect(lines[1]?.startsWith('│')).toBe(true)
    expect(lines.at(-1)?.startsWith('╰')).toBe(true)
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(96)
    }
  })

  it('uses accent while focused and dim while blurred', () => {
    const { editor, inputBox } = createInputBox(true, true)
    expect(inputBox.render(96)[0]).toContain('\x1b[95m')
    editor.focused = false
    expect(inputBox.render(96)[0]).toContain('\x1b[2;39m')
  })

  it('updates the right chip label and keeps the border inside the width', () => {
    const { inputBox } = createInputBox()
    inputBox.setRightLabel('model deepseek-v4-pro')
    const line = inputBox.render(96)[0]
    expect(line).toContain('model deepseek-v4-pro')
    expect(visibleWidth(line ?? '')).toBe(96)
  })

  it('falls back to a borderless render below four columns', () => {
    const { inputBox } = createInputBox()
    const lines = inputBox.render(3)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line.startsWith('╭')).toBe(false)
      expect(line.includes('╮')).toBe(false)
    }
  })

  it('delegates focus and key-release properties to the wrapped editor', () => {
    const { editor, inputBox } = createInputBox()
    expect(inputBox.focused).toBe(editor.focused)
    inputBox.focused = false
    expect(editor.focused).toBe(false)
    expect(inputBox.wantsKeyRelease).toBe(false)
    inputBox.wantsKeyRelease = true
    expect(inputBox.wantsKeyRelease).toBe(true)
  })
})

/**
 * Rounded bordered input box wrapping pi-tui's `Editor`.
 *
 * pi-tui's `Editor` only supports a horizontal frame (`frame: 'horizontal' |
 * 'none'`). This component keeps the editor's own layout (prompt, wrapping,
 * scroll indicators, autocomplete) and draws a full rounded border around it:
 *
 * ```text
 * ╭─ dsh ───────────────── model deepseek-v4-pro ─╮
 * │ dsh > hello                                   │
 * ╰───────────────────────────────────────────────╯
 * ```
 *
 * The border is theme-agnostic: it uses only the standard palette roles
 * (`accent` when the editor is focused, `dim` when it is not) and never adds
 * background/truecolor/extended-color escapes.
 * @module @deepseek-ai/dsh-tui/components/bordered-editor
 */

import {
  Container,
  Editor,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui'
import { displayInlineText, displayText } from './text.ts'
import type { Palette } from './theme.ts'

/** Options for the bordered input box. */
export interface BorderedEditorOptions {
  /** Left label shown in the top border, including its surrounding spaces. */
  leftLabel?: string
  /** Optional right chip shown in the top border, e.g. `model deepseek-v4-pro`. */
  rightLabel?: string
}

/**
 * Pad one editor body line to `innerWidth` visible columns without breaking
 * ANSI styling. Editor output is normally already full-width; this is a
 * defensive fit before the side borders are added.
 */
function padRow(line: string, innerWidth: number): string {
  const bounded = truncateToWidth(line, innerWidth, '')
  return `${bounded}${' '.repeat(Math.max(0, innerWidth - visibleWidth(bounded)))}`
}

/**
 * Compose a rounded top border of exactly `width` visible columns.
 *
 * Format (mirroring the existing status-card title row):
 * - no chip: `╭─ dsh ─────────╮`
 * - chip:    `╭─ dsh ───── model <name> ─╮`
 *
 * The right chip is truncated with `…` when needed, and dropped entirely when
 * even the truncated chip cannot share the border with two dash runs.
 *
 * @param width - Terminal columns available to the border.
 * @param leftLabel - Left label, already display-sanitized by the caller.
 * @param rightLabel - Optional right chip text, already display-sanitized.
 * @returns The top border line.
 */
export function composeTopBorder(
  width: number,
  leftLabel: string,
  rightLabel: string | undefined,
): string {
  const safeWidth = Math.max(1, width)
  const left = displayInlineText(leftLabel)
  const right = rightLabel === undefined ? undefined : displayText(rightLabel)

  // Widths below the rounded-corner minimum cannot carry labels; return a
  // minimal corner row clipped to the requested width.
  if (safeWidth < 4) {
    return `╭${'─'.repeat(Math.max(0, safeWidth - 2))}╮`.slice(0, safeWidth)
  }

  // Content area between the leading `╭─` and the closing `╮`.
  const contentWidth = safeWidth - 3

  const noChip = (): string => {
    // Keep the left label when it fits; otherwise truncate it, reserving at
    // least one dash after it, or drop it entirely on very narrow terminals.
    let label = left
    let labelWidth = visibleWidth(label)
    if (labelWidth > contentWidth) {
      const maxLabel = Math.max(0, contentWidth - 1)
      label = maxLabel <= 0 ? '' : truncateToWidth(left, maxLabel, '…')
      labelWidth = visibleWidth(label)
    }
    const dashes = Math.max(0, contentWidth - labelWidth)
    return `╭─${label}${'─'.repeat(dashes)}╮`
  }

  if (right === undefined) return noChip()

  // With chip: `╭─` + left + dashes + ` chip ` + dashes + `╮`.
  // Two dash runs (>=1 each) need two content columns beyond the left label
  // and the chip itself. If that does not fit, drop the chip and fall back to
  // the no-chip border.
  const leftWidth = visibleWidth(left)
  const availableForChip = contentWidth - leftWidth - 2
  if (availableForChip >= 3) {
    const chipMax = availableForChip - 2
    const chip = truncateToWidth(right, chipMax, '…')
    const spaced = ` ${chip} `
    const spacedWidth = visibleWidth(spaced)
    const dashes = contentWidth - leftWidth - spacedWidth
    if (dashes >= 2) {
      const leftDashes = Math.max(1, dashes - 1)
      const rightDashes = Math.max(1, dashes - leftDashes)
      return `╭─${left}${'─'.repeat(leftDashes)}${spaced}${'─'.repeat(rightDashes)}╮`
    }
  }

  return noChip()
}

/**
 * Full rounded border around a pi-tui `Editor`.
 *
 * The component extends `Container` so pi-tui's overlay focus-restore /
 * `isComponentMounted` traversal still sees the editor child. The editor keeps
 * receiving focus directly (`ui.setFocus(editor)`), while this wrapper reads
 * `editor.focused` to choose the border color.
 */
export class BorderedEditor extends Container {
  private readonly editor: Editor
  private readonly palette: Palette
  private leftLabel: string
  private rightLabel: string | undefined

  constructor(
    editor: Editor,
    palette: Palette,
    options: BorderedEditorOptions = {},
  ) {
    super()
    this.editor = editor
    this.palette = palette
    this.leftLabel = options.leftLabel ?? ' dsh '
    this.rightLabel = options.rightLabel
    this.addChild(editor)
  }

  /** Focus state is owned by the wrapped editor; expose it for symmetry. */
  get focused(): boolean {
    return this.editor.focused
  }

  set focused(value: boolean) {
    this.editor.focused = value
  }

  /** Key-release handling is owned by the wrapped editor; expose it for symmetry. */
  get wantsKeyRelease(): boolean {
    return (this.editor as Editor & { wantsKeyRelease?: boolean }).wantsKeyRelease ?? false
  }

  set wantsKeyRelease(value: boolean) {
    const target = this.editor as Editor & { wantsKeyRelease?: boolean }
    target.wantsKeyRelease = value
  }

  /** Delegate input to the wrapped editor when this wrapper is focused directly. */
  handleInput(data: string): void {
    this.editor.handleInput(data)
  }

  /** Update the right model chip shown in the top border. */
  setRightLabel(label: string | undefined): void {
    this.rightLabel = label
    this.invalidate()
  }

  /** Update the left brand label shown in the top border. */
  setLeftLabel(label: string): void {
    this.leftLabel = label
    this.invalidate()
  }

  override render(width: number): string[] {
    // Very narrow terminals cannot fit a rounded border; fall back to the
    // editor's native frameless layout rather than emitting an overflow.
    if (width < 4) return super.render(Math.max(1, width))

    const innerWidth = Math.max(1, width - 2)
    const border = this.editor.focused ? this.palette.accent : this.palette.dim
    const lines: string[] = [border(composeTopBorder(width, this.leftLabel, this.rightLabel))]
    for (const line of super.render(innerWidth)) {
      const leftBorder = border('│')
      const rightBorder = border('│')
      lines.push(`${leftBorder}${padRow(line, innerWidth)}${rightBorder}`)
    }
    lines.push(border(`╰${'─'.repeat(innerWidth)}╯`))
    return lines
  }
}

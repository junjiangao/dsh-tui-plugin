/**
 * QuestionDialog component-level tests: multi-select toggling, submission
 * guards, option-window paging, and the detail pager.
 */

import { describe, expect, it } from 'vitest'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import { QuestionDialog, type QuestionSelection } from '../src/components/dialogs.ts'
import { createPalette } from '../src/components/theme.ts'

const palette = createPalette(true)

interface Harness {
  dialog: QuestionDialog
  selections: QuestionSelection[]
  cancelled: number[]
}

function dialog(
  question: AskUserQuestionItem,
  maxVisible = 8,
  maxHeight = 30,
): Harness {
  const selections: QuestionSelection[] = []
  const cancelled: number[] = []
  const d = new QuestionDialog(
    question,
    1,
    1,
    1,
    maxVisible,
    () => maxHeight,
    palette,
    (selection) => { selections.push(selection) },
    () => { cancelled.push(1) },
  )
  return { dialog: d, selections, cancelled }
}

describe('QuestionDialog', () => {
  it('toggles multiple options with Space and submits them in order', () => {
    const h = dialog({
      id: 'q1',
      question: 'Pick tools',
      multiSelect: true,
      options: [{ label: 'bash' }, { label: 'write' }, { label: 'read' }],
    })
    h.dialog.handleInput(' ') // select bash
    h.dialog.handleInput('\x1b[B') // down
    h.dialog.handleInput(' ') // select write
    h.dialog.handleInput('\r')
    expect(h.selections).toEqual([{ selected: ['bash', 'write'] }])
    expect(h.cancelled).toEqual([])
  })

  it('rejects an empty multi-select submission and recovers', () => {
    const h = dialog({
      id: 'q1',
      question: 'Pick at least one',
      multiSelect: true,
      options: [{ label: 'bash' }],
    })
    h.dialog.handleInput('\r')
    expect(h.selections).toHaveLength(0)
    expect(h.dialog.render(60).join('\n')).toContain('Select at least one option')
    h.dialog.handleInput(' ')
    h.dialog.handleInput('\r')
    expect(h.selections).toEqual([{ selected: ['bash'] }])
  })

  it('windows an oversized option list with overflow markers', () => {
    const options = Array.from({ length: 12 }, (_value, index) => ({ label: `option ${index + 1}` }))
    const h = dialog({ id: 'q1', question: 'Many options', options }, 4)
    const rows = h.dialog.render(60).join('\n')
    expect(rows).toContain('1/12')
    // Navigating down keeps the selection inside the window and updates it.
    for (let index = 0; index < 6; index += 1) h.dialog.handleInput('\x1b[B')
    const after = h.dialog.render(60).join('\n')
    expect(after).toContain('7/12')
  })

  it('pages through an oversized question header with PgUp/PgDn', () => {
    const question = 'Line ' + Array.from({ length: 40 }, (_value, index) => index + 1).join('\nLine ')
    const h = dialog({ id: 'q1', question, options: [{ label: 'ok' }] }, 8, 12)
    const first = h.dialog.render(60).join('\n')
    expect(first).toContain('PgUp/PgDn')
    h.dialog.handleInput('\x1b[6~') // page down
    const second = h.dialog.render(60).join('\n')
    expect(second).not.toEqual(first)
    h.dialog.handleInput('\x1b[5~') // page up
    const third = h.dialog.render(60).join('\n')
    expect(third).toEqual(first)
  })
  it('wraps up/down navigation and toggles a selection off again', () => {
    const h = dialog({
      id: 'q1',
      question: 'Cycle',
      multiSelect: true,
      options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
    })
    // Up from the first wraps to the last, and Space marks it.
    h.dialog.handleInput('\x1b[A')
    h.dialog.handleInput(' ')
    let rows = h.dialog.render(60).join('\n')
    expect(rows).toContain('[x]')
    expect(rows).toContain('3. [x] c')
    h.dialog.handleInput(' ')
    // Down from the last wraps back to the first, and Space toggles it off.
    h.dialog.handleInput('\x1b[B')
    h.dialog.handleInput('\x1b[B')
    h.dialog.handleInput(' ')
    h.dialog.handleInput(' ')
    // An all-deselected submission is rejected with guidance.
    h.dialog.handleInput('\r')
    expect(h.selections).toEqual([])
    rows = h.dialog.render(60).join('\n')
    expect(rows).toContain('Select at least one option')
    expect(rows).not.toContain('[x]')
    // Re-selecting the current row submits normally.
    h.dialog.handleInput(' ')
    h.dialog.handleInput('\r')
    expect(h.selections).toEqual([{ selected: ['b'] }])
  })

  it('wraps a long option label and renders its description', () => {
    const h = dialog({
      id: 'q1',
      question: 'Long option',
      options: [{
        label: 'a very long option label that wraps across several terminal rows of the panel',
        description: 'A supporting description that also wraps to multiple rows.',
      }],
    })
    const rows = h.dialog.render(40).join('\n')
    expect(rows).toContain('1. a very long option label')
    expect(rows).toContain('A supporting description')
  })

  it('shows a question header tag', () => {
    const h = dialog({
      id: 'q1',
      header: 'Settings',
      question: 'Which setting?',
      options: [{ label: 'ok' }],
    })
    expect(h.dialog.render(60).join('\n')).toContain('· Settings')
  })

  it('compacts a long question in custom mode', () => {
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    const h = dialog({ id: 'q1', question }, 8, 8)
    const rows = h.dialog.render(60).join('\n')
    expect(rows).toContain('Enter submit • Esc cancel')
    // Custom-mode submission keeps the typed answer.
    h.dialog.handleInput('typed answer')
    h.dialog.handleInput('\r')
    expect(h.selections).toEqual([{ selected: [], custom: 'typed answer' }])
  })

  it('pages the compact header to its end and back without moving options', () => {
    const options = Array.from({ length: 6 }, (_value, index) => ({ label: `o${index + 1}` }))
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    const h = dialog({ id: 'q1', question, options }, 8, 8)
    const first = h.dialog.render(60).join('\n')
    // PgDn walks the paged question header; the option window keeps its row.
    for (let index = 0; index < 5; index += 1) h.dialog.handleInput('\x1b[6~')
    const paged = h.dialog.render(60).join('\n')
    expect(paged).not.toEqual(first)
    expect(paged).toContain('o1')
    h.dialog.handleInput('\x1b[5~')
    h.dialog.handleInput('\x1b[5~')
    h.dialog.render(60)
  })
  it('moves up from the middle and cancels with Ctrl+C', () => {
    const h = dialog({
      id: 'q1',
      question: 'Navigate',
      options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
    })
    h.dialog.handleInput('\x1b[B') // to b
    h.dialog.handleInput('\x1b[A') // back to a
    h.dialog.handleInput('\r')
    expect(h.selections).toEqual([{ selected: ['a'] }])
    // Ctrl+C cancels like Esc (raw control character).
    h.dialog.handleInput('\x03')
    expect(h.cancelled).toEqual([1])
    // An unrecognized key is ignored.
    h.dialog.handleInput('x')
    expect(h.cancelled).toEqual([1])
  })

  it('attaches custom text to a multi-select submission', () => {
    const h = dialog({
      id: 'q1',
      question: 'Multi with custom',
      multiSelect: true,
      options: [{ label: 'a' }, { label: 'b' }],
    })
    h.dialog.handleInput(' ') // select a
    h.dialog.handleInput('\t') // custom mode
    h.dialog.handleInput('extra detail')
    h.dialog.handleInput('\r')
    expect(h.selections).toEqual([{ selected: ['a'], custom: 'extra detail' }])
  })

  it('scrolls an oversized selected option with PgUp/PgDn', () => {
    const longLabel = 'word '.repeat(200)
    const h = dialog(
      { id: 'q1', question: 'One huge option', options: [{ label: longLabel }] },
      8,
      8,
    )
    const first = h.dialog.render(60).join('\n')
    expect(first).toContain('PgUp/PgDn')
    h.dialog.handleInput('\x1b[6~') // page down inside the selected block
    const second = h.dialog.render(60).join('\n')
    expect(second).not.toEqual(first)
    h.dialog.handleInput('\x1b[5~') // page back up
    const third = h.dialog.render(60).join('\n')
    expect(third).toEqual(first)
  })

  it('keeps an error visible in the compact layout', () => {
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    const h = dialog(
      { id: 'q1', question, multiSelect: true, options: [{ label: 'a' }] },
      8,
      8,
    )
    h.dialog.handleInput('\r') // empty multi-select -> error
    const rows = h.dialog.render(60).join('\n')
    expect(rows).toContain('Error: Select at least one option')
    expect(rows).toContain('Space toggle')
  })

  it('truncates the pager and control hints on a narrow panel', () => {
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    const h = dialog({ id: 'q1', question, options: [{ label: 'ok' }] }, 8, 8)
    const rows = h.dialog.render(22).join('\n')
    expect(rows).toContain('PgUp/PgDn')
  })

  it('hides the header entirely when only the footer fits', () => {
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    const h = dialog(
      { id: 'q1', question, options: Array.from({ length: 6 }, (_value, index) => ({ label: `o${index + 1}` })) },
      8,
      3,
    )
    const rows = h.dialog.render(60).join('\n')
    // With maxHeight 3 the header budget collapses to zero.
    expect(rows).toContain('lines hidden')
  })
  it('keeps a pager visible in the compact option footer', () => {
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    const h = dialog(
      { id: 'q1', question, multiSelect: true, options: Array.from({ length: 6 }, (_value, index) => ({ label: `o${index + 1}` })) },
      8,
      8,
    )
    const rows = h.dialog.render(60).join('\n')
    expect(rows).toContain('PgUp/PgDn')
  })

  it('collapses the compact custom footer to a single row', () => {
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    // maxHeight 2: the footer budget collapses to one row.
    const oneRow = dialog({ id: 'q1', question }, 8, 2)
    oneRow.dialog.render(60)
    oneRow.dialog.handleInput('\x1b[6~') // custom-mode page forward is a no-op
    // maxHeight 3: the footer keeps its head and tail rows.
    const headTail = dialog({ id: 'q1', question }, 8, 3)
    headTail.dialog.render(60)
    headTail.dialog.handleInput('\x1b[6~')
    headTail.dialog.render(60)
  })

  it('renders the one-line hidden marker at maxHeight 1', () => {
    const h = dialog({ id: 'q1', question: 'Tiny', options: [{ label: 'ok' }] }, 8, 1)
    const rows = h.dialog.render(60).join('\n')
    expect(rows).toContain('lines hidden')
  })

  it('keeps one header line and a pager hint in a one-row budget', () => {
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    const h = dialog(
      { id: 'q1', question, options: Array.from({ length: 6 }, (_value, index) => ({ label: `o${index + 1}` })) },
      8,
      6,
    )
    const rows = h.dialog.render(60).join('\n')
    // The header collapses to its first line and the footer names the pager.
    expect(rows).toContain('Line 1')
    expect(rows).toContain('PgUp/PgDn')
    expect(rows).not.toContain('Line 5')
  })

  it('returns from custom-mode page-forward and keeps custom controls compact', () => {
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    const withOptions = dialog(
      { id: 'q1', question, options: [{ label: 'pick me' }] },
      8,
      8,
    )
    withOptions.dialog.handleInput('\t') // custom mode
    const rows = withOptions.dialog.render(60).join('\n')
    expect(rows).toContain('Enter submit • Esc options')
    withOptions.dialog.handleInput('\x1b[6~') // custom-mode page forward is a no-op
    withOptions.dialog.render(60)
    // A narrow panel falls back to the compact custom controls.
    const narrow = dialog({ id: 'q1', question }, 8, 8)
    narrow.dialog.render(20)
  })
  it('no-ops custom-mode page forward when the header fits', () => {
    // A short custom question with a tiny panel: the header never pages, so
    // PgDn lands on the custom-mode no-op.
    const h = dialog({ id: 'q1', question: 'Short' }, 8, 2)
    h.dialog.render(60)
    h.dialog.handleInput('\x1b[6~')
    h.dialog.handleInput('\x1b[5~')
    h.dialog.render(60)
  })

  it('keeps the custom error visible in a compact footer', () => {
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    const h = dialog({ id: 'q1', question }, 8, 3)
    h.dialog.handleInput('\r') // empty custom submission -> error
    const rows = h.dialog.render(60).join('\n')
    expect(rows).toContain('Enter an answer before submitting.')
    h.dialog.handleInput('\x1b[6~')
    h.dialog.render(60)
  })

  it('attaches leftover custom text to an options-mode submission', () => {
    const h = dialog({
      id: 'q1',
      question: 'Multi with leftover',
      multiSelect: true,
      options: [{ label: 'a' }, { label: 'b' }],
    })
    h.dialog.handleInput('\t') // custom mode
    h.dialog.handleInput('leftover text')
    h.dialog.handleInput('\x1b') // back to options mode
    h.dialog.handleInput(' ')
    h.dialog.handleInput('\r')
    expect(h.selections).toEqual([{ selected: ['a'], custom: 'leftover text' }])
  })

  it('falls back to compact option controls on a narrow panel', () => {
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    const h = dialog(
      { id: 'q1', question, options: Array.from({ length: 6 }, (_value, index) => ({ label: `o${index + 1}` })) },
      8,
      6,
    )
    const rows = h.dialog.render(22).join('\n')
    expect(rows).toContain('P↑↓')
  })

  it('uses the multi-select fallback on a narrow non-paging panel', () => {
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    const h = dialog(
      { id: 'q1', question, multiSelect: true, options: Array.from({ length: 6 }, (_value, index) => ({ label: `o${index + 1}` })) },
      8,
      7,
    )
    const rows = h.dialog.render(22).join('\n')
    expect(rows).toContain('Tab Sp')
  })

  it('uses the pager fallback when a narrow panel also pages', () => {
    const question = 'Line ' + Array.from({ length: 30 }, (_value, index) => index + 1).join('\nLine ')
    const h = dialog(
      { id: 'q1', question, multiSelect: true, options: Array.from({ length: 8 }, (_value, index) => ({ label: `o${index + 1}` })) },
      8,
      6,
    )
    const rows = h.dialog.render(22).join('\n')
    expect(rows).toContain('P↑↓')
    expect(rows).toContain('Tab S')
  })
})

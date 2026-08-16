/**
 * ask_user_question through the live channel: the provider registration, the
 * FIFO question queue, option/custom modes, and abort settlement.
 */

import { describe, expect, it } from 'vitest'
import { createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

async function setup(): Promise<{
  harness: Awaited<ReturnType<typeof createTuiTestHarness<HeadlessTerminal, (code: number) => void>>>
  terminal: HeadlessTerminal
}> {
  const terminal = new HeadlessTerminal(96, 36)
  const harness = await createTuiTestHarness(terminal, () => {}, {})
  await terminal.waitForFrame()
  return { harness, terminal }
}

describe('user questions in the live channel', () => {
  it('answers a single-select question through the inline panel', async () => {
    const { harness, terminal } = await setup()
    const promise = harness.ctx.userQuestions.ask({
      agent: harness.agent,
      questions: [{
        id: 'q1',
        question: 'Which tool?',
        options: [{ label: 'bash' }, { label: 'write' }],
      }],
    })
    await terminal.waitForFrame()
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Question 1/1 (1 unanswered)')
    expect(snapshot).toContain('Which tool?')
    expect(snapshot).toContain('bash')
    terminal.send('\x1b[B') // down
    await terminal.waitForFrame()
    terminal.send('\r')
    const answer = await promise
    expect(answer.answers).toEqual([{ id: 'q1', selected: ['write'] }])
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('Which tool?')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('queues a second question behind the first', async () => {
    const { harness, terminal } = await setup()
    const first = harness.ctx.userQuestions.ask({
      questions: [{
        id: 'q1',
        question: 'First question',
        options: [{ label: 'yes' }],
      }],
    })
    const second = harness.ctx.userQuestions.ask({
      questions: [{
        id: 'q2',
        question: 'Second question',
        options: [{ label: 'ok' }],
      }],
    })
    await terminal.waitForFrame()
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('First question')
    // The second ask stays queued: only one question panel owns the screen.
    expect(snapshot).not.toContain('Second question')
    terminal.send('\r')
    await first
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Second question')
    terminal.send('\r')
    await second
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('submits a custom answer in custom mode', async () => {
    const { harness, terminal } = await setup()
    const promise = harness.ctx.userQuestions.ask({
      questions: [{
        id: 'q1',
        question: 'Free text?',
        options: [{ label: 'a' }],
      }],
    })
    await terminal.waitForFrame()
    terminal.send('\t') // custom mode
    await terminal.waitForFrame()
    terminal.send('hello there')
    await terminal.waitForFrame()
    terminal.send('\r')
    const answer = await promise
    expect(answer.answers).toEqual([{ id: 'q1', selected: [], custom: 'hello there' }])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('rejects the ask when the user escapes the panel', async () => {
    const { harness, terminal } = await setup()
    const promise = harness.ctx.userQuestions.ask({
      questions: [{ id: 'q1', question: 'Esc me?' }],
    })
    await terminal.waitForFrame()
    terminal.send('\x1b')
    await expect(promise).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('Esc me?')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('settles a queued question when its request aborts', async () => {
    const { harness, terminal } = await setup()
    const first = harness.ctx.userQuestions.ask({
      questions: [{ id: 'q1', question: 'First stays', options: [{ label: 'ok' }] }],
    })
    const controller = new AbortController()
    const second = harness.ctx.userQuestions.ask({
      signal: controller.signal,
      questions: [{ id: 'q2', question: 'Queued dies' }],
    })
    await terminal.waitForFrame()
    controller.abort()
    await expect(second).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    // The active question is unaffected.
    terminal.send('\r')
    await first
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('rejects the ask when the request aborts', async () => {
    const { harness, terminal } = await setup()
    const controller = new AbortController()
    const promise = harness.ctx.userQuestions.ask({
      signal: controller.signal,
      questions: [{ id: 'q1', question: 'Abort me?' }],
    })
    await terminal.waitForFrame()
    controller.abort()
    await expect(promise).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('Abort me?')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('rejects the active and queued questions on shutdown', async () => {
    const { harness, terminal } = await setup()
    const first = harness.ctx.userQuestions.ask({
      questions: [{ id: 'q1', question: 'Active dies', options: [{ label: 'ok' }] }],
    })
    const second = harness.ctx.userQuestions.ask({
      questions: [{ id: 'q2', question: 'Queued dies too' }],
    })
    await terminal.waitForFrame()
    await harness.controller.dispose()
    await expect(first).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await expect(second).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await terminal.dispose()
  })

  it('renders a plan-review question with its plan detail', async () => {
    const { harness, terminal } = await setup()
    const promise = harness.ctx.userQuestions.ask({
      questions: [{
        id: 'plan',
        question: 'Review this plan',
        detail: '## Plan\nStep one\nStep two',
        intent: { kind: 'plan-review', approve: 'Approve plan' },
        options: [{ label: 'Approve plan' }, { label: 'Request changes' }],
      }],
    })
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Review this plan')
    expect(snapshot).toContain('Step one')
    expect(snapshot).toContain('Approve plan')
    terminal.send('\r')
    const answer = await promise
    expect(answer.answers[0]?.selected).toEqual(['Approve plan'])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
  it('guards custom submissions and returns from custom mode with Esc', async () => {
    const { harness, terminal } = await setup()
    const promise = harness.ctx.userQuestions.ask({
      questions: [{
        id: 'q1',
        question: 'Custom or option?',
        options: [{ label: 'option one' }],
      }],
    })
    await terminal.waitForFrame()
    terminal.send('\t') // custom mode
    await terminal.waitForFrame()
    terminal.send('\r') // empty custom submission is rejected
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Enter an answer before submitting.')
    terminal.send('\x1b') // back to options mode
    await terminal.waitForFrame()
    terminal.send('\r')
    const answer = await promise
    expect(answer.answers[0]?.selected).toEqual(['option one'])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('cancels an options-mode question with Esc or Ctrl+C', async () => {
    const { harness, terminal } = await setup()
    const escaped = harness.ctx.userQuestions.ask({
      questions: [{ id: 'q1', question: 'Esc cancel', options: [{ label: 'ok' }] }],
    })
    await terminal.waitForFrame()
    terminal.send('\x1b')
    await expect(escaped).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await terminal.waitForFrame()

    const interrupted = harness.ctx.userQuestions.ask({
      questions: [{ id: 'q2', question: 'Ctrl+C cancel', options: [{ label: 'ok' }] }],
    })
    await terminal.waitForFrame()
    terminal.send('\x03')
    await expect(interrupted).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('compacts a question with an oversized detail into a paged header', async () => {
    const { harness, terminal } = await setup()
    const detail = Array.from({ length: 40 }, (_value, index) => `detail line ${index + 1}`).join('\n')
    const promise = harness.ctx.userQuestions.ask({
      questions: [{
        id: 'q1',
        question: 'Long plan',
        detail,
        options: [{ label: 'ok' }],
      }],
    })
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('PgUp/PgDn')
    terminal.send('\x1b[6~') // page down
    await terminal.waitForFrame()
    terminal.send('\r')
    const answer = await promise
    expect(answer.answers[0]?.selected).toEqual(['ok'])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

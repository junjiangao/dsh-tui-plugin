/**
 * Approval decisions through the live channel: the modal dialog, the
 * exact-agent claim, the delegation path for foreign agents, and abort
 * settlement.
 */

import { describe, expect, it } from 'vitest'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createFakeAgent, createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

async function setup(): Promise<{
  harness: Awaited<ReturnType<typeof createTuiTestHarness<HeadlessTerminal, (code: number) => void>>>
  terminal: HeadlessTerminal
}> {
  const terminal = new HeadlessTerminal(96, 36)
  const harness = await createTuiTestHarness(terminal, () => {}, {})
  await harness.ctx.plugin(ApprovalService)
  await terminal.waitForFrame()
  return { harness, terminal }
}

/** The durable log must hold an open turn for the audit pair to enclose. */
function openTurn(harness: { session: { append(type: 'turn/start', data: { turn: number }): void } }): void {
  harness.session.append('turn/start', { turn: 1 })
}

describe('approval in the live channel', () => {
  it('allows a decision with Enter and rejects with the second option', async () => {
    const { harness, terminal } = await setup()
    openTurn(harness)
    const allowed = harness.ctx.approval.request({
      agent: harness.agent,
      toolName: 'bash',
      reason: 'Run ls -la in /workspace',
    })
    await terminal.waitForFrame()
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Approve bash?')
    expect(snapshot).toContain('Run ls -la in /workspace')
    terminal.send('\r')
    await expect(allowed).resolves.toBe('allowed-once')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('Approve bash?')

    const rejected = harness.ctx.approval.request({
      agent: harness.agent,
      toolName: 'write',
      reason: 'Overwrite file',
    })
    await terminal.waitForFrame()
    terminal.send('\x1b[B') // down to Reject
    await terminal.waitForFrame()
    terminal.send('\r')
    await expect(rejected).resolves.toBe('rejected')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('withdraws with Esc and settles cancelled on abort', async () => {
    const { harness, terminal } = await setup()
    openTurn(harness)
    const escaped = harness.ctx.approval.request({
      agent: harness.agent,
      toolName: 'bash',
      reason: 'Esc me',
    })
    await terminal.waitForFrame()
    terminal.send('\x1b')
    await expect(escaped).resolves.toBe('cancelled')
    await terminal.waitForFrame()

    const controller = new AbortController()
    openTurn(harness)
    const aborted = harness.ctx.approval.request({
      agent: harness.agent,
      toolName: 'bash',
      reason: 'Abort me',
      signal: controller.signal,
    })
    await terminal.waitForFrame()
    controller.abort()
    await expect(aborted).resolves.toBe('cancelled')
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('Abort me')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('cycles up to reject and down back to allow', async () => {
    const { harness, terminal } = await setup()
    openTurn(harness)
    const request = harness.ctx.approval.request({
      agent: harness.agent,
      toolName: 'bash',
      reason: 'Cycle me',
    })
    await terminal.waitForFrame()
    // Up from the first option wraps to Reject.
    terminal.send('\x1b[A')
    await terminal.waitForFrame()
    terminal.send('\r')
    await expect(request).resolves.toBe('rejected')
    await terminal.waitForFrame()

    // Down then up returns to the first option.
    openTurn(harness)
    const returned = harness.ctx.approval.request({
      agent: harness.agent,
      toolName: 'bash',
      reason: 'Return me',
    })
    await terminal.waitForFrame()
    terminal.send('\x1b[B')
    await terminal.waitForFrame()
    terminal.send('\x1b[A')
    await terminal.waitForFrame()
    terminal.send('\r')
    await expect(returned).resolves.toBe('allowed-once')
    await terminal.waitForFrame()

    // Down twice wraps Reject back to Allow once.
    openTurn(harness)
    const cycled = harness.ctx.approval.request({
      agent: harness.agent,
      toolName: 'bash',
      reason: 'Cycle back',
    })
    await terminal.waitForFrame()
    terminal.send('\x1b[B')
    await terminal.waitForFrame()
    terminal.send('\x1b[B')
    await terminal.waitForFrame()
    terminal.send('\r')
    await expect(cycled).resolves.toBe('allowed-once')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('withdraws with Ctrl+C and renders a header-only request', async () => {
    const { harness, terminal } = await setup()
    // Ctrl+C withdraws like Esc; an unrecognized key changes nothing.
    openTurn(harness)
    const interrupted = harness.ctx.approval.request({
      agent: harness.agent,
      toolName: 'bash',
      reason: 'Ctrl+C me',
    })
    await terminal.waitForFrame()
    terminal.send('x')
    await new Promise(resolve => setTimeout(resolve, 20))
    terminal.send('\x03')
    await expect(interrupted).resolves.toBe('cancelled')
    await terminal.waitForFrame()

    // A request without a reason renders header-only.
    openTurn(harness)
    const bare = harness.ctx.approval.request({
      agent: harness.agent,
      toolName: 'bash',
    })
    await terminal.waitForFrame()
    terminal.send('\r')
    await expect(bare).resolves.toBe('allowed-once')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('delegates requests for agents this terminal does not drive', async () => {
    const { harness, terminal } = await setup()
    const other = createFakeAgent(harness.ctx, harness.ctx.sessions.create(SessionId('other-session')))
    other.session.append('turn/start', { turn: 1 })
    const outcome = await harness.ctx.approval.request({
      agent: other,
      toolName: 'bash',
      reason: 'Foreign agent',
    })
    // No other answerer is composed: the delegation falls through fail-closed.
    expect(outcome).toBe('unavailable')
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('Approve bash?')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('doubles the matching tool card\'s warning bar while the ask is open', async () => {
    const { harness, terminal } = await setup()
    openTurn(harness)
    // A pending tool call the ask can attach to (its card renders with the
    // invisible single panel bar: three leading columns before the glyph).
    harness.session.append('tool/call', { turn: 1, step: 1, callId: CallId('call-1'), name: 'bash', arguments: '{}' })
    await terminal.waitForFrame()
    expect(await terminal.snapshot({ includeScrollback: true })).toContain('"   ○ bash')
    const request = harness.ctx.approval.request({
      agent: harness.agent,
      toolName: 'bash',
      callId: CallId('call-1'),
      reason: 'Run ls -la in /workspace',
    })
    await terminal.waitForFrame()
    const asking = await terminal.snapshot({ includeScrollback: true })
    expect(asking).toContain('Approve bash?')
    // The open ask doubles the warning rail: the card's content column shifts
    // one column right behind the modal.
    expect(asking).toContain('"    ○ bash')
    terminal.send('\r')
    await expect(request).resolves.toBe('allowed-once')
    await terminal.waitForFrame()
    // The decision disarms the doubled rail; the card is still pending.
    expect(await terminal.snapshot({ includeScrollback: true })).toContain('"   ○ bash')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

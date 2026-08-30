/**
 * Tool-card rendering through the live channel: generic, terminal, and diff
 * presenter views, the Ctrl+O visibility cycle, the Ctrl+R reasoning toggle,
 * compaction markers, and turn-end notices.
 */

import { describe, expect, it } from 'vitest'
import { createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
import type { ToolCallView, ToolDefinition, ToolResultView } from '@deepseek-ai/dsh-tools'
import {
  appendAssistant,
  appendStepEnd,
  appendStepStart,
  appendUser,
  createTuiTestHarness,
  disposeTuiTestHarness,
  type TuiHarness,
} from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

/** Build a presenter-enabled tool definition for the harness registry. */
function toolDefinition(name: string, call: ToolCallView, result?: ToolResultView): ToolDefinition {
  return {
    name,
    description: `test ${name}`,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    execute: async () => 'ok',
    // A generic card's pending body previews the parsed arguments, so the
    // view's rawInput follows the live call instead of the fixture constant.
    presentCall: args => call.card === 'generic' ? { ...call, rawInput: args } : call,
    ...(result === undefined ? {} : { presentResult: () => result }),
  }
}

async function setup(
  tools: Record<string, ToolDefinition>,
): Promise<{ harness: TuiHarness<HeadlessTerminal, (code: number) => void>; terminal: HeadlessTerminal }> {
  const terminal = new HeadlessTerminal(96, 36)
  const harness = await createTuiTestHarness(terminal, () => {}, { tools })
  await terminal.waitForFrame()
  return { harness, terminal }
}

/** Append one tool call for `name` through the live session. */
function appendToolCall(
  harness: TuiHarness<HeadlessTerminal, (code: number) => void>,
  name: string, argumentsJson: string, callId = 'call-1',
): void {
  harness.session.append('tool/call', { turn: 1, step: 1, callId: CallId(callId), name, arguments: argumentsJson })
}

function appendToolResult(
  harness: TuiHarness<HeadlessTerminal, (code: number) => void>,
  text: string, callId = 'call-1',
): void {
  harness.session.append('tool/result', {
    turn: 1,
    step: 1,
    message: {
      id: `result-${callId}` as never,
      role: 'user',
      content: [{
        type: 'tool-result',
        toolCallId: CallId(callId),
        content: [{ type: 'text', text }],
      }],
      source: { kind: 'tool', callId: CallId(callId) },
    },
  }, { surfaceOp: 'append' } as never)
}

describe('tool cards in the live channel', () => {
  it('renders a generic presenter card and settles it with the result view', async () => {
    const { harness, terminal } = await setup({
      mytool: toolDefinition('mytool', { card: 'generic', title: 'Run mytool', rawInput: { verbose: true } }, { card: 'generic', title: 'mytool done', content: [{ type: 'text', text: 'result text' }] }),
    })
    appendStepStart(harness.session)
    await terminal.waitForFrame()
    appendToolCall(harness, 'mytool', '{"verbose":true}')
    await terminal.waitForFrame()
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('○ Tool / mytool')
    expect(snapshot).toContain('Run mytool')
    // The snapshot serializes rows with JSON.stringify, so inner quotes are escaped.
    expect(snapshot).toContain('\\"verbose\\": true')
    appendToolResult(harness, 'result text')
    await terminal.waitForFrame()
    appendStepEnd(harness.session)
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('● Tool / mytool')
    expect(snapshot).toContain('mytool done')
    expect(snapshot).toContain('result text')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('renders a terminal card with command, cwd, output, and exit status', async () => {
    const { harness, terminal } = await setup({
      bash: toolDefinition('bash', { card: 'terminal', title: 'ls -la', cwd: '/workspace' }, { card: 'terminal', title: 'ls -la', output: 'total 4', exitCode: 0 }),
    })
    appendStepStart(harness.session)
    await terminal.waitForFrame()
    appendToolCall(harness, 'bash', '{"command":"ls -la"}')
    await terminal.waitForFrame()
    // The pending terminal card shows the command as its $-line plus the cwd.
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('$ ls -la')
    expect(snapshot).toContain('/workspace')
    appendToolResult(harness, 'total 4')
    await terminal.waitForFrame()
    appendStepEnd(harness.session)
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('● Tool / bash')
    expect(snapshot).toContain('total 4')
    expect(snapshot).toContain('[exit 0]')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('renders a diff card with hunks and a change footer', async () => {
    const { harness, terminal } = await setup({
      edit: toolDefinition('edit', { card: 'diff', title: 'Edit a.txt', diffs: [{ path: 'a.txt', oldText: 'one\ntwo', newText: 'one\nthree' }] }),
    })
    appendStepStart(harness.session)
    await terminal.waitForFrame()
    appendToolCall(harness, 'edit', '{}')
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('○ Tool / edit')
    expect(snapshot).toContain('a.txt')
    expect(snapshot).toContain('+ three')
    expect(snapshot).toContain('- two')
    expect(snapshot).toContain('└ +1 -1 · 1 file')
    appendStepEnd(harness.session)
    await terminal.waitForFrame()
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('cycles card visibility with Ctrl+O and toggles reasoning with Ctrl+R', async () => {
    const { harness, terminal } = await setup({
      bash: toolDefinition('bash', { card: 'generic', title: 'Run bash', rawInput: {} }),
    })
    appendStepStart(harness.session)
    await terminal.waitForFrame()
    harness.session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'secret reasoning' },
    })
    await terminal.waitForFrame()
    // Reasoning starts collapsed; expand it once so the assertions below can
    // see the streamed content before later hiding it with Ctrl+R again.
    terminal.send('\x12')
    await terminal.waitForFrame()
    // A multi-line pending body: collapsed preview truncates it, so every
    // Ctrl+O step changes the rendered card and emits a frame deterministically.
    appendToolCall(harness, 'bash', '{"verbose":true,"command":"ls -la","cwd":"/workspace","a":1,"b":2,"c":3,"d":4}')
    await terminal.waitForFrame()
    // A second step of the same turn folds into a headerless continuation
    // while tool cards are hidden.
    harness.session.append('step/start', { turn: 1, step: 2 })
    await terminal.waitForFrame()
    harness.session.append('assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: { type: 'text-delta', index: 0, text: 'second step body' },
    })
    await terminal.waitForFrame()
    // Expanded shows the whole body.
    terminal.send('\x0f')
    await terminal.waitForFrame()
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('secret reasoning')
    expect(snapshot).toContain('Run bash')
    // Hidden drops the card and folds the steps into one headerful turn.
    terminal.send('\x0f')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('Tool / bash')
    expect(snapshot).not.toContain('Run bash')
    expect(snapshot.match(/Assistant/g) ?? []).toHaveLength(1)
    expect(snapshot).toContain('second step body')
    // Back to collapsed.
    terminal.send('\x0f')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Tool / bash')
    // Ctrl+R hides reasoning blocks.
    terminal.send('\x12')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('secret reasoning')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('renders an unknown-tool XML result as an indented tree', async () => {
    const { harness, terminal } = await setup({})
    appendStepStart(harness.session)
    await terminal.waitForFrame()
    appendToolCall(harness, 'unknown-tool', '{}', 'call-xml')
    await terminal.waitForFrame()
    appendToolResult(harness, '<result><path>/tmp/a</path><type>file</type></result>', 'call-xml')
    await terminal.waitForFrame()
    appendStepEnd(harness.session)
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('result')
    expect(snapshot).toContain('path: /tmp/a')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('renders a compaction checkpoint marker without re-rendering replaced history', async () => {
    const { harness, terminal } = await setup({})
    appendUser(harness.session, 'before compaction')
    await terminal.waitForFrame()
    harness.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '[compaction checkpoint]' }],
      source: { kind: 'plugin', plugin: 'compact' },
    }), { surfaceOp: { op: 'replace', start: 0, end: 0 }, sourceEventSeqs: [0] })
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('… earlier context was compacted …')
    expect(snapshot).toContain('before compaction')
    expect(snapshot).not.toContain('[compaction checkpoint]')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('renders turn-end reason notices', async () => {
    const { harness, terminal } = await setup({})
    appendStepStart(harness.session)
    await terminal.waitForFrame()
    appendAssistant(harness.session, [{ type: 'text', text: 'partial' }])
    await terminal.waitForFrame()
    harness.session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    await terminal.waitForFrame()
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Turn cancelled.')
    harness.session.append('turn/end', { turn: 2, reason: { kind: 'max-tokens' } })
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('The model reached its output-token limit.')
    harness.session.append('turn/end', { turn: 3, reason: { kind: 'error', error: { message: 'provider down', code: 'provider_down' } } })
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('provider down')
    harness.session.append('turn/end', { turn: 4, reason: { kind: 'interrupted' } })
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('The previous process ended during this turn.')
    appendStepStart(harness.session)
    await terminal.waitForFrame()
    appendAssistant(harness.session, [{ type: 'text', text: 'second step' }])
    await terminal.waitForFrame()
    appendStepEnd(harness.session)
    await terminal.waitForFrame()
    // A completed turn keeps the settled step and adds no notice; the render
    // is a no-op, so the snapshot polls instead of waiting for a frame.
    harness.session.append('turn/end', { turn: 5, reason: { kind: 'completed' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('second step')
    expect(snapshot).not.toContain('Turn ended:')
    harness.session.append('turn/end', { turn: 6, reason: { kind: 'unknown-kind' } as never })
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Turn ended: unknown-kind.')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('opens a step on a bare step/end and completes it', async () => {
    const { harness, terminal } = await setup({})
    harness.session.append('step/end', { turn: 1, step: 1 })
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Assistant')
    expect(snapshot).toContain('Completed')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('creates a card from a lone tool result', async () => {
    const { harness, terminal } = await setup({})
    appendToolResult(harness, 'orphan result', 'call-orphan')
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    // A result without its call has no tool name, so the card falls back to
    // the neutral `tool` frame.
    expect(snapshot).toContain('● Tool / tool')
    expect(snapshot).toContain('orphan result')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('renders no marker for a non-compaction replacement', async () => {
    const { harness, terminal } = await setup({})
    appendUser(harness.session, 'before compaction')
    await terminal.waitForFrame()
    harness.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'replaced' }],
      source: { kind: 'plugin', plugin: 'goal' },
    }), { surfaceOp: { op: 'replace', start: 0, end: 0 }, sourceEventSeqs: [0] })
    await new Promise(resolve => setTimeout(resolve, 20))
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).not.toContain('… earlier context was compacted …')
    expect(snapshot).not.toContain('replaced')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('labels injected context from kind-only, unknown, and plugin sources', async () => {
    const { harness, terminal } = await setup({})
    harness.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'kind context\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9' }],
      source: { kind: 'plugin' } as never,
    }), { surfaceOp: 'append' })
    await terminal.waitForFrame()
    harness.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'unknown context' }],
      source: {} as never,
    }), { surfaceOp: 'append' })
    await terminal.waitForFrame()
    harness.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'goal context' }],
      source: { kind: 'plugin', plugin: 'goal' },
    }), { surfaceOp: 'append' })
    await terminal.waitForFrame()
    // A blank injected message draws no card at all; a blank human message
    // draws no bubble either.
    harness.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '   ' }],
      source: { kind: 'plugin' } as never,
    }), { surfaceOp: 'append' })
    harness.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '\n ' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await new Promise(resolve => setTimeout(resolve, 20))
    let snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('Context · plugin')
    expect(snapshot).toContain('Context · context')
    expect(snapshot).toContain('Context · goal')
    expect(snapshot).not.toContain('You')
    // The long card is folded; Ctrl+O expands the context cards along with
    // the tool cards, so the fold marker gives way to the last body line.
    expect(snapshot).toContain('… +3 lines (Ctrl+O to expand)')
    expect(snapshot).not.toContain('l4')
    terminal.send('\x0f')
    await terminal.waitForFrame()
    snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('l4')
    expect(snapshot).not.toContain('(Ctrl+O to expand)')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('starts a fresh step when a second assistant message arrives settled', async () => {
    const { harness, terminal } = await setup({})
    appendStepStart(harness.session)
    await terminal.waitForFrame()
    appendAssistant(harness.session, [{ type: 'text', text: 'first' }])
    await terminal.waitForFrame()
    // The step is settled; a second message of the same step starts a new
    // component instead of reusing the settled one.
    appendAssistant(harness.session, [{ type: 'text', text: 'second' }])
    await terminal.waitForFrame()
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    expect(snapshot).toContain('second')
    expect(snapshot.match(/Assistant/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

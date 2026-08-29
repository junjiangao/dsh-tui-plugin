/**
 * Agent-preset support in the live channel: the /preset picker over the roster,
 * the blank-session recompose gate with its durable agent-preset/selected
 * record, the started-session lock, and the rosterless fallback warning.
 */

import type {} from '@deepseek-ai/dsh-agent-presets'
import { describe, expect, it } from 'vitest'
import { createTuiTestHarness, disposeTuiTestHarness } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

async function waitForSnapshot(
  terminal: HeadlessTerminal,
  predicate: (snapshot: string) => boolean,
  timeoutMs = 2_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const snapshot = await terminal.snapshot({ includeScrollback: true })
    if (predicate(snapshot)) return snapshot
    if (Date.now() >= deadline) {
      throw new Error(`snapshot did not satisfy the predicate within ${timeoutMs}ms`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

async function submit(terminal: HeadlessTerminal, line: string): Promise<void> {
  terminal.send(line)
  await terminal.waitForFrame()
  terminal.send('\r')
}

/** A controllable roster stub recording every call the channel makes. */
function fakeRoster(current: () => string | undefined) {
  const calls = {
    resolve: [] as Array<string | undefined>,
    mount: [] as string[],
    recompose: [] as string[],
    lists: 0,
  }
  const roster = {
    defaultId: 'standard',
    list: async () => {
      calls.lists += 1
      return [
        { id: 'standard', trust: 'system', path: '/ship/standard/agent.cordis.yml', name: '标准模式', description: '全功能' },
        { id: 'minimal', trust: 'system', path: '/ship/minimal/agent.cordis.yml', name: '极简模式', description: '仅 shell 与文件' },
        { id: 'code', trust: 'user', path: '/home/me/.agent-presets/code/agent.cordis.yml', name: 'PTC 模式' },
        { id: 'broken', trust: 'user', path: '/home/me/.agent-presets/broken/agent.cordis.yml', broken: 'unparsable YAML' },
      ]
    },
    resolve: async (id?: string) => {
      calls.resolve.push(id)
      const picked = id ?? 'standard'
      if (picked === 'missing' || picked === 'broken') throw new Error(`refused: ${picked}`)
      return { id: picked, trust: 'system', path: `/ship/${picked}/agent.cordis.yml` }
    },
    mount: async (_agentCtx: unknown, id: string) => {
      calls.mount.push(id)
    },
    recompose: async (_agentCtx: unknown, id: string) => {
      calls.recompose.push(id)
      if (id === 'missing' || id === 'broken') throw new Error(`refused: ${id}`)
      return { id, trust: 'system', path: `/ship/${id}/agent.cordis.yml` }
    },
    composedPreset: (_agentCtx: unknown) => current(),
  }
  return { roster, calls }
}

describe('preset switching in the live channel', () => {
  it('opens the /preset picker listing the roster with the current preset marked', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const { roster } = fakeRoster(() => 'standard')
    const harness = await createTuiTestHarness(terminal, () => {}, { agentPresets: roster })
    await terminal.waitForFrame()
    await submit(terminal, '/preset')
    const snapshot = await waitForSnapshot(terminal, text => text.includes('Select agent preset'))
    expect(snapshot).toContain('标准模式')
    expect(snapshot).toContain('极简模式')
    expect(snapshot).toContain('PTC 模式')
    // The current preset carries the marker; broken presets stay listed with
    // their reason; user presets are tagged.
    expect(snapshot).toContain('current')
    expect(snapshot).toContain('broken: unparsable YAML')
    expect(snapshot).toContain('user')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('switches a blank session with /preset <id> and records the swap', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const { roster, calls } = fakeRoster(() => 'standard')
    const harness = await createTuiTestHarness(terminal, () => {}, { agentPresets: roster })
    await terminal.waitForFrame()
    await submit(terminal, '/preset minimal')
    await waitForSnapshot(terminal, text => text.includes('Agent preset set to minimal'))
    expect(calls.recompose).toEqual(['minimal'])
    expect(harness.session.events.some(event => event.type === 'agent-preset/selected' && event.data.agentPreset === 'minimal')).toBe(true)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('refuses to switch a session that has already started', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const { roster, calls } = fakeRoster(() => 'standard')
    const harness = await createTuiTestHarness(terminal, () => {}, {
      agentPresets: roster,
      beforeMount: (session) => {
        session.append('turn/start', { turn: 1 })
      },
    })
    await terminal.waitForFrame()
    await submit(terminal, '/preset minimal')
    await waitForSnapshot(terminal, text => text.includes('Preset locked'))
    expect(calls.recompose).toEqual([])
    expect(harness.session.events.some(event => event.type === 'agent-preset/selected')).toBe(false)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('surfaces a refused recompose without recording a switch', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const { roster, calls } = fakeRoster(() => 'standard')
    const harness = await createTuiTestHarness(terminal, () => {}, { agentPresets: roster })
    await terminal.waitForFrame()
    await submit(terminal, '/preset missing')
    await waitForSnapshot(terminal, text => text.includes('Could not switch agent preset'))
    expect(calls.recompose).toEqual(['missing'])
    expect(harness.session.events.some(event => event.type === 'agent-preset/selected')).toBe(false)
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('warns when the deployment composes no roster', async () => {
    const terminal = new HeadlessTerminal(96, 36)
    const harness = await createTuiTestHarness(terminal, () => {}, {})
    await terminal.waitForFrame()
    await submit(terminal, '/preset')
    await waitForSnapshot(terminal, text => text.includes('composes no agent presets'))
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

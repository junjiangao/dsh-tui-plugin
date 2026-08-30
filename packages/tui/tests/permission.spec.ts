/**
 * Permission-mode settings through the live channel: the /permission selector
 * below the input box, direct ask/never switches, and unknown-mode reporting.
 */

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

async function setup(): Promise<{
  harness: Awaited<ReturnType<typeof createTuiTestHarness<HeadlessTerminal, (code: number) => void>>>
  terminal: HeadlessTerminal
}> {
  const terminal = new HeadlessTerminal(96, 36)
  const harness = await createTuiTestHarness(terminal, () => {}, {})
  await terminal.waitForFrame()
  return { harness, terminal }
}

function policyEvents(harness: Awaited<ReturnType<typeof setup>>['harness']): string[] {
  return harness.session.events
    .filter((event): event is { type: 'approval/policy'; data: { policy: string } } =>
      event.type === 'approval/policy')
    .map(event => event.data.policy)
}

function presetEvents(harness: Awaited<ReturnType<typeof setup>>['harness']): string[] {
  return harness.session.events
    .filter((event): event is { type: 'permission/preset'; data: { preset: string } } =>
      event.type === 'permission/preset')
    .map(event => event.data.preset)
}

function sandboxEvents(harness: Awaited<ReturnType<typeof setup>>['harness']): string[] {
  return harness.session.events
    .filter((event): event is { type: 'sandbox/mode'; data: { mode: string } } =>
      (event as { type: string }).type === 'sandbox/mode')
    .map(event => (event as { data: { mode: string } }).data.mode)
}

function providePermissionPresets(
  harness: Awaited<ReturnType<typeof setup>>['harness'],
  initial = 'workspace-write',
): void {
  const names = ['read-only', 'workspace-write', 'danger-full-access'] as const
  const specs = {
    'read-only': { sandbox: 'read-only', approval: 'ask' },
    'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
    'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
  } as const
  // The base profile pins workspace-write as the default sandbox mode; mirror
  // that so a switch away from the default appends the expected sandbox event.
  harness.ctx.provide('sandboxPolicy', { defaultMode: 'workspace-write' } as never)
  harness.ctx.provide('permissionPresets', {
    names,
    current: () => {
      const events = harness.session.events
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if ((event as { type: string }).type === 'permission/preset') {
          return (event as { data: { preset: string } }).data.preset
        }
      }
      return initial
    },
    resolve: (name: keyof typeof specs) => specs[name],
    optionOf: (name: string) => ({ value: name, name }),
  } as never)
}

describe('permission mode in the live channel', () => {
  it('opens the mode selector below the input box with the current mode marked and Esc closes it', async () => {
    const { harness, terminal } = await setup()
    await submit(terminal, '/permission')
    const snapshot = await waitForSnapshot(terminal, snapshot => snapshot.includes('Permission mode'))
    expect(snapshot).toContain('ask (current)')
    expect(snapshot).toContain('never')
    expect(snapshot).toContain('↑/↓ move • Enter select • Esc')

    terminal.send('\x1b')
    await waitForSnapshot(terminal, snapshot => !snapshot.includes('Permission mode'))
    expect(policyEvents(harness)).toEqual([])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('selects a mode with arrows and Enter', async () => {
    const { harness, terminal } = await setup()
    await submit(terminal, '/permission')
    await waitForSnapshot(terminal, snapshot => snapshot.includes('Permission mode'))
    terminal.send('\x1b[B')
    terminal.send('\r')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Permission mode set to never.'))
    expect(snapshot).toContain('· never')
    expect(policyEvents(harness)).toEqual(['never'])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('switches directly with /permission ask|never and reports already-current', async () => {
    const { harness, terminal } = await setup()
    await submit(terminal, '/permission never')
    const switched = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Permission mode set to never.'))
    expect(switched).toContain('· never')
    expect(policyEvents(harness)).toEqual(['never'])

    await submit(terminal, '/permission ask')
    const restored = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Permission mode set to ask.'))
    expect(restored).toContain('· ask')
    expect(policyEvents(harness)).toEqual(['never', 'ask'])

    await submit(terminal, '/permission ask')
    const already = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Permission mode is already ask.'))
    expect(already).toContain('· ask')
    expect(policyEvents(harness)).toEqual(['never', 'ask'])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('reports unknown permission modes with the usage line', async () => {
    const { harness, terminal } = await setup()
    await submit(terminal, '/permission maybe')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Unknown permission mode'))
    expect(snapshot).toContain('Usage: /permission [ask|never]')
    expect(policyEvents(harness)).toEqual([])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('lists the permission presets from the web permission service and selects one', async () => {
    const { harness, terminal } = await setup()
    providePermissionPresets(harness)
    await submit(terminal, '/permission')
    const snapshot = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Permission mode') && snapshot.includes('Workspace Write (current)'))
    expect(snapshot).toContain('Read Only')
    expect(snapshot).toContain('Full access')

    // workspace-write (index 1) → danger-full-access (index 2).
    terminal.send('\x1b[B')
    terminal.send('\r')
    const switched = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Permission mode set to Full access.'))
    expect(switched).toContain('· Full access')
    expect(presetEvents(harness)).toEqual(['danger-full-access'])
    expect(sandboxEvents(harness)).toEqual(['danger-full-access'])
    expect(policyEvents(harness)).toEqual(['never'])
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })

  it('switches a permission preset directly and reports the host usage line', async () => {
    const { harness, terminal } = await setup()
    providePermissionPresets(harness)
    await submit(terminal, '/permission read-only')
    await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Permission mode set to Read Only.'))
    expect(presetEvents(harness)).toEqual(['read-only'])
    expect(sandboxEvents(harness)).toEqual(['read-only'])
    expect(policyEvents(harness)).toEqual([])

    await submit(terminal, '/permission ask')
    const unknown = await waitForSnapshot(terminal, snapshot =>
      snapshot.includes('Unknown permission mode'))
    expect(unknown).toContain('Usage: /permission [read-only|workspace-write|danger-full-access]')
    await disposeTuiTestHarness(harness)
    await terminal.dispose()
  })
})

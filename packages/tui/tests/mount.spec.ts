/**
 * mountTui drives the real registry transaction: fresh create, resume through
 * the startup values, and a loud failure when the tree has no agent factory.
 */

import type {} from '@deepseek-ai/dsh-agent-presets'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import { TUI_STARTUP_SERVICE, mountTui } from '../src/index.ts'
import { installFakeAgentFactory, provideLlm } from './harness.ts'
import { HeadlessTerminal } from './headless-terminal.ts'

/** Mount the interaction services the mounted channel composes in production. */
async function mountChannelServices(ctx: Context): Promise<void> {
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(SessionProjectionRegistry)
  provideLlm(ctx)
}

describe('mountTui', () => {
  it('creates a fresh agent and mounts the channel when no resume flag is given', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await mountChannelServices(ctx)
    const installed = installFakeAgentFactory(ctx)
    const terminal = new HeadlessTerminal(80, 24)
    const exits: number[] = []
    mountTui(ctx, { sessionId: 'fresh-session' }, {
      terminal,
      exit: code => void exits.push(code),
    })
    await terminal.waitForFrame()
    expect(installed.agents).toHaveLength(1)
    expect(String(installed.agents[0]?.id)).toBe('fresh-session')
    expect(terminal.started).toBe(1)
    expect(exits).toEqual([])
    await ctx.fiber.dispose()
    await terminal.dispose()
  })

  it('resumes the named session when the startup values carry a resume id', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await mountChannelServices(ctx)
    const installed = installFakeAgentFactory(ctx)
    ctx.provide(TUI_STARTUP_SERVICE, { resumeSessionId: 'persisted-1' })
    const terminal = new HeadlessTerminal(80, 24)
    const exits: number[] = []
    mountTui(ctx, { sessionId: 'persisted-1', model: 'deepseek-official/deepseek-v4-pro' }, {
      terminal,
      exit: code => void exits.push(code),
    })
    await terminal.waitForFrame()
    expect(installed.agents).toHaveLength(1)
    expect(String(installed.agents[0]?.id)).toBe('persisted-1')
    expect(installed.agents[0]?.options).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    await ctx.fiber.dispose()
    await terminal.dispose()
  })

  it('reports a startup failure loudly and exits 1 without taking over the terminal', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const terminal = new HeadlessTerminal(80, 24)
    const exits: number[] = []
    mountTui(ctx, {}, {
      terminal,
      exit: code => void exits.push(code),
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(exits).toEqual([1])
    expect(terminal.started).toBe(0)
    const snapshot = await terminal.snapshot()
    expect(snapshot).toContain('failed to start')
    await ctx.fiber.dispose()
    await terminal.dispose()
  })

  it('passes a parsed model route to a fresh create', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await mountChannelServices(ctx)
    const installed = installFakeAgentFactory(ctx)
    const terminal = new HeadlessTerminal(80, 24)
    mountTui(ctx, { sessionId: 'fresh-session', model: 'deepseek-official/deepseek-v4-pro' }, {
      terminal,
      exit: () => {},
    })
    await terminal.waitForFrame()
    expect(installed.agents[0]?.options).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    await ctx.fiber.dispose()
    await terminal.dispose()
  })

  it('boots on the agent-default-model selection when no model route is configured', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await mountChannelServices(ctx)
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({
        provider: 'settings-provider',
        model: 'settings-model',
        reasoningEffort: 'low',
      }),
    })
    const installed = installFakeAgentFactory(ctx)
    const terminal = new HeadlessTerminal(80, 24)
    mountTui(ctx, { sessionId: 'fresh-default' }, {
      terminal,
      exit: () => {},
    })
    await terminal.waitForFrame()
    expect(installed.agents[0]?.options).toEqual({ provider: 'settings-provider', model: 'settings-model' })
    // The status footer shows the default selection instead of `model unset`;
    // the configured reasoning effort is part of that initial selection.
    expect(await terminal.snapshot()).toContain('settings-model [settings-provider] low')
    await ctx.fiber.dispose()
    await terminal.dispose()
  })

  it('waits for the loader before reading the saved default model', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await mountChannelServices(ctx)
    let selection: { provider: string; model: string; reasoningEffort?: string } = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    ctx.provide('agentDefaultModel', {
      currentSelection: () => selection,
      saveSelection: async () => {},
    })
    let releaseLoader: (() => void) | undefined
    const loaderGate = new Promise<void>((resolve) => { releaseLoader = resolve })
    ctx.provide('loader', { await: () => loaderGate })
    const installed = installFakeAgentFactory(ctx)
    const terminal = new HeadlessTerminal(80, 24)
    const exits: number[] = []
    mountTui(ctx, { sessionId: 'fresh-loader' }, {
      terminal,
      exit: code => void exits.push(code),
    })
    // The TUI must not create the agent until the loader (and therefore the
    // settings-backed default model) has settled.
    await Promise.resolve()
    expect(installed.agents).toHaveLength(0)
    selection = { provider: 'settings-provider', model: 'settings-model', reasoningEffort: 'low' }
    releaseLoader?.()
    await terminal.waitForFrame()
    expect(installed.agents).toHaveLength(1)
    expect(installed.agents[0]?.options).toEqual({ provider: 'settings-provider', model: 'settings-model' })
    expect(exits).toEqual([])
    await ctx.fiber.dispose()
    await terminal.dispose()
  })

  it('keeps the session default route when the model flag is malformed or absent', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await mountChannelServices(ctx)
    const installed = installFakeAgentFactory(ctx)
    ctx.provide(TUI_STARTUP_SERVICE, { resumeSessionId: 'persisted-2' })
    const terminal = new HeadlessTerminal(80, 24)
    mountTui(ctx, { sessionId: 'persisted-2', model: 'novalue' }, {
      terminal,
      exit: () => {},
    })
    await terminal.waitForFrame()
    expect(installed.agents[0]?.options).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    await ctx.fiber.dispose()
    await terminal.dispose()

    const second = new Context()
    await second.plugin(SessionStore)
    await second.plugin(AgentRegistry)
    await mountChannelServices(second)
    const secondInstalled = installFakeAgentFactory(second)
    const secondTerminal = new HeadlessTerminal(80, 24)
    mountTui(second, { sessionId: 'fresh-2', model: 'provider/' }, {
      terminal: secondTerminal,
      exit: () => {},
    })
    await secondTerminal.waitForFrame()
    expect(secondInstalled.agents[0]?.options).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    await second.fiber.dispose()
    await secondTerminal.dispose()
  })

  it('mounts the roster default on a fresh create and records it on the header', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await mountChannelServices(ctx)
    const { roster, calls } = presetRoster()
    ctx.provide('agentPresets', roster)
    const installed = installFakeAgentFactory(ctx)
    const terminal = new HeadlessTerminal(80, 24)
    const exits: number[] = []
    mountTui(ctx, { sessionId: 'fresh-preset' }, {
      terminal,
      exit: code => void exits.push(code),
    })
    await terminal.waitForFrame()
    expect(calls.mount).toEqual(['standard'])
    expect(installed.agents[0]?.session.header.agentPreset).toBe('standard')
    expect(exits).toEqual([])
    await ctx.fiber.dispose()
    await terminal.dispose()
  })

  it('mounts the --preset id on a fresh create', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await mountChannelServices(ctx)
    const { roster, calls } = presetRoster()
    ctx.provide('agentPresets', roster)
    ctx.provide(TUI_STARTUP_SERVICE, { preset: 'minimal' })
    const installed = installFakeAgentFactory(ctx)
    const terminal = new HeadlessTerminal(80, 24)
    mountTui(ctx, { sessionId: 'fresh-minimal' }, {
      terminal,
      exit: () => {},
    })
    await terminal.waitForFrame()
    expect(calls.mount).toEqual(['minimal'])
    expect(installed.agents[0]?.session.header.agentPreset).toBe('minimal')
    await ctx.fiber.dispose()
    await terminal.dispose()
  })

  it('resumes from the preset switch the session log recorded', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await mountChannelServices(ctx)
    const { roster, calls } = presetRoster()
    ctx.provide('agentPresets', roster)
    ctx.provide(TUI_STARTUP_SERVICE, { resumeSessionId: 'persisted-preset' })
    const installed = installFakeAgentFactory(ctx, (_agent, session) => {
      session.append('agent-preset/selected', { agentPreset: 'code' })
    })
    const terminal = new HeadlessTerminal(80, 24)
    mountTui(ctx, { sessionId: 'persisted-preset' }, {
      terminal,
      exit: () => {},
    })
    await terminal.waitForFrame()
    expect(String(installed.agents[0]?.id)).toBe('persisted-preset')
    expect(calls.mount).toEqual(['code'])
    await ctx.fiber.dispose()
    await terminal.dispose()
  })

  it('fails a resume whose --preset contradicts the recorded switch before taking over the terminal', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await mountChannelServices(ctx)
    const { roster } = presetRoster()
    ctx.provide('agentPresets', roster)
    ctx.provide(TUI_STARTUP_SERVICE, { resumeSessionId: 'persisted-conflict', preset: 'minimal' })
    installFakeAgentFactory(ctx, (_agent, session) => {
      session.append('agent-preset/selected', { agentPreset: 'code' })
    })
    const terminal = new HeadlessTerminal(80, 24)
    const exits: number[] = []
    mountTui(ctx, { sessionId: 'persisted-conflict' }, {
      terminal,
      exit: code => void exits.push(code),
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(exits).toEqual([1])
    expect(terminal.started).toBe(0)
    const snapshot = await terminal.snapshot()
    expect(snapshot).toContain('agent preset conflict')
    await ctx.fiber.dispose()
    await terminal.dispose()
  })
})

/** A minimal preset-roster stub recording resolve/mount calls; list/recompose are present for the channel controller. */
function presetRoster() {
  const calls = { resolve: [] as Array<string | undefined>, mount: [] as string[] }
  const roster = {
    defaultId: 'standard',
    list: async () => [],
    resolve: async (id?: string) => {
      calls.resolve.push(id)
      const picked = id ?? 'standard'
      return { id: picked, trust: 'system', path: `/ship/${picked}/agent.cordis.yml` }
    },
    mount: async (_agentCtx: unknown, id: string) => {
      calls.mount.push(id)
    },
    recompose: async (_agentCtx: unknown, id: string) => ({ id, trust: 'system', path: `/ship/${id}/agent.cordis.yml` }),
    composedPreset: (_agentCtx: unknown) => undefined,
  }
  return { roster, calls }
}

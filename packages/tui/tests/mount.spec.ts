/**
 * mountTui drives the real registry transaction: fresh create, resume through
 * the startup values, and a loud failure when the tree has no agent factory.
 */

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
})

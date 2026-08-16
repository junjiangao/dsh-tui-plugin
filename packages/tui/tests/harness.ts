import { createMessage, createUserMessage, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import type { Terminal } from '@earendil-works/pi-tui'
import AgentRegistry, { Inbox, type Agent, type AgentCancelCause, type AgentFactory, type AgentHandle, type AgentOptions, type AgentStatus, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import { initialTarget } from '../src/components/dialogs.ts'
import { createTuiChat, type Config, type TuiRuntime } from '../src/index.ts'

/** An agent the test drives directly, recording every call the channel makes. */
export interface FakeAgent extends Agent {
  /** The test may flip this directly; transitions are published via `agent/status`. */
  status: AgentStatus
  /** Follow-up prompts submitted while idle. */
  readonly followups: ContentBlock[][]
  /** Steering submitted while running. */
  readonly steered: ContentBlock[][]
  /** The full steering messages, for identity assertions (inbox claims). */
  readonly steeredMessages: UserMessage[]
  /** Context messages injected before submission (session references). */
  readonly injected: ContentBlock[][]
  /** Cancellation causes recorded in arrival order. */
  readonly cancelled: AgentCancelCause[]
  /** Handle disposals observed (the channel owns one handle). */
  readonly disposed: boolean[]
}

export interface TuiHarnessOptions {
  /** Initial agent status. */
  status?: AgentStatus
  /** TUI presentation config. */
  config?: Config
  /** Session cwd; `null` leaves it unset. */
  cwd?: string | null
  /** Runtime overrides. */
  runtime?: Partial<Omit<TuiRuntime, 'terminal' | 'exit'>>
  /** Seed the session log before the channel mounts (replay coverage). */
  beforeMount?: (session: Session) => void
  /** Tool definitions the stub `ctx.tools` registry answers for. */
  tools?: Record<string, ToolDefinition>
  /** Replace the fixed LLM catalog stub (model selector / context resolution). */
  llm?: unknown
  /** Replace the token-meter stub (context occupancy in the status footer). */
  tokenMeter?: unknown
  /** Session-reference resolver stub, provided before the channel mounts. */
  sessionReferenceResolver?: unknown
}

export interface TuiHarness<TerminalType extends Terminal, Exit extends (code: number) => void> {
  ctx: Context
  session: Session
  agent: FakeAgent
  /** The shared selected-model handle the channel mutates and the agent setup applies. */
  selection: ModelSelectionRef
  terminal: TerminalType
  exit: Exit
  controller: ReturnType<typeof createTuiChat>
}

/** A bare root context exposing the harness command runtime to agent fibers. */
function agentCommandCtx(ctx: Context): Context {
  const agentCtx = new Context()
  agentCtx.provide('commands', ctx.commands)
  return agentCtx
}

/**
 * Provide the fixed LLM catalog the model controller and /model selector read:
 * one provider advertising two models with known context windows, one with a
 * reasoning-effort scale.
 * @param ctx - context to provide the stub on.
 */
export function provideLlm(ctx: Context): void {
  ctx.provide('llm', {
    listProviders: () => [{
      id: 'deepseek-official',
      name: 'DeepSeek',
    }],
    listModels: async (provider: string) => provider === 'deepseek-official'
      ? [
        { provider, id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        {
          provider,
          id: 'deepseek-v4-pro',
          name: 'DeepSeek V4 Pro',
          description: 'Frontier reasoning',
        },
      ]
      : [],
    resolveModelInfo: async (_provider: string, model: string) => model === 'deepseek-v4-pro'
      ? {
        context: { contextWindow: 256_000 },
        reasoning: {
          efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
          defaultEffort: 'high',
        },
        defaultMaxTokens: 16_384,
      }
      : { context: { contextWindow: 128_000 }, defaultMaxTokens: 8_192 },
  } as never)
}

/**
 * Build the controllable fake agent over a live session, recording every call.
 * @param ctx - context carrying the agent registry.
 * @param session - the session this agent drives.
 * @param options - agent options reflected on the fake.
 * @param status - initial lifecycle status.
 * @returns the fake agent with its call recordings.
 */
export function createFakeAgent(
  ctx: Context,
  session: Session,
  options: AgentOptions = { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  status: AgentStatus = 'idle',
): FakeAgent {
  const followups: ContentBlock[][] = []
  const steered: ContentBlock[][] = []
  const steeredMessages: UserMessage[] = []
  const injected: ContentBlock[][] = []
  const cancelled: AgentCancelCause[] = []
  const disposed: boolean[] = []
  const inbox = new Inbox(session, {
    inserted() {},
    discarded() {},
    claimed() {},
  })
  const agent: FakeAgent = {
    id: session.id,
    options,
    session,
    inbox,
    status,
    // A bare root that provides the harness command runtime itself: the
    // agent-scoped fiber the channel registers its commands on resolves the
    // same instance the channel executes, so registrations land in the
    // instance's effective view.
    ctx: agentCommandCtx(ctx),
    followups,
    steered,
    steeredMessages,
    injected,
    cancelled,
    disposed,
    cancel(cause) {
      cancelled.push(cause)
    },
    whenIdle() {
      return Promise.resolve()
    },
    runMaintenance(task) {
      return task(new AbortController().signal)
    },
    send() {},
    followup(message) {
      followups.push(message.content)
    },
    steer(message) {
      steered.push(message.content)
      steeredMessages.push(message)
    },
    inject(message) {
      injected.push(message.content)
    },
  }
  ctx.agents.register(agent)
  return agent
}

/**
 * Register a fake agent factory so `ctx.agents.create/resume` drive the same
 * controllable agent shape through the real registry transaction.
 * @param ctx - context carrying the agent registry.
 * @returns the factory and a view of every handle it produced.
 */
export function installFakeAgentFactory(ctx: Context): {
  factory: AgentFactory
  handles: AgentHandle[]
  agents: FakeAgent[]
} {
  const handles: AgentHandle[] = []
  const agents: FakeAgent[] = []
  const factory: AgentFactory = {
    async createAgent(ownerCtx, options) {
      const session = ownerCtx.sessions.create(options.sessionId, {
        ...(options.meta === undefined ? {} : { meta: options.meta }),
      })
      const agent = createFakeAgent(ownerCtx, session, options.agentOptions)
      // The real factory awaits setup before announcing the agent; the fake
      // mirrors that so channel consumers observe the same composed scope.
      await options.setup?.(agent.ctx)
      agents.push(agent)
      const handle: AgentHandle = {
        agent,
        dispose: async () => {
          agent.disposed.push(true)
        },
      }
      handles.push(handle)
      return handle
    },
    async resume(ownerCtx, options) {
      const session = ownerCtx.sessions.create(options.resumeSessionId)
      const agent = createFakeAgent(ownerCtx, session, options.agentOptions)
      await options.setup?.(agent.ctx)
      agents.push(agent)
      const handle: AgentHandle = {
        agent,
        dispose: async () => {
          agent.disposed.push(true)
        },
      }
      handles.push(handle)
      return handle
    },
  }
  ctx.agents.setFactory(factory)
  return { factory, handles, agents }
}

/**
 * Compose the production TUI around an in-memory session and controllable agent.
 * @param terminal - Terminal boundary driven by the test.
 * @param exit - Process-exit observer.
 * @param options - Initial session, agent, and TUI configuration.
 * @returns The mounted TUI and every boundary the test may drive or inspect.
 */
export async function createTuiTestHarness<TerminalType extends Terminal, Exit extends (code: number) => void>(
  terminal: TerminalType,
  exit: Exit,
  options: TuiHarnessOptions = {},
): Promise<TuiHarness<TerminalType, Exit>> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(SessionProjectionRegistry)
  // The channel only consumes the presentation seam of the tool registry, so
  // the harness answers with the definitions the test supplied.
  ctx.provide('tools', {
    get: (name: string) => options.tools?.[name],
  } as never)
  if (options.llm === undefined) provideLlm(ctx)
  else ctx.provide('llm', options.llm)
  // The context-occupancy segment of the status footer renders only when the
  // token meter is present; tests opt in so default snapshots stay free of
  // the async context-window resolution race.
  if (options.tokenMeter !== undefined) ctx.provide('tokenMeter', options.tokenMeter)
  const sessionId = SessionId('main-session')
  const session = ctx.sessions.create(
    sessionId,
    ...(options.cwd === null ? [] as const : [{ meta: { cwd: options.cwd ?? '/workspace' } }]),
  )
  options.beforeMount?.(session)
  if (options.sessionReferenceResolver !== undefined) {
    ctx.provide('sessionReferenceResolver', options.sessionReferenceResolver)
  }
  const agent = createFakeAgent(ctx, session, undefined, options.status)
  const selection: ModelSelectionRef = { current: initialTarget(agent), assembled: undefined }
  const controller = createTuiChat(ctx, Object.assign({
    sessionId,
    theme: { color: false },
  }, options.config), {
    terminal,
    exit,
    ...(options.runtime ?? {}),
  }, {
    agent,
    dispose: async () => {
      agent.disposed.push(true)
    },
  }, selection)
  return { ctx, session, agent, selection, terminal, exit, controller }
}

/** Dispose the mounted TUI before its owning Cordis context. */
export async function disposeTuiTestHarness(
  setup: Pick<TuiHarness<Terminal, (code: number) => void>, 'controller' | 'ctx' | 'agent' | 'session'>,
): Promise<void> {
  await setup.controller.dispose()
  await setup.ctx.fiber.dispose()
}

/** Append a production-shaped user message to the active session surface. */
export function appendUser(session: Session, text: string): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** Append a `step/start` lifecycle event to the active session surface. */
export function appendStepStart(session: Session, turn = 1, step = 1): void {
  session.append('step/start', { turn, step })
}

/** Append a `step/end` lifecycle event to the active session surface. */
export function appendStepEnd(session: Session, turn = 1, step = 1): void {
  session.append('step/end', { turn, step })
}

/** Append one raw text-delta chunk to the active session surface. */
export function appendChunk(session: Session, text: string, index = 0): void {
  session.append('assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index, text },
  })
}

/** Append a production-shaped assistant message to the active session surface. */
export function appendAssistant(
  session: Session,
  content: ContentBlock[],
  position: { turn: number; step: number } = { turn: 1, step: 1 },
): void {
  session.append('assistant/message', {
    ...position,
    message: createMessage({
      role: 'assistant',
      content,
      source: { kind: 'model', provider: 'mock', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
}

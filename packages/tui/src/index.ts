/**
 * Interactive pi-tui front door for DeepSeek Harness agents. It renders the
 * durable session transcript, drives one root agent, and owns the terminal
 * lifecycle: raw mode and the alternate screen are entered only after the
 * agent is ready, and every exit path releases the terminal before the
 * process ends.
 * @module @deepseek-ai/dsh-tui
 */

import {
  Container,
  Editor,
  Key,
  ProcessTerminal,
  Spacer,
  TUI,
  Text,
  matchesKey,
  sliceByColumn,
  visibleWidth,
  type Component,
  type EditorTheme,
} from '@earendil-works/pi-tui'
import type { Context } from '@deepseek-ai/cordis'
// Empty type imports carry the Context service merges this plugin's rows
// depend on, so the loader rejects a composition that misses them.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-reference'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { createUserMessage, errorChain, type MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { installModelSelection, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { SessionId, isReplacementSurfaceEvent, type SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import { parseSessionReferenceText } from '@deepseek-ai/dsh-session-reference'
import { Config, resolveTuiConfig } from './config.ts'
import { contentText, parseArguments } from './components/content.ts'
import { displayInlineText, displayText } from './components/text.ts'
import { createPalette, markdownTheme, selectTheme } from './components/theme.ts'
import {
  ContextCardComponent,
  HeaderComponent,
  StreamingAssistantComponent,
  ToolCardComponent,
  UserMessageComponent,
  type ToolCardVisibility,
} from './components/transcript.ts'
import {
  StatusCardComponent,
  compactTargetLabel,
  diagnosticMeter,
  formatDiagnosticCount,
  formatDiagnosticNumber,
  formatDiagnosticTime,
  initialTarget,
  targetLabel,
  type StatusCardRow,
} from './components/dialogs.ts'
import {
  StepTimingTracker,
  formatQueuedStatus,
  formatStatusDuration,
  openStepPhase,
  runningPhaseGlyph,
  type StepPosition,
} from './chat/timing.ts'
import { formatCwd, gitBranch, isCompactCheckpoint, sessionReferenceCard } from './chat/helpers.ts'
import { createQuestionQueue, type QuestionQueue } from './chat/questions.ts'
import { installApprovalAnswerer } from './chat/approval.ts'
import { createCommandController, goalStatusText, type CommandController } from './chat/commands.ts'
import { createModelController, type ModelController } from './chat/model-command.ts'
import { createResumeController, type ResumeController } from './chat/resume.ts'
import { WorkspaceFileSearch } from './chat/file-autocomplete.ts'
import { cacheHitRate, formatTokens, recordEventUsage, sessionTokens } from './chat/tokens.ts'
import { TuiExtensionServiceImpl, TuiOverlayManager } from './extension/overlay-manager.ts'
import type { TuiTheme } from './extension/types.ts'
import { TUI_STARTUP_SERVICE, type TuiRuntime } from './runtime.ts'

export { Config, type Config as TuiConfig, type TuiThemeConfig, type ResolvedTuiConfig } from './config.ts'
export { TUI_STARTUP_SERVICE, type TuiStartupValues, type TuiResumeHost, type TuiRuntime } from './runtime.ts'
export { displayText, displayInlineText, sanitizePastedText } from './components/text.ts'
export { TuiExtensionService, TuiExtensionServiceImpl } from './extension-service.ts'
export {
  HeaderComponent,
  UserMessageComponent,
  StreamingAssistantComponent,
  ToolCardComponent,
  ContextCardComponent,
  type ToolCardVisibility,
} from './components/transcript.ts'

/** Stable Cordis plugin name. */
export const name = 'tui'

/**
 * Core services required before the interactive session can be driven. Every
 * name is a base-layer row or a row the tui bundle inserts; the loader
 * rejects a composition that omits one.
 */
export const inject = [
  'agents',
  'sessions',
  'commands',
  'tools',
  'llm',
  'systemPrompt',
  'tokenMeter',
  'userQuestions',
  'approval',
  'sessionProjections',
  'sessionQuery',
  'sessionReferenceResolver',
]

/** Lifecycle handle for a mounted interactive terminal channel. */
export interface TuiController {
  /** Stop rendering, restore the terminal, and dispose the owned agent. */
  dispose(): Promise<void>
}

/**
 * Transcript row standing in for one compacted range. The conversation the
 * compaction replaced stays rendered above it: the marker reports where the
 * model stopped seeing that history, not that the history is gone.
 */
const COMPACTION_MARKER = '… earlier context was compacted …'

/** Width/height adapter for a modal component rendered inside the base TUI flow. */
class InlineModalComponent extends Container {
  constructor(
    component: Component,
    private readonly width: number,
    private readonly maxHeight: number,
  ) {
    super()
    this.addChild(component)
  }

  override render(width: number): string[] {
    const lines = super.render(Math.max(1, Math.min(width, this.width)))
    return lines.slice(0, Math.max(1, this.maxHeight))
  }
}

/**
 * Start the interactive pi-tui channel for an already-created target agent.
 * @param ctx - agent, session, and event context.
 * @param config - banner and TUI presentation config.
 * @param runtime - terminal and process-exit boundary.
 * @param handle - owned agent handle; disposed by this channel on shutdown.
 * @param selection - shared selected-model handle installed into the agent's
 *   prompt assembly by the caller's setup hook.
 * @returns lifecycle controller used by the Cordis effect disposer.
 */
export function createTuiChat(
  ctx: Context,
  config: Config,
  runtime: TuiRuntime,
  handle: AgentHandle,
  selection: ModelSelectionRef,
): TuiController {
  const agent = handle.agent
  const resolved = resolveTuiConfig(config)
  const palette = createPalette(resolved.theme.color)
  const mdTheme = markdownTheme(palette)
  const ui = new TUI(runtime.terminal, resolved.showHardwareCursor)
  const chat = new Container()
  const editor = new Editor(ui, {
    borderColor: palette.dim,
    selectList: selectTheme(palette),
  } satisfies EditorTheme, {
    paddingX: 1,
    frame: 'none',
    prompt: {
      first: displayInlineText('dsh > '),
      continuation: ' '.repeat(visibleWidth(displayInlineText('dsh > '))),
    },
  })
  const promptLine = new Text('', 0, 0)
  // Status footer: phase glyph, elapsed, queued steering, token buckets, KV
  // cache rate, context occupancy, model route, and tool-card mode, truncated
  // to the terminal width.
  const statusLine = new Text('', 0, 0)
  // Inline modal host: the question panel renders between the prompt line and
  // the editor, reserving the editor's rows while a question is active.
  const questionContainer = new Container()
  const cwd = agent.session.header.cwd ?? process.cwd()
  const formattedCwd = displayText(runtime.formatCwd?.(cwd) ?? cwd)
  // The Git branch resolves off the event loop; the first frame ships without
  // it and the prompt line fills in (one re-render) when the query settles.
  let branch: string | undefined
  const branchQuery = runtime.gitBranch?.(cwd)
  if (branchQuery !== undefined) {
    void branchQuery.then((value) => {
      if (disposed) return
      branch = value
      requestRender()
    })
  }
  // Bounded workspace index for @path completions; invalidated whenever a tool
  // result lands so new files become reachable without a restart.
  const fileSearch = new WorkspaceFileSearch(cwd, {
    maxResults: resolved.fileSearchMaxResults,
    maxEntries: resolved.fileSearchMaxEntries,
    excludedDirectories: resolved.fileSearchExcludedDirectories,
  })
  // Token buckets fold incrementally with the session log; the status footer
  // and /status diagnostics read them without replaying the log per render.
  const tokens = sessionTokens(agent.session)
  const referenceResolver = ctx.get('sessionReferenceResolver')
  // Steering submissions the inbox has not yet claimed or discarded.
  const pendingSteering = new Set<MessageId>()
  // Session ids referenced by submissions the inbox has not yet claimed or
  // discarded; a duplicate submission is rejected while one is in flight.
  const pendingReferenceIds = new Set<string>()
  const messageReferences = new Map<MessageId, string[]>()
  const referenceControllers = new Set<AbortController>()
  let runningSince: number | undefined
  // `updateStatusLine` (defined below) closes over the model controller, but
  // the controller needs `appendNotice`/`overlayManager`, defined after that
  // closure. Declare here, assign once after those exist, and defer the first
  // `updateStatusLine()` call until after the assignment.
  // oxlint-disable-next-line prefer-const -- assigned once after the model controller's dependencies exist (forward declaration)
  let modelController!: ModelController
  let disposed = false
  let shuttingDown: Promise<void> | undefined
  let showReasoning = resolved.showReasoning
  let toolsVisibility: ToolCardVisibility = 'collapsed'
  let streaming: StreamingAssistantComponent | undefined
  // One shared accumulator serves every step's timing footer; per-footer
  // replay of the whole log is quadratic on a long resumed session.
  const stepTimingTracker = new StepTimingTracker()
  // Assistant step components in model order per turn, for hidden-mode folding:
  // with tool cards hidden, a turn keeps one Assistant header and later steps
  // render as headerless continuations (see applyTurnFolding).
  const assistantSteps = new Map<number, StreamingAssistantComponent[]>()
  const toolCards = new Map<string, ToolCardComponent>()
  const allToolCards = new Set<ToolCardComponent>()
  const contextCards = new Set<ContextCardComponent>()

  const now = (): number => runtime.now?.() ?? Date.now()
  // The banner subtitle and terminal title follow the durable session title;
  // the configured title is the fallback until a title is logged.
  let sessionTitle = foldSessionTitle(agent.session.events)?.title
  const header = new HeaderComponent(
    agent,
    () => sessionTitle ?? config.welcome,
    palette,
    resolved.theme.color && resolved.theme.truecolor,
  )
  ui.addChild(header)
  ui.addChild(chat)
  ui.addChild(new Spacer(1))
  ui.addChild(promptLine)
  ui.addChild(statusLine)
  ui.addChild(questionContainer)
  ui.addChild(editor)
  ui.setFocus(editor)

  const updatePromptLine = (): void => {
    promptLine.setText(palette.dim(
      `${formattedCwd}${branch === undefined ? '' : ` (${displayText(branch)})`}  ${agent.status === 'running' ? 'running' : 'idle'}`,
    ))
  }
  updatePromptLine()

  const updateStatusLine = (): void => {
    const segments: string[] = []
    const running = agent.status === 'running'
    const glyph = runningPhaseGlyph(agent.session.events, running)
    if (glyph !== undefined) {
      const phase = openStepPhase(agent.session.events)
      segments.push(`${glyph} ${phase === undefined ? 'running' : phase}`)
    } else {
      segments.push('idle')
    }
    if (runningSince !== undefined) segments.push(formatStatusDuration(now() - runningSince))
    const queued = formatQueuedStatus(pendingSteering.size)
    if (queued !== undefined) segments.push(queued)
    const usage = `↑${formatTokens(tokens.input)} ↓${formatTokens(tokens.output)}`
    const rate = cacheHitRate(tokens)
    segments.push(rate === undefined ? usage : `${usage} · cache ${rate}%`)
    const contextWindow = modelController.contextWindow()
    const tokenMeter = ctx.get('tokenMeter')
    if (contextWindow !== undefined && tokenMeter !== undefined) {
      const used = Math.max(0, Math.round(tokenMeter.measure(agent.session).totalTokens))
      segments.push(`${Math.min(100, Math.round(used / contextWindow * 100))}% context`)
    }
    segments.push(`model ${selection.current === undefined ? 'unset' : compactTargetLabel(selection.current)}`)
    segments.push(`tools ${toolsVisibility}`)
    const composed = segments.join(' · ')
    const width = Math.max(1, runtime.terminal.columns)
    // Pure-text truncation: truncateToWidth appends an ANSI reset that
    // displayText would expand, blowing the width budget.
    statusLine.setText(palette.dim(displayText(
      visibleWidth(composed) <= width ? composed : `${sliceByColumn(composed, 0, Math.max(1, width - 1))}…`,
    )))
  }

  const updateTerminalTitle = (): void => {
    runtime.terminal.setTitle(displayText(
      sessionTitle === undefined ? resolved.title : `${sessionTitle} — ${resolved.title}`,
    ))
  }
  updateTerminalTitle()

  const requestRender = (): void => {
    if (disposed) return
    updatePromptLine()
    updateStatusLine()
    ui.invalidate()
    ui.requestRender()
  }

  // Resident-transcript accounting: rows are charged their text length and a
  // per-row overhead, cards a fixed charge. When the byte or card budgets
  // overflow, the oldest settled rows and cards evict from the component tree
  // so a long session never keeps the whole log resident. Defined before the
  // append helpers because the mount replay charges rows immediately.
  const residentOrder: Component[] = []
  const residentBytesBy = new Map<Component, number>()
  let residentBytes = 0

  const evictComponent = (component: Component): void => {
    if (component instanceof StreamingAssistantComponent) {
      // Every resident step is registered in the fold map and holds its
      // footer in the chat, so the guards below are defensive only.
      /* v8 ignore start -- resident steps are always registered with their footers attached */
      const steps = assistantSteps.get(component.position.turn)
      if (steps !== undefined) {
        const index = steps.indexOf(component)
        if (index >= 0) steps.splice(index, 1)
        if (steps.length === 0) assistantSteps.delete(component.position.turn)
      }
      const footerIndex = chat.children.indexOf(component.timing)
      if (footerIndex >= 0) chat.children.splice(footerIndex, 1)
      /* v8 ignore stop */
    } else if (component instanceof ToolCardComponent) {
      allToolCards.delete(component)
    } else if (component instanceof ContextCardComponent) {
      contextCards.delete(component)
    }
    const chatIndex = chat.children.indexOf(component)
    if (chatIndex >= 0) chat.children.splice(chatIndex, 1)
  }

  const evictResident = (): void => {
    while ((residentBytes > resolved.transcriptResidentMaxBytes || residentOrder.length > resolved.cardCacheEntries)
      && residentOrder.length > 0) {
      const oldest = residentOrder[0]
      /* v8 ignore next -- the loop guard guarantees a non-empty ledger */
      if (oldest === undefined) break
      const onlyChild = residentOrder.length === 1
      residentOrder.shift()
      // A live streaming step keeps its slot until it settles; the ledger
      // re-arms it at the tail so a later pass can evict it. With nothing
      // else resident there is nothing left to evict, so stop.
      if (oldest instanceof StreamingAssistantComponent && !oldest.isSettled()) {
        if (onlyChild) {
          residentOrder.unshift(oldest)
          break
        }
        residentOrder.push(oldest)
        continue
      }
      // Every evicted component carries its ledger charge.
      /* v8 ignore next -- accountResident always records the charge */
      residentBytes = Math.max(0, residentBytes - (residentBytesBy.get(oldest) ?? 0))
      residentBytesBy.delete(oldest)
      evictComponent(oldest)
    }
  }

  /** Charge one resident transcript row or card and enforce the budgets. */
  const accountResident = (component: Component, bytes: number): void => {
    residentOrder.push(component)
    residentBytesBy.set(component, bytes)
    residentBytes += bytes
    evictResident()
  }

  /** Release a component's resident charge when the channel removes it. */
  const releaseResident = (component: Component): void => {
    const ledgerIndex = residentOrder.indexOf(component)
    // Every removal path releases exactly the components it charged.
    /* v8 ignore next -- charged components are always present in the ledger */
    if (ledgerIndex < 0) return
    residentOrder.splice(ledgerIndex, 1)
    /* v8 ignore next -- accountResident always records the charge */
    residentBytes = Math.max(0, residentBytes - (residentBytesBy.get(component) ?? 0))
    residentBytesBy.delete(component)
  }

  /** Append a transcript notice row (info/warning/error tone). */
  const appendNotice = (message: string, kind: 'info' | 'warning' | 'error' = 'info'): void => {
    const color = kind === 'error' ? palette.error : kind === 'warning' ? palette.warning : palette.dim
    chat.addChild(new Spacer(1))
    chat.addChild(new Text(color(displayText(message)), 0, 0))
    requestRender()
  }

  const appendUser = (text: string): void => {
    chat.addChild(new Spacer(1))
    const row = new UserMessageComponent(text, palette, mdTheme)
    chat.addChild(row)
    accountResident(row, text.length + 64)
  }

  const appendContext = (label: string, text: string): void => {
    const card = new ContextCardComponent(label, text, resolved.maxToolOutputLines, palette)
    card.setExpanded(toolsVisibility === 'expanded')
    contextCards.add(card)
    chat.addChild(new Spacer(1))
    chat.addChild(card)
    accountResident(card, label.length + text.length + 64)
  }

  const renderCompactionMarker = (): void => {
    chat.addChild(new Spacer(1))
    chat.addChild(new Text(palette.dim(COMPACTION_MARKER), 0, 0))
  }

  /**
   * Re-derive hidden-mode folding for one turn: the first step with a visible
   * body owns the turn's single Assistant header, every other step renders as a
   * headerless continuation (empty ones render nothing). Any other visibility
   * restores the per-step headers.
   */
  const applyTurnFolding = (turn: number): void => {
    const steps = assistantSteps.get(turn)
    /* v8 ignore next -- every folding call site holds a registered step list for its turn. */
    if (steps === undefined) return
    let headerSeen = false
    for (const step of steps) {
      if (toolsVisibility !== 'hidden') {
        step.setFoldedContinuation(false)
      } else if (!headerSeen && step.hasVisibleBody()) {
        headerSeen = true
        step.setFoldedContinuation(false)
      } else {
        step.setFoldedContinuation(true)
      }
    }
  }

  const registerAssistantStep = (component: StreamingAssistantComponent): void => {
    const steps = assistantSteps.get(component.position.turn) ?? []
    steps.push(component)
    assistantSteps.set(component.position.turn, steps)
    applyTurnFolding(component.position.turn)
  }

  const removeStreaming = (current: StreamingAssistantComponent | undefined): void => {
    if (current === undefined) return
    releaseResident(current)
    for (const child of [current, current.timing]) {
      const index = chat.children.indexOf(child)
      /* v8 ignore next -- streaming components and their timing footers are retained only while attached to the chat. */
      if (index >= 0) chat.children.splice(index, 1)
    }
    const steps = assistantSteps.get(current.position.turn)
    /* v8 ignore next -- every attached streaming component is registered in the fold map. */
    if (steps === undefined) return
    const index = steps.indexOf(current)
    /* v8 ignore next -- registration precedes attachment, so the component is present until this removal. */
    if (index < 0) return
    steps.splice(index, 1)
    // A retracted step may have owned the turn's hidden-mode header.
    applyTurnFolding(current.position.turn)
  }

  const clearStreaming = (): void => {
    removeStreaming(streaming)
    streaming = undefined
  }

  const startAssistantStep = (position: StepPosition): void => {
    streaming = new StreamingAssistantComponent(
      position,
      () => agent.session.events,
      stepTimingTracker,
      now,
      showReasoning,
      palette,
      mdTheme,
    )
    registerAssistantStep(streaming)
    chat.addChild(streaming)
    chat.addChild(streaming.timing)
    // Steps charge a light overhead; their rendered content is bounded by the
    // step's own buffer and the resident card budget.
    accountResident(streaming, 64)
  }

  const parsedTool = (event: Extract<SessionEvent, { type: 'tool/call' }>): ToolCardComponent => {
    const parsed = parseArguments(event.data.arguments)
    const card = new ToolCardComponent(
      event.data.name,
      parsed,
      ctx.tools.get(event.data.name, agent),
      resolved.maxToolOutputLines,
      resolved.maxDiffEditLength,
      palette,
      mdTheme,
    )
    card.setVisibility(toolsVisibility)
    toolCards.set(event.data.callId, card)
    allToolCards.add(card)
    accountResident(card, 512)
    return card
  }

  /**
   * Render one session event; returns whether it changed the visible chat so
   * the caller can skip a pointless render pass (the TUI emits no frame for an
   * unchanged view, and the frame waiter would stall on it).
   */
  const renderEvent = (event: SessionEvent, renderChunks: boolean): boolean => {
    switch (event.type) {
      case 'user/message': {
        const source = event.data.source
        if (source.kind === 'user') {
          const text = displayText(contentText(event.data.content).trim())
          if (!text) return false
          appendUser(text)
          return true
        }
        // A session-reference card names the referenced sessions on one dim
        // row instead of dumping the snapshot body.
        const references = sessionReferenceCard(source)
        if (references !== undefined) {
          chat.addChild(new Text(
            palette.dim(`Referenced sessions · ${references.map(displayText).join(', ')}`),
            0,
            0,
          ))
          return true
        }
        // Injected context (plugin/goal source) renders as a dim context card,
        // not a human bubble.
        const text = contentText(event.data.content).trim()
        if (!text) return false
        const labelled = source as { kind?: unknown; plugin?: unknown }
        const label = typeof labelled.plugin === 'string' ? labelled.plugin
          : typeof labelled.kind === 'string' ? labelled.kind
            : 'context'
        appendContext(label, text)
        return true
      }
      case 'step/start':
        startAssistantStep(event.data)
        return true
      case 'assistant/chunk':
        // Late chunks of a closed step have no live component to absorb them.
        if (!renderChunks || streaming === undefined) return false
        streaming.update(event.data.chunk)
        applyTurnFolding(streaming.position.turn)
        return true
      case 'assistant/message':
        // A settled component stays attached but never absorbs a later message
        // of the same step; both the live and replay paths start a new one.
        if (streaming === undefined || streaming.isSettled() || !chat.children.includes(streaming)) startAssistantStep(event.data)
        /* v8 ignore next -- startAssistantStep always assigns, so the settled component is present here. */
        if (streaming !== undefined) {
          streaming.settle(event.data.message.content)
          applyTurnFolding(streaming.position.turn)
        }
        return true
      case 'step/end':
        if (streaming === undefined) startAssistantStep(event.data)
        streaming?.complete(event.time)
        streaming = undefined
        return true
      case 'tool/call':
        chat.addChild(parsedTool(event))
        return true
      case 'tool/result': {
        const callId = event.data.message.source.callId
        let card = toolCards.get(callId)
        if (card === undefined) {
          card = new ToolCardComponent('tool', { value: {}, valid: true }, undefined,
            resolved.maxToolOutputLines, resolved.maxDiffEditLength, palette, mdTheme)
          card.setVisibility(toolsVisibility)
          chat.addChild(card)
          allToolCards.add(card)
          accountResident(card, 512)
        }
        card.updateResult(event.data)
        toolCards.delete(callId)
        return true
      }
      case 'turn/end': {
        clearStreaming()
        const reason = event.data.reason
        switch (reason.kind) {
          case 'completed':
            break
          case 'error': {
            appendNotice(reason.error.message, 'error')
            break
          }
          case 'aborted':
            appendNotice('Turn cancelled.', 'warning')
            break
          case 'max-tokens':
            appendNotice('The model reached its output-token limit.', 'warning')
            break
          case 'interrupted':
            appendNotice('The previous process ended during this turn.', 'warning')
            break
          default:
            // TurnEndReasonMap is merge-extensible: a plugin-added outcome
            // still names why the agent stopped rather than ending silently.
            appendNotice(`Turn ended: ${(reason as { kind: string }).kind}.`, 'warning')
            break
        }
        return true
      }
      default:
        return false
    }
  }

  // The session/event firehose is scope-filtered by session; a channel
  // mounted for one agent only renders its own session's events.
  const disposeSessionEvents = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    // Tool results can materialize new files, so the @path index refreshes
    // after one lands.
    if (event.type === 'tool/result') fileSearch.invalidate()
    recordEventUsage(tokens, event)
    if (event.type === 'session/title') {
      sessionTitle = event.data.title
      header.invalidate()
      updateTerminalTitle()
    }
    // Replacement events mutate only the model surface, so the rendered
    // transcript keeps what it already showed; a landed summary checkpoint
    // adds its marker.
    if (isReplacementSurfaceEvent(event)) {
      if (isCompactCheckpoint(event)) {
        renderCompactionMarker()
        requestRender()
      }
      return
    }
    if (renderEvent(event, true)) requestRender()
  })

  // Mount replays only the most recent window of the durable log so
  // startup-to-prompt-ready stays proportional to the visible window, not the
  // whole log; earlier history loads on demand through /more or PageUp.
  let replayCursor = mountWindowStart(agent.session.events, resolved.maxInitialMessages)
  for (let index = replayCursor; index < agent.session.events.length; index += 1) {
    renderEvent(agent.session.events[index] as SessionEvent, false)
  }

  /**
   * Deliver one user turn to the agent: inject any attached snapshot into the
   * pre-step queue, then steer while running or follow up while idle. Returns
   * the message id so callers can track steering and reference claims.
   * @param text - readable message content.
   * @param attachedContext - optional referenced-session snapshot queued before the message.
   * @returns the submitted message id.
   */
  const dispatchMessage = (text: string, attachedContext?: UserMessage): MessageId => {
    const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    if (attachedContext !== undefined) agent.inject(attachedContext)
    if (agent.status === 'running') {
      agent.steer(message)
      pendingSteering.add(message.id)
    } else {
      agent.followup(message)
    }
    // The queued-steering badge changed with the submission.
    requestRender()
    return message.id
  }

  /** Load one earlier history page into the transcript head; false at the start. */
  const loadHistory = (): boolean => {
    // The message walk below also reports the fully-loaded state, so this
    // guard is defensive for a cursor that never lands below the first turn.
    /* v8 ignore next -- the walk's zero-message check reports the start */
    if (replayCursor <= 0) return false
    const events = agent.session.events
    // Walk back `historyPageSize` user messages so one page reads as complete
    // exchanges rather than a fixed event count.
    let pageStart = Math.max(0, replayCursor - 1)
    let messages = 0
    for (let index = replayCursor - 1; index >= 0 && messages < resolved.historyPageSize; index -= 1) {
      const event = events[index] as SessionEvent
      if (event.type === 'user/message' && event.data.source.kind === 'user') {
        messages += 1
        pageStart = index
      }
    }
    // No earlier user message exists: the transcript is fully loaded.
    if (messages === 0) return false
    const ledgerBefore = residentOrder.length
    for (let index = pageStart; index < replayCursor; index += 1) {
      renderEvent(events[index] as SessionEvent, false)
    }
    const moved = residentOrder.splice(ledgerBefore)
    // The ledger must match the visual head-first order so eviction removes
    // the oldest history first.
    residentOrder.unshift(...moved)
    replayCursor = pageStart
    requestRender()
    return true
  }

  const setToolsVisibility = (visibility: ToolCardVisibility): void => {
    toolsVisibility = visibility
    for (const card of allToolCards) card.setVisibility(visibility)
    for (const card of contextCards) card.setExpanded(visibility === 'expanded')
    for (const steps of assistantSteps.values()) {
      for (const step of steps) applyTurnFolding(step.position.turn)
    }
  }

  const toggleTools = (): void => {
    setToolsVisibility(
      toolsVisibility === 'collapsed' ? 'expanded' : toolsVisibility === 'expanded' ? 'hidden' : 'collapsed',
    )
  }

  const setShowReasoning = (show: boolean): void => {
    showReasoning = show
    const set = (step: StreamingAssistantComponent): void => { step.setShowReasoning(showReasoning) }
    for (const steps of assistantSteps.values()) for (const step of steps) set(step)
    streaming?.setShowReasoning(showReasoning)
  }

  const toggleReasoning = (): void => {
    setShowReasoning(!showReasoning)
  }

  editor.onSubmit = (text: string): void => {
    const value = text.trim()
    if (value === '') return
    editor.addToHistory(text)
    editor.setText('')
    // Slash lines route through the command registry; anything else goes to
    // the agent. The registry's own handlers own /exit, /quit, and /clear.
    if (commands.runCommand(value)) return
    let parsed: ReturnType<typeof parseSessionReferenceText>
    try {
      parsed = parseSessionReferenceText(value)
    } catch (error: unknown) {
      editor.setText(value)
      appendNotice(`Invalid session reference: ${errorChain(error)}`, 'error')
      return
    }
    if (parsed.references.length === 0) {
      dispatchMessage(parsed.text)
      return
    }
    if (referenceResolver === undefined) {
      editor.setText(value)
      appendNotice('Session reference capability unavailable.', 'error')
      return
    }
    const duplicate = parsed.references.find(reference => pendingReferenceIds.has(reference.sessionId))
    if (duplicate !== undefined) {
      editor.setText(value)
      appendNotice(`Session "${displayText(duplicate.sessionId)}" is already referenced by a pending submission.`, 'warning')
      return
    }
    // Reserve the references before the async prepare so a second
    // submission naming one of them is rejected while this one is in flight;
    // a failed or cancelled prepare releases the reservation so retries work.
    const refs = parsed.references.map(reference => reference.sessionId)
    for (const sessionId of refs) pendingReferenceIds.add(sessionId)
    const controller = new AbortController()
    referenceControllers.add(controller)
    void referenceResolver.prepare(
      agent,
      [{ type: 'text', text: parsed.text }],
      parsed.references,
      controller.signal,
    ).then((prepared) => {
      if (disposed) return
      const id = dispatchMessage(parsed.text, prepared.additionalContext)
      messageReferences.set(id, refs)
      requestRender()
    }, (error: unknown) => {
      for (const sessionId of refs) pendingReferenceIds.delete(sessionId)
      if (!disposed && !controller.signal.aborted) {
        editor.setText(value)
        appendNotice(`Session reference failed: ${errorChain(error)}`, 'error')
      }
    }).finally(() => {
      referenceControllers.delete(controller)
    })
  }

  const removeInputListener = ui.addInputListener((data) => {
    // A modal owns the keyboard while it is active: every global shortcut
    // (Ctrl+O/Ctrl+R/Esc/Ctrl+C/Ctrl+D) yields to the focused overlay so its
    // own keys — including an approval dialog's Ctrl+C withdrawal — land.
    if (overlayManager.hasActiveOverlay()) return undefined
    // Consumed keys skip the editor, so the channel must re-render the state
    // its own action changed (the loop publishes `agent/status` separately).
    if (matchesKey(data, Key.ctrl('o'))) {
      toggleTools()
      requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('r'))) {
      toggleReasoning()
      requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.pageUp)) {
      loadHistory()
      requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.escape) && agent.status === 'running') {
      agent.cancel({ kind: 'user' })
      requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('c'))) {
      if (agent.status === 'running') {
        agent.cancel({ kind: 'user' })
      } else if (editor.getText() !== '') {
        editor.setText('')
      } else {
        requestExit()
      }
      requestRender()
      return { consume: true }
    }
    if (matchesKey(data, Key.ctrl('d'))) {
      requestExit()
      return { consume: true }
    }
    return undefined
  })

  // The footer's elapsed clock ticks on the status interval while running so
  // a long turn stays live; the timer is owned and stopped with the channel.
  let statusTimer: ReturnType<typeof setInterval> | undefined
  const startStatusTimer = (): void => {
    if (statusTimer !== undefined) return
    statusTimer = setInterval(() => { requestRender() }, resolved.statusIntervalMs)
  }
  const stopStatusTimer = (): void => {
    if (statusTimer === undefined) return
    clearInterval(statusTimer)
    statusTimer = undefined
  }

  const disposeStatus = ctx.on('agent/status', ({ agent: subject, status }) => {
    if (subject !== agent) return
    runtime.terminal.setProgress(status === 'running')
    if (status === 'running') {
      if (runningSince === undefined) runningSince = now()
      startStatusTimer()
    } else {
      // A settled turn consumed or discarded everything it claimed; steering
      // left over from a cancelled run is gone with the aborted activity.
      runningSince = undefined
      pendingSteering.clear()
      stopStatusTimer()
    }
    requestRender()
  })

  /** Drop a message's steering and reference claims once the inbox settles them. */
  const releaseReferences = (messageId: MessageId): void => {
    pendingSteering.delete(messageId)
    const refs = messageReferences.get(messageId)
    if (refs === undefined) return
    messageReferences.delete(messageId)
    for (const sessionId of refs) pendingReferenceIds.delete(sessionId)
  }
  const disposeInboxClaimed = ctx.on('agent/inbox/claimed', ({ agent: subject, message }) => {
    if (subject !== agent) return
    releaseReferences(message.id)
    requestRender()
  })
  const disposeInboxDiscarded = ctx.on('agent/inbox/discarded', ({ agent: subject, message }) => {
    if (subject !== agent) return
    releaseReferences(message.id)
    requestRender()
  })

  const shutdown = (exitProcess: boolean): Promise<void> => {
    shuttingDown ??= (async () => {
      disposed = true
      // Reject new overlay work first, then close dependent extension fibers
      // (their overlay sessions settle owner-disposed) before the terminal
      // stops.
      overlayManager.beginShutdown()
      disposeSessionEvents()
      removeInputListener()
      stopStatusTimer()
      disposeStatus()
      disposeInboxClaimed()
      disposeInboxDiscarded()
      disposeGoalStatus()
      for (const controller of referenceControllers) controller.abort(new Error('TUI disposed'))
      referenceControllers.clear()
      modelController.resetContextResolution()
      modelController.clearOverlay()
      modelController.detach()
      await commands.dispose()
      fileSearch.dispose()
      disposeApproval()
      // Cancel any active turn and wait for quiescence before tearing down:
      // an aborted request must settle before its session is flushed.
      if (agent.status === 'running') agent.cancel({ kind: 'user' })
      await agent.whenIdle()
      await ctx.sessions.flush(agent.session)
      questions.rejectAll()
      await overlayManager.dispose()
      questions.unregister()
      await handle.dispose()
      // Drain queued input, then release the terminal: raw mode, alternate
      // screen, and cursor are restored before any exit line is printed.
      await runtime.terminal.drainInput(100, 20)
      ui.stop()
      if (exitProcess) {
        if (runtime.goodbyeMessage !== undefined) {
          runtime.terminal.write(`${palette.dim(displayText(runtime.goodbyeMessage))}\n`)
        }
        runtime.exit(0)
      }
    })()
    return shuttingDown
  }

  const requestExit = (): void => {
    if (agent.status === 'running') {
      agent.cancel({ kind: 'user' })
      void agent.whenIdle().then(() => void shutdown(true))
      return
    }
    void shutdown(true)
  }

  // The semantic theme facade handed to extension overlays; it follows the
  // channel's palette so both surfaces stay one tone.
  const extensionTheme: TuiTheme = Object.freeze({
    text: (value: string) => palette.text(value),
    brand: (value: string) => palette.brand(value),
    dim: (value: string) => palette.dim(value),
    accent: (value: string) => palette.accent(value),
    success: (value: string) => palette.success(value),
    warning: (value: string) => palette.warning(value),
    error: (value: string) => palette.error(value),
    bold: (value: string) => palette.bold(value),
  })
  const overlayManager = new TuiOverlayManager({
    viewport: () => Object.freeze({
      columns: runtime.terminal.columns,
      rows: runtime.terminal.rows,
    }),
    theme: () => extensionTheme,
    display: displayText,
    show: (component, options, placement) => {
      if (placement === 'overlay') {
        return ui.showOverlay(component, options === undefined
          ? undefined
          : {
            ...options,
            ...typeof options.margin === 'object'
              ? { margin: { ...options.margin } }
              : {},
          })
      }
      const modal = new InlineModalComponent(
        component,
        resolved.questionDialogWidth,
        resolved.questionDialogMaxHeight,
      )
      questionContainer.clear()
      questionContainer.addChild(modal)
      ui.setFocus(component)
      return {
        hide(): void {
          questionContainer.clear()
          ui.setFocus(editor)
        },
      }
    },
    invalidate: requestRender,
    reportError: (error) => {
      const message = errorChain(error)
      ctx.logger.warn(`tui: overlay failed: ${message}`)
      /* v8 ignore next -- shutdown removes overlays before the terminal stops */
      if (disposed) return
      appendNotice(`TUI overlay failed: ${message}`, 'error')
    },
  })

  // The model controller owns the /model selector and the context-window
  // cache the status footer reads; its first render happens only after this
  // assignment (see the forward declaration above).
  modelController = createModelController({
    ctx,
    resolved,
    palette,
    overlayManager,
    selection,
    appendNotice,
    requestRender,
    isDisposed: () => disposed,
  })
  // The /status card renders one point-in-time diagnostic snapshot: session
  // identity, agent progress, token buckets with cache rate, context
  // occupancy, and activity timestamps.
  const showStatusCard = (): void => {
    const events = agent.session.events
    const turns = events.filter(event => event.type === 'turn/start').length
    const steps = events.filter(event => event.type === 'step/start').length
    const toolCalls = events.filter(event => event.type === 'tool/call').length
    const tokenMeter = ctx.get('tokenMeter')
    const usedContext = tokenMeter === undefined
      ? 0
      : Math.max(0, Math.round(tokenMeter.measure(agent.session).totalTokens))
    let context = `${formatDiagnosticNumber(usedContext)} used · capacity unknown`
    const contextWindow = modelController.contextWindow()
    if (contextWindow !== undefined) {
      const contextPercent = Math.min(100, Math.round(usedContext / contextWindow * 100))
      context = `${diagnosticMeter(contextPercent, palette)} ${String(contextPercent)}% used (${formatDiagnosticNumber(usedContext)} / ${formatDiagnosticNumber(contextWindow)})`
    }
    const rate = cacheHitRate(tokens)
    const selected = selection.current
    const model = selected === undefined ? 'unset' : displayText(targetLabel(selected))
    const effort = selected === undefined
      ? 'unset'
      : selected.reasoningEffort === undefined
        ? 'default'
        : displayText(selected.reasoningEffort)
    const groups: readonly (readonly StatusCardRow[])[] = [
      [
        ['Session', displayText(agent.session.id)],
        ['Title', displayText(sessionTitle ?? 'untitled')],
        ['Directory', displayText(cwd)],
        ['Model', `${model} ${palette.dim(`(effort ${effort}; reasoning blocks ${showReasoning ? 'shown' : 'hidden'})`)}`],
      ],
      [
        ['Agent', [
          agent.status,
          formatDiagnosticCount(events.length, 'event'),
          formatDiagnosticCount(turns, 'turn'),
          formatDiagnosticCount(steps, 'step'),
          formatDiagnosticCount(toolCalls, 'tool call'),
        ].join(' · ')],
      ],
      [
        ['Tokens', `${formatDiagnosticNumber(tokens.input)} input + ${formatDiagnosticNumber(tokens.output)} output`],
        ['KV cache', rate === undefined
          ? `n/a (${formatDiagnosticNumber(tokens.cacheRead)} read + ${formatDiagnosticNumber(tokens.cacheWrite)} write)`
          : `${diagnosticMeter(rate, palette)} ${String(rate)}% hit (${formatDiagnosticNumber(tokens.cacheRead)} read + ${formatDiagnosticNumber(tokens.cacheWrite)} write)`],
        ['Context', context],
      ],
      [
        ['Created', formatDiagnosticTime(agent.session.header.createdAt)],
        // The command runtime logs its own command/run event before the
        // handler runs, so the fallback is unreachable from /status.
        /* v8 ignore start -- the command/run event precedes every /status render */
        ['Active', formatDiagnosticTime(events.at(-1)?.time ?? agent.session.header.createdAt)],
        /* v8 ignore stop */
      ],
    ]
    chat.addChild(new Spacer(1))
    chat.addChild(new StatusCardComponent(groups, palette))
    requestRender()
  }

  const resume: ResumeController = createResumeController({
    ctx,
    resolved,
    palette,
    overlayManager,
    agent,
    runtime,
    sessionQuery: () => ctx.get('sessionQuery'),
    appendNotice,
    requestRender,
    isDisposed: () => disposed,
    releaseTerminal: async () => {
      await runtime.terminal.drainInput(100, 20)
      ui.stop()
    },
    reacquireTerminal: () => {
      ui.start()
      ui.setFocus(editor)
    },
  })
  const questions: QuestionQueue = createQuestionQueue({
    ctx,
    resolved,
    palette,
    overlayManager,
    // The dialog compacts to the inline panel's clip height, so its pager
    // and controls are never cut off by the mount.
    questionMaxHeight: () => Math.max(1, Math.min(resolved.questionDialogMaxHeight, runtime.terminal.rows - 4)),
    requestRender,
    isDisposed: () => disposed,
  })
  const disposeApproval = installApprovalAnswerer({
    ctx,
    agent,
    palette,
    overlayManager,
    isDisposed: () => disposed,
  })
  const commands: CommandController = createCommandController({
    ctx,
    agent,
    palette,
    color: resolved.theme.color,
    editor,
    cwd,
    fileSearch,
    referenceResolver,
    queueModelCommand: (raw) => { modelController.queueModelCommand(raw) },
    showResume: () => { resume.showResume() },
    showStatusCard,
    loadHistory,
    appendNotice,
    requestRender,
    isDisposed: () => disposed,
    requestExit,
    clearChat: () => {
      // /clear empties the view and its resident ledger together.
      residentOrder.length = 0
      residentBytesBy.clear()
      residentBytes = 0
      assistantSteps.clear()
      allToolCards.clear()
      contextCards.clear()
      toolCards.clear()
      streaming = undefined
      chat.clear()
    },
    setToolsVisibility,
    setShowReasoning,
  })
  // The goal status row follows the projection change feed: the durable phase
  // and round counters plus the process-local activation.
  const renderGoalStatus = (): void => {
    const status = goalStatusText(ctx, agent)
    if (status !== undefined) appendNotice(status, 'info')
  }
  const disposeGoalStatus = ctx.sessionProjections.onChanged((session, key) => {
    if (session !== agent.session || key !== 'goal') return
    renderGoalStatus()
  })
  renderGoalStatus()
  // The extension service registers on the plugin context, so any plugin
  // below the mounted TUI resolves `ctx.tui`; unloading the plugin removes it.
  // Each openOverlay effect rides the CALLER's fiber, so disposing a caller
  // settles its overlays owner-disposed before the terminal stops.
  new TuiExtensionServiceImpl(ctx, agent, overlayManager)

  // Enter raw mode, the alternate screen, and the first render only after
  // every listener is attached, so no event can race the mount.
  ui.start()

  return {
    dispose: () => shutdown(false),
  }
}

/**
 * Create or resume the root agent this terminal drives, then mount the
 * interactive channel as an effect-owned child of the plugin fiber.
 * @param ctx - plugin context carrying the agent registry and startup values.
 * @param config - validated terminal config, including launcher identity.
 * @param runtime - terminal and process-exit boundary.
 */
export function mountTui(ctx: Context, config: Config, runtime: TuiRuntime): void {
  void run(ctx, config, runtime).catch((error: unknown) => {
    // A startup failure must surface before the screen is taken over: report
    // it and exit without ever mounting the terminal.
    runtime.terminal.write(displayText(`tui: failed to start: ${errorChain(error)}\n`))
    runtime.exit(1)
  })
}

/** Parse `provider/model` from the launcher flag; absent keeps the session default. */
function parseModelRoute(value: string | undefined): { provider: string; model: string } | undefined {
  if (value === undefined) return undefined
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return undefined
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) }
}

async function run(ctx: Context, config: Config, runtime: TuiRuntime): Promise<void> {
  const startup = ctx.get(TUI_STARTUP_SERVICE)
  const route = parseModelRoute(config.model)
  const agentOptions = route === undefined ? undefined : { provider: route.provider, model: route.model }
  // The mutable selection is shared between the channel and the agent's
  // prompt assembly: /model writes it here, the setup hook's listeners apply
  // it atomically at each step boundary.
  const modelSelection: ModelSelectionRef = { current: undefined, assembled: undefined }
  const installSelection = (agentCtx: Context): void => {
    installModelSelection(agentCtx, modelSelection)
  }
  const handle = startup?.resumeSessionId !== undefined
    ? await ctx.agents.resume({
      resumeSessionId: SessionId(startup.resumeSessionId),
      ...(agentOptions === undefined ? {} : { agentOptions }),
      setup: installSelection,
    })
    : await ctx.agents.create({
      sessionId: SessionId(config.sessionId ?? 'main'),
      meta: { cwd: process.cwd() },
      ...(agentOptions === undefined ? {} : { agentOptions }),
      setup: installSelection,
    })
  // The logged request header wins over the invocation route; both are only
  // the starting point the selector can change.
  modelSelection.current = initialTarget(handle.agent)
  ctx.effect(() => {
    const controller = createTuiChat(ctx, config, runtime, handle, modelSelection)
    return () => controller.dispose()
  }, 'tui')
}

/**
 * The event index at which a mount replay begins: the initial window holds the
 * most recent `maxInitialMessages` user messages, aligned back to the nearest
 * open turn or title boundary so lifecycle state replays consistently.
 * @param events - The durable session log.
 * @param maxInitialMessages - User messages retained in the initial window.
 * @returns The replay start index.
 */
export function mountWindowStart(events: readonly SessionEvent[], maxInitialMessages: number): number {
  let messages = 0
  let start = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type !== 'user/message') continue
    const source = event.data.source
    if (source.kind !== 'user') continue
    messages += 1
    if (messages >= maxInitialMessages) {
      start = index
      break
    }
  }
  if (start > 0) {
    for (let index = start - 1; index >= 0; index -= 1) {
      const event = events[index] as SessionEvent
      if (event.type === 'turn/start' || event.type === 'session/title') return index
    }
  }
  return start
}

const ROOT_DISPOSE_TIMEOUT_MS = 5_000

/**
 * Dispose the whole application before process exit, with a bounded fallback.
 * @param ctx - The TUI plugin context whose root owns sibling resources.
 * @param code - Process status to report.
 * @param exit - Exit boundary, replaceable by tests.
 */
export function disposeRootAndExit(
  ctx: Context,
  code: number,
  exit: (status: number) => void,
): void {
  let exited = false
  const exitOnce = (): void => {
    // The timeout and the disposal race to report the code once; the guard
    // fires only when the disposal outlives the bounded fallback.
    /* v8 ignore next -- disposal always settles before the timeout in tests */
    if (exited) return
    exited = true
    exit(code)
  }
  const timeout = setTimeout(exitOnce, ROOT_DISPOSE_TIMEOUT_MS)
  void ctx.root.fiber.dispose().then(
    () => { clearTimeout(timeout); exitOnce() },
    // A failed disposal still reports the code once instead of hanging.
    /* v8 ignore next 3 -- a disposal rejection cannot be forced through the public API */
    () => { clearTimeout(timeout); exitOnce() },
  )
}

/**
 * Cordis entry point using the process terminal; explicit TUI composition
 * requires a TTY pair, so a piped invocation fails loud before any terminal
 * takeover.
 * @param ctx - plugin context carrying core services and launcher values.
 * @param config - validated terminal config.
 */
/* v8 ignore start -- production process wiring; fake-terminal tests cover mountTui/createTuiChat,
   and the PTY smokes cover the real entry */
export function apply(ctx: Context, config: Config): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('tui: both stdin and stdout must be TTYs; use the one-shot headless profile for pipes')
  }
  // Truecolor is a terminal capability, so detect it here at the process
  // boundary from COLORTERM; an explicit theme value still wins.
  const truecolor = config.theme?.truecolor ?? ['truecolor', '24bit'].includes(process.env.COLORTERM ?? '')
  mountTui(ctx, {
    ...config,
    theme: { ...config.theme, truecolor },
  }, {
    terminal: new ProcessTerminal(),
    exit: (code) => { disposeRootAndExit(ctx, code, (status) => { process.exit(status) }) },
    // Production defaults for the prompt-context overrides: `~`-abbreviated
    // cwd and the async Git branch probe from the chat helpers.
    formatCwd,
    gitBranch,
  })
}
/* v8 ignore stop */

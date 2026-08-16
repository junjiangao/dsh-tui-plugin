/**
 * Slash-command surface for the interactive chat channel: agent-scoped
 * terminal commands registered through the command registry, the dispatch
 * that routes editor lines to `ctx.commands.execute`, command discovery for
 * the editor autocomplete, and the goal status line driven by the projection
 * change feed.
 * @module @deepseek-ai/dsh-tui/chat/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import { CombinedAutocompleteProvider, type Editor } from '@earendil-works/pi-tui'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { SessionReferenceResolver } from '@deepseek-ai/dsh-session-reference'
import { renderPalette, type Palette } from '../components/theme.ts'
import type { ToolCardVisibility } from '../components/transcript.ts'
import { ReferenceAutocompleteProvider } from './autocomplete.ts'
import type { WorkspaceFileSearch } from './file-autocomplete.ts'

/** Collaborators the command surface needs from the chat channel. */
export interface CommandControllerDeps {
  readonly ctx: Context
  /** Exact root agent whose keyboard this terminal owns. */
  readonly agent: Agent
  readonly palette: Palette
  /** Whether the channel applies palette escapes (the resolved theme flag). */
  readonly color: boolean
  readonly editor: Editor
  /** Working directory shown to the autocomplete file search. */
  readonly cwd: string
  /** Bounded workspace index behind `@path` completions; invalidated on tool results. */
  readonly fileSearch: WorkspaceFileSearch
  /** Optional session-reference resolver behind `@session` completions. */
  readonly referenceResolver: SessionReferenceResolver | undefined
  /** Queue a `/model` line for the model controller. */
  queueModelCommand(raw: string): void
  /** Open the `/resume` session picker. */
  showResume(): void
  /** Append the session-status diagnostic card to the transcript. */
  showStatusCard(): void
  /** Load one earlier history page into the transcript head; false at the start. */
  loadHistory(): boolean
  appendNotice(message: string, kind: 'info' | 'warning' | 'error'): void
  requestRender(): void
  isDisposed(): boolean
  requestExit(): void
  clearChat(): void
  setToolsVisibility(visibility: ToolCardVisibility): void
  setShowReasoning(show: boolean): void
}

/** The slash-command surface owned by one chat channel. */
export interface CommandController {
  /**
   * Dispatch one editor line through the command registry when it is a slash
   * command.
   * @param text - the complete submitted line.
   * @returns whether the line was consumed as a command.
   */
  runCommand(text: string): boolean
  /** Dispose the scoped command registrations and abort in-flight handlers. */
  dispose(): Promise<void>
}

/**
 * The one goal status row appended when the projection changes: the durable
 * phase and round counters plus the process-local activation.
 * @param ctx - plugin context; optional services make the row absent.
 * @param agent - exact driven agent.
 * @returns the row text, or `undefined` when no goal is current.
 */
export function goalStatusText(ctx: Context, agent: Agent): string | undefined {
  // The goal unit registers with the projection registry when the goal
  // domain composes; without the unit the value is absent.
  const goal = ctx.sessionProjections.snapshot(agent.session).values['goal']
  if (goal === undefined || goal === null) return undefined
  const goals = ctx.get('goals')
  // The goal service and its projection unit register together, so a unit
  // without a live activation cannot occur in a composed deployment.
  const activation = goals?.get(agent)?.activation
  /* v8 ignore next -- goals and the goal unit compose as one package. */
  return `goal: ${goal.goal.phase} · ${goal.roundsStarted}/${goal.goal.maxGoalRounds}`
    + (activation === undefined ? '' : ` · ${activation}`)
}

/**
 * Build the slash-command surface for one chat channel.
 * @param deps - channel collaborators.
 * @returns the controller used at shutdown to dispose and to dispatch lines.
 */
export function createCommandController(deps: CommandControllerDeps): CommandController {
  const { ctx, agent, palette } = deps
  const controllers = new Set<AbortController>()

  const showHelp = (): void => {
    const commandLines = ctx.commands.list(agent).map((command) => {
      const input = command.input === undefined ? '' : ` ${command.input.hint}`
      return `/${command.name}${input} — ${command.description}`
    })
    deps.appendNotice([
      'Keyboard shortcuts',
      'Enter send • Up/Down prompt history • Esc cancel turn',
      'Ctrl+O cycle cards (collapse/expand/hide) • Ctrl+R toggle reasoning • Ctrl+D exit',
      '',
      ...commandLines,
    ].join('\n'), 'info')
  }

  const showPalette = (): void => {
    deps.appendNotice(renderPalette(palette, 'dark', deps.color).join('\n'), 'info')
  }

  const runDetails = (rawInput: string): CommandResult => {
    const tokens = rawInput.trim().split(/\s+/u).filter(token => token !== '')
    let visibility: ToolCardVisibility | undefined
    let reasoning: boolean | undefined
    for (const token of tokens) {
      if (token === 'collapsed' || token === 'expanded' || token === 'hidden') {
        if (visibility !== undefined) {
          return { kind: 'error', text: `Duplicate visibility "${token}". Usage: /details [collapsed|expanded|hidden] [reasoning [on|off]]` }
        }
        visibility = token
      } else if (token === 'reasoning') {
        if (reasoning !== undefined) {
          return { kind: 'error', text: 'Duplicate reasoning keyword. Usage: /details [collapsed|expanded|hidden] [reasoning [on|off]]' }
        }
        reasoning = true
      } else if (token === 'on' || token === 'off') {
        if (reasoning === undefined) {
          return { kind: 'error', text: `Reasoning state "${token}" requires the reasoning keyword. Usage: /details [collapsed|expanded|hidden] [reasoning [on|off]]` }
        }
        reasoning = token === 'on'
      } else {
        return { kind: 'error', text: `Unknown /details argument "${token}". Usage: /details [collapsed|expanded|hidden] [reasoning [on|off]]` }
      }
    }
    // Reasoning first: its transcript rebuild would drop the visibility notice.
    if (reasoning !== undefined) deps.setShowReasoning(reasoning)
    if (visibility !== undefined) deps.setToolsVisibility(visibility)
    return { kind: 'success' }
  }

  const refreshAutocomplete = (): void => {
    const base = new CombinedAutocompleteProvider(
      ctx.commands.list(agent).map(command => ({
        name: command.name,
        description: command.description,
        ...(command.input === undefined ? {} : { argumentHint: command.input.hint }),
      })),
      deps.cwd,
      null,
    )
    deps.editor.setAutocompleteProvider(new ReferenceAutocompleteProvider(
      base,
      deps.fileSearch,
      deps.referenceResolver,
      agent,
    ))
  }
  const disposeCommandChanges = ctx.on('commands/change', refreshAutocomplete)
  refreshAutocomplete()

  // The agent scope is minted by agent-loop and inherits only that core
  // plugin's dependencies; a child command producer declares its own UI
  // service dependency while retaining the parent agent scope and lifetime.
  const commandFiber = agent.ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'help',
      description: 'Show keyboard shortcuts and commands',
      handler: () => { showHelp(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'model',
      description: 'Show this session\'s model route; select with /model [provider/]model',
      input: { hint: '[provider/]model' },
      handler: ({ rawInput }) => {
        deps.queueModelCommand(rawInput)
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'more',
      description: 'Load earlier transcript history',
      handler: () => {
        if (!deps.loadHistory()) {
          deps.appendNotice('Already at the beginning of the transcript.', 'info')
        }
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'clear',
      description: 'Clear the transcript view (session history is unchanged)',
      handler: () => { deps.clearChat(); deps.requestRender(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'details',
      description: 'Select tool-card visibility and reasoning display',
      input: { hint: '[collapsed|expanded|hidden] [reasoning [on|off]]' },
      handler: ({ rawInput }) => runDetails(rawInput),
    })
    commandCtx.commands.register({
      name: 'palette',
      description: 'Show every color and attribute role this terminal renders',
      handler: () => { showPalette(); return { kind: 'success' } },
    })
    commandCtx.commands.register({
      name: 'resume',
      description: 'Open the resumable-sessions picker',
      handler: () => {
        deps.showResume()
        return { kind: 'success' }
      },
    })
    commandCtx.commands.register({
      name: 'status',
      description: 'Show the session-status diagnostic card',
      handler: () => { deps.showStatusCard(); return { kind: 'success' } },
    })
    const exitHandler = (): CommandResult => {
      deps.requestExit()
      return { kind: 'success' }
    }
    commandCtx.commands.register({
      name: 'exit',
      description: 'Exit after the active turn reaches idle',
      handler: exitHandler,
    })
    commandCtx.commands.register({
      name: 'quit',
      description: 'Exit after the active turn reaches idle',
      handler: exitHandler,
    })
  })

  const runCommand = (text: string): boolean => {
    if (!text.startsWith('/')) return false
    const controller = new AbortController()
    controllers.add(controller)
    void ctx.commands.execute(agent, text, controller.signal).then(
      (execution) => {
        // Disposal aborts every in-flight controller, so a successful
        // execution can only land on a live channel.
        /* v8 ignore next -- a settled execution implies the channel survived. */
        if (deps.isDisposed()) return
        if (execution === undefined) {
          deps.appendNotice(`Unknown command: ${text}`, 'warning')
        } else if (execution.result.text !== undefined && execution.result.text !== '') {
          deps.appendNotice(execution.result.text, execution.result.kind === 'error' ? 'error' : 'info')
        }
      },
      (error: unknown) => {
        // Every registered handler contains its own failures; only a
        // shutdown-triggered abort rejects the execution itself, which the
        // disposed guard swallows silently.
        /* v8 ignore next -- handler failures are contained per command */
        if (!deps.isDisposed()) {
          deps.appendNotice(`Command failed: ${errorChain(error)}`, 'error')
        }
      },
    ).finally(() => { controllers.delete(controller) })
    return true
  }

  return {
    runCommand,
    dispose: async () => {
      for (const controller of controllers) controller.abort(new Error('TUI disposed'))
      controllers.clear()
      disposeCommandChanges()
      await commandFiber.dispose()
    },
  }
}

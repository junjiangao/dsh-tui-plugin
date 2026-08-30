/**
 * Model-selection sub-controller for the interactive chat channel: the queued
 * `/model` command, the keyboard model selector overlay with reasoning-effort
 * selection, and resolution of the selected model's context window. Owns the
 * context-window cache the status footer reads; the channel owns the shared
 * {@link ModelSelectionRef} installed into the agent's prompt assembly.
 * @module @deepseek-ai/dsh-tui/chat/model-command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { errorChain, LlmError, type ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { displayText } from '../components/text.ts'
import {
  ModelDialog,
  readModelChoices,
  targetLabel,
  targetReasoningLabel,
  type ModelChoice,
  type ModelDialogSelection,
} from '../components/dialogs.ts'
import type { Palette } from '../components/theme.ts'
import type { ResolvedTuiConfig } from '../config.ts'
import type { TuiOverlayManager } from '../extension/overlay-manager.ts'
import type { TuiOverlaySession } from '../extension/types.ts'

/** Collaborators the model controller needs from the chat channel. */
export interface ModelControllerDeps {
  readonly ctx: Context
  readonly resolved: ResolvedTuiConfig
  readonly palette: Palette
  readonly overlayManager: TuiOverlayManager
  /** Shared selected-model handle installed into the agent's prompt assembly. */
  readonly selection: ModelSelectionRef
  appendNotice(message: string, kind?: 'info' | 'warning' | 'error'): void
  requestRender(): void
  isDisposed(): boolean
}

/** Model-selection controller for one chat channel. */
export interface ModelController {
  /** Resolved context window of the selected model, or `undefined` if unknown. */
  contextWindow(): number | undefined
  /** Queue a `/model` command; empty argument opens the selector. */
  queueModelCommand(raw: string): void
  /** Drop the pending context-window resolution (shutdown). */
  resetContextResolution(): void
  /** Forget the tracked selector overlay (shutdown). */
  clearOverlay(): void
  /** Remove the adapter-registration listener (channel detach). */
  detach(): void
}

type ContextResolution =
  | { readonly kind: 'resolved'; readonly contextWindow: number | undefined }
  | { readonly kind: 'error'; readonly error: unknown }

/**
 * Build the model-selection controller for one chat channel.
 * @param deps - channel collaborators and shared selected-model handle.
 * @returns the controller wired to the channel's overlay and status views.
 */
export function createModelController(deps: ModelControllerDeps): ModelController {
  const { ctx, resolved, palette, overlayManager, selection } = deps
  let contextWindow: number | undefined
  let contextResolution: Promise<ContextResolution> | undefined
  let modelOverlay: TuiOverlaySession | undefined
  let modelCommands = Promise.resolve()

  // A route whose adapter has not registered yet. Loader activation order is
  // service-driven, so the TUI can mount before a configured adapter plugin
  // activates; that transient NO_ADAPTER is not an error — the resolution
  // waits for the next `llm/adapters-updated` commit instead of surfacing it.
  let awaitingAdapter = false

  const resolveContextWindow = (selected: ModelSelection | undefined): void => {
    contextWindow = undefined
    awaitingAdapter = false
    const resolution: Promise<ContextResolution> = selected === undefined
      ? Promise.resolve({ kind: 'resolved', contextWindow: undefined } as const)
      : ctx.llm.resolveModelInfo(selected.provider, selected.model).then(
        info => ({ kind: 'resolved', contextWindow: info.context?.contextWindow } as const),
        (error: unknown) => ({ kind: 'error', error } as const),
      )
    contextResolution = resolution
    void resolution.then((result) => {
      // Every resolution source (initial, selectModel, adapter commit) runs
      // sequentially, so a superseded resolution cannot settle late.
      /* v8 ignore next -- resolutions settle in submission order */
      if (contextResolution !== resolution) return
      if (result.kind === 'error') {
        // An unset selection never produces an error result; the undefined
        // guard keeps the error branch reachable only through a selection.
        /* v8 ignore start -- unset selections resolve without querying the catalog */
        if (selected !== undefined && result.error instanceof LlmError && result.error.code === 'NO_ADAPTER') {
          awaitingAdapter = true
          return
        }
        /* v8 ignore stop */
        deps.appendNotice(`Could not resolve model context: ${errorChain(result.error)}`, 'error')
        return
      }
      contextWindow = result.contextWindow
      deps.requestRender()
    })
  }
  // The wait cannot go stale against `selection.current`: every selection
  // change re-enters resolveContextWindow, which clears it. A commit that
  // still lacks the route parks the resolution again rather than erroring, so
  // unrelated topology changes stay silent. The disposer rides the channel's
  // detachListeners() through detach(), matching the sibling listeners.
  const disposeAdapterListener = ctx.on('llm/adapters-updated', () => {
    if (deps.isDisposed() || !awaitingAdapter) return
    resolveContextWindow(selection.current)
  })
  resolveContextWindow(selection.current)

  const selectModel = (
    selected: ModelChoice,
    explicitReasoning?: { effort: ReasoningEffortId | undefined },
  ): void => {
    const sameRoute = selection.current?.provider === selected.provider && selection.current.model === selected.model
    const reasoningEffort = explicitReasoning === undefined
      ? (sameRoute ? selection.current?.reasoningEffort ?? selected.reasoning?.defaultEffort : selected.reasoning?.defaultEffort)
      : explicitReasoning.effort
    if (sameRoute && selection.current?.reasoningEffort === reasoningEffort) {
      const reasoning = targetReasoningLabel(selected, reasoningEffort)
      deps.appendNotice(`Model is already ${targetLabel(selected)}${reasoning === undefined ? '' : ` with reasoning effort ${displayText(reasoning)}`}.`)
      return
    }
    selection.current = {
      provider: selected.provider,
      model: selected.model,
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
    }
    resolveContextWindow(selection.current)
    // Persist the pick as the deployment default so the next startup boots on
    // it instead of reverting to the first/base model.
    const defaultModel = ctx.get?.('agentDefaultModel')
    if (defaultModel !== undefined) {
      void defaultModel.saveSelection(selection.current).catch((error: unknown) => {
        ctx.logger.warn(`tui: model selection changed but the default was not saved: ${errorChain(error)}`)
      })
    }
    const reasoning = targetReasoningLabel(selected, reasoningEffort)
    deps.appendNotice([
      `Model selected: ${targetLabel(selected)}.`,
      ...reasoning === undefined ? [] : [`Reasoning effort: ${displayText(reasoning)}.`],
      'New steps will use it.',
    ].join(' '))
  }

  const showModelSelector = (choices: readonly ModelChoice[]): void => {
    const current = selection.current === undefined ? 'unset' : targetLabel(selection.current)
    if (choices.length === 0) {
      deps.appendNotice(`Current model: ${current}\nNo models are advertised by registered providers.`, 'warning')
      return
    }
    void modelOverlay?.close()
    const session = overlayManager.open({
      create: () => new ModelDialog(
        choices,
        selection.current,
        resolved.maxModelOptions,
        palette,
        (selectionResult: ModelDialogSelection) => {
          void session.close()
          selectModel(selectionResult.choice, { effort: selectionResult.reasoningEffort })
        },
        () => { void session.close() },
      ),
      options: {
        width: resolved.modelDialogWidth,
        maxHeight: resolved.modelDialogMaxHeight,
        anchor: 'center',
        margin: 1,
      },
    })
    modelOverlay = session
    void session.closed.then(() => {
      if (modelOverlay === session) modelOverlay = undefined
    })
    deps.requestRender()
  }

  const handleModelCommand = async (raw: string): Promise<void> => {
    const choices = await readModelChoices(ctx, selection.current)
    if (deps.isDisposed()) return
    const argument = raw.trim()
    if (argument === '') {
      showModelSelector(choices)
      return
    }
    const parts = argument.split(/\s+/u)
    if (parts.length > 2) {
      deps.appendNotice('Usage: /model [provider/]model', 'warning')
      return
    }

    let matches: ModelChoice[]
    if (parts.length === 2) {
      matches = choices.filter(choice => choice.provider === parts[0] && choice.model === parts[1])
    } else {
      const value = argument
      const qualified = choices.filter(choice => targetLabel(choice) === value)
      matches = qualified.length > 0 ? qualified : choices.filter(choice => choice.model === value)
    }
    if (matches.length === 0) {
      deps.appendNotice(`Unknown model: ${argument}. Run /model to list available models.`, 'warning')
      return
    }
    if (matches.length > 1) {
      deps.appendNotice(`Model "${argument}" is advertised by multiple providers; use /model <provider>/<model>.`, 'warning')
      return
    }
    const selected = matches[0]
    /* v8 ignore next -- a non-empty matches array always has index zero. */
    if (selected === undefined) return
    selectModel(selected)
  }

  return {
    contextWindow: () => contextWindow,
    queueModelCommand(raw: string): void {
      modelCommands = modelCommands.then(async () => {
        await handleModelCommand(raw)
      }).catch((error: unknown) => {
        if (!deps.isDisposed()) deps.appendNotice(`Could not read the model catalog: ${errorChain(error)}`, 'error')
      })
    },
    resetContextResolution(): void {
      contextResolution = undefined
    },
    clearOverlay(): void {
      modelOverlay = undefined
    },
    detach(): void {
      disposeAdapterListener()
    },
  }
}

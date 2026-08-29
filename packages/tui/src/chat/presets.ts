/**
 * Agent-preset sub-controller for the interactive chat channel: the `/preset`
 * command, the roster picker overlay, and the blank-session recompose gate
 * with its durable `agent-preset/selected` record. The channel's run()
 * resolves the creation preset and mounts it inside the agent factory's setup
 * hook; this controller owns everything after the agent exists.
 * @module @deepseek-ai/dsh-tui/chat/presets
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset, type AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { PresetDialog, type PresetChoice } from '../components/dialogs.ts'
import type { Palette } from '../components/theme.ts'
import type { ResolvedTuiConfig } from '../config.ts'
import type { TuiOverlayManager } from '../extension/overlay-manager.ts'
import type { TuiOverlaySession } from '../extension/types.ts'

/** Collaborators the preset controller needs from the chat channel. */
export interface PresetControllerDeps {
  readonly ctx: Context
  /** Exact root agent whose scope the preset joins. */
  readonly agent: Agent
  readonly resolved: ResolvedTuiConfig
  readonly palette: Palette
  readonly overlayManager: TuiOverlayManager
  appendNotice(message: string, kind?: 'info' | 'warning' | 'error'): void
  requestRender(): void
  isDisposed(): boolean
}

/** Preset-selection controller for one chat channel. */
export interface PresetController {
  /** Queue a `/preset` command; an empty argument opens the picker, an id switches directly. */
  queuePresetCommand(raw: string): void
  /** Forget the tracked picker overlay (shutdown). */
  clearOverlay(): void
}

/** Map one roster entry to the selector row it presents. */
function toPresetChoice(preset: AgentPreset): PresetChoice {
  return {
    id: preset.id,
    label: preset.name ?? preset.id,
    trust: preset.trust,
    ...preset.description === undefined ? {} : { description: preset.description },
    ...preset.broken === undefined ? {} : { broken: preset.broken },
  }
}

/**
 * Build the preset-selection controller for one chat channel.
 * @param deps - channel collaborators.
 * @returns the controller wired to the channel's overlay and the roster service.
 */
export function createPresetController(deps: PresetControllerDeps): PresetController {
  const { ctx, agent, palette, resolved, overlayManager } = deps
  let presetOverlay: TuiOverlaySession | undefined
  let presetCommands = Promise.resolve()

  // A session may switch presets only while it is blank: a started
  // conversation's history was produced under its preset's tools, so the
  // composition is fixed for its lifetime. The agent and session survive a
  // switch; only the scope link moves.
  const isBlank = (): boolean => !agent.session.events.some(event => event.type === 'turn/start')

  const selectPreset = async (id: string): Promise<void> => {
    const presets = ctx.get('agentPresets')
    if (presets === undefined) {
      deps.appendNotice('This deployment composes no agent presets.', 'warning')
      return
    }
    if (!isBlank()) {
      deps.appendNotice('Preset locked: this session has already started. Exit and start a new session to switch presets.', 'warning')
      return
    }
    try {
      const preset = await presets.recompose(agent.ctx, id)
      // Recorded only after the swap committed: the log states what the agent
      // runs, and a rejected mount leaves the previous composition.
      agent.session.append('agent-preset/selected', { agentPreset: preset.id })
      deps.appendNotice(`Agent preset set to ${preset.id}.`)
      deps.requestRender()
    } catch (error: unknown) {
      deps.appendNotice(`Could not switch agent preset: ${errorChain(error)}`, 'error')
    }
  }

  const showPicker = async (): Promise<void> => {
    const presets = ctx.get('agentPresets')
    if (presets === undefined) {
      deps.appendNotice('This deployment composes no agent presets.', 'warning')
      return
    }
    const list = await presets.list()
    if (deps.isDisposed()) return
    if (list.length === 0) {
      deps.appendNotice('No agent presets are composed by any roster root.', 'warning')
      return
    }
    const current = presets.composedPreset(agent.ctx)
    const choices = list.map(toPresetChoice)
    void presetOverlay?.close()
    const session = overlayManager.open({
      create: () => new PresetDialog(
        choices,
        current,
        resolved.maxModelOptions,
        palette,
        (id) => {
          void session.close()
          void selectPreset(id)
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
    presetOverlay = session
    void session.closed.then(() => {
      if (presetOverlay === session) presetOverlay = undefined
    })
    deps.requestRender()
  }

  return {
    queuePresetCommand(raw: string): void {
      presetCommands = presetCommands.then(async () => {
        const argument = raw.trim()
        if (argument === '') {
          await showPicker()
        } else {
          await selectPreset(argument)
        }
      }).catch((error: unknown) => {
        if (!deps.isDisposed()) deps.appendNotice(`Could not read the preset roster: ${errorChain(error)}`, 'error')
      })
    },
    clearOverlay(): void {
      presetOverlay = undefined
    },
  }
}

/**
 * The preset a session actually runs: the newest `agent-preset/selected`
 * event wins over the creation header, so a session that switched while blank
 * resumes under the composition its history was produced with.
 * @param agent - exact driven agent.
 * @returns the preset id, or `undefined` when the session records none.
 */
export function sessionPreset(agent: Agent): string | undefined {
  return resolveSessionPreset({ header: agent.session.header, events: agent.session.events })
}

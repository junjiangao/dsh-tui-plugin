/**
 * Permission-mode sub-controller for the interactive chat channel: the
 * `/permission` command, the compact permission selector rendered below the
 * input box, and direct preset switches through the permission-presets
 * service. When no permission-presets service is composed (lightweight hosts
 * and tests) the controller falls back to the approval-only ask/never knobs.
 * @module @deepseek-ai/dsh-tui/chat/permission
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  APPROVAL_POLICIES,
  effectiveApprovalPolicy,
  setApprovalPolicy,
  type ApprovalPolicy,
} from '@deepseek-ai/dsh-user-approval'
import { PermissionDialog, type PermissionChoice } from '../components/dialogs.ts'
import type { Palette } from '../components/theme.ts'
import type { ResolvedTuiConfig } from '../config.ts'
import type { TuiOverlayManager } from '../extension/overlay-manager.ts'
import type { TuiOverlaySession } from '../extension/types.ts'

/** One file-sandbox mode bundled by a permission preset. */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Structural face of the optional `ctx.permissionPresets` service. */
interface PermissionPresetServiceLike {
  readonly names: readonly string[]
  current(events: readonly SessionEvent[]): string
  resolve(name: string): {
    sandbox: SandboxMode
    approval: ApprovalPolicy
    name?: string
    description?: string
  }
  optionOf(name: string): { value: string; name: string; description?: string }
}

/** Structural face of the optional approval service (defined by the host row). */
interface ApprovalServiceLike {
  config?: { policy?: ApprovalPolicy }
  setPolicy?(agent: Agent, policy: ApprovalPolicy): void
}

/** Collaborators the permission controller needs from the chat channel. */
export interface PermissionControllerDeps {
  readonly ctx: Context
  /** Exact root agent whose permission settings this terminal controls. */
  readonly agent: Agent
  readonly resolved: ResolvedTuiConfig
  readonly palette: Palette
  readonly overlayManager: TuiOverlayManager
  /** Current effective approval policy, kept in sync by the channel's event fold. */
  currentPolicy(): ApprovalPolicy
  appendNotice(message: string, kind?: 'info' | 'warning' | 'error'): void
  requestRender(): void
  isDisposed(): boolean
}

/** Permission-mode controller for one chat channel. */
export interface PermissionController {
  /** Queue a `/permission` command; an empty argument opens the mode selector, a mode switches directly. */
  queuePermissionCommand(raw: string): void
  /** Forget the tracked selector overlay (shutdown). */
  clearOverlay(): void
}

/** Kebab-case preset names are title-cased for terminal presentation. */
export function permissionPresetLabel(value: string, name: string): string {
  if (value === 'danger-full-access') return 'Full access'
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/u.test(name)) {
    return name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
  }
  return name
}

/**
 * Build the permission-mode controller for one chat channel.
 * @param deps - channel collaborators and the optional permission-presets service.
 * @returns the controller wired to the channel's inline-below overlay.
 */
export function createPermissionController(deps: PermissionControllerDeps): PermissionController {
  const { ctx, agent, palette, resolved, overlayManager } = deps
  let permissionOverlay: TuiOverlaySession | undefined
  let permissionCommands = Promise.resolve()

  // Host services resolve through `ctx.get`, the untracked accessor: reading a
  // declared service as a context property requires an inject scope, and this
  // controller — like every render path — runs outside one.
  const presets = (): PermissionPresetServiceLike | undefined =>
    ctx.get('permissionPresets') as PermissionPresetServiceLike | undefined
  const approval = (): ApprovalServiceLike | undefined =>
    ctx.get('approval') as ApprovalServiceLike | undefined

  const closeSelector = (): void => {
    void permissionOverlay?.close()
  }

  const currentSandboxMode = (): SandboxMode => {
    const events = agent.session.events
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index] as SessionEvent
      if ((event as { type: string }).type === 'sandbox/mode') {
        return (event as { data: { mode: SandboxMode } }).data.mode
      }
    }
    const shell = ctx.get('shell') as { sandboxMode?: SandboxMode } | undefined
    return shell?.sandboxMode
      ?? (ctx.get('sandboxPolicy') as { defaultMode?: SandboxMode } | undefined)?.defaultMode
      ?? 'read-only'
  }

  const appendPermissionPreset = (session: Session, preset: string): void => {
    ;(session as unknown as {
      append(type: 'permission/preset', data: { preset: string }): void
    }).append('permission/preset', { preset })
  }

  const appendSandboxMode = (session: Session, mode: SandboxMode): void => {
    ;(session as unknown as {
      append(type: 'sandbox/mode', data: { mode: SandboxMode }): void
    }).append('sandbox/mode', { mode })
  }

  const applyApprovalPolicy = (policy: ApprovalPolicy): void => {
    const current = deps.currentPolicy()
    if (policy === current) {
      deps.appendNotice(`Permission mode is already ${policy}.`)
      closeSelector()
      return
    }
    const service = approval()
    if (service?.setPolicy !== undefined) {
      service.setPolicy(agent, policy)
    } else {
      // The approval service is a required row in composed deployments; the
      // direct fold keeps the command usable in lightweight tests and hosts
      // that mount the channel without the service.
      setApprovalPolicy(agent.session, policy)
    }
    deps.appendNotice(`Permission mode set to ${policy}.`)
    closeSelector()
    deps.requestRender()
  }

  const applyPreset = (name: string): void => {
    const service = presets()
    /* v8 ignore next -- applyPreset is called only after the service was found */
    if (service === undefined) return
    const spec = service.resolve(name)
    const events = agent.session.events
    const currentPreset = service.current(events)
    if (currentPreset !== name) {
      appendPermissionPreset(agent.session, name)
    }
    const currentSandbox = currentSandboxMode()
    if (spec.sandbox !== currentSandbox) {
      appendSandboxMode(agent.session, spec.sandbox)
    }
    const currentApproval = effectiveApprovalPolicy(events)
      ?? approval()?.config?.policy
      ?? 'ask'
    if (spec.approval !== currentApproval) {
      const serviceApproval = approval()
      if (serviceApproval?.setPolicy !== undefined) {
        serviceApproval.setPolicy(agent, spec.approval)
      } else {
        setApprovalPolicy(agent.session, spec.approval)
      }
    }
    const option = service.optionOf(name)
    deps.appendNotice(`Permission mode set to ${permissionPresetLabel(name, option.name)}.`)
    closeSelector()
    deps.requestRender()
  }

  const applyChoice = (value: string): void => {
    if (presets() !== undefined) {
      applyPreset(value)
    } else {
      applyApprovalPolicy(value as ApprovalPolicy)
    }
  }

  const buildChoices = (): PermissionChoice[] => {
    const service = presets()
    if (service !== undefined) {
      const current = service.current(agent.session.events)
      return service.names.map((name) => {
        const option = service.optionOf(name)
        return {
          value: name,
          label: permissionPresetLabel(name, option.name),
          ...option.description === undefined ? {} : { description: option.description },
          current: name === current,
        }
      })
    }
    const current = deps.currentPolicy()
    return [
      { value: 'ask', label: 'ask', description: 'Ask before permission-sensitive actions', current: current === 'ask' },
      { value: 'never', label: 'never', description: 'Auto-reject permission-sensitive actions', current: current === 'never' },
    ]
  }

  const showSelector = (): void => {
    void permissionOverlay?.close()
    const choices = buildChoices()
    if (choices.length === 0) {
      deps.appendNotice('No permission modes are available in this deployment.', 'warning')
      return
    }
    const session = overlayManager.open({
      create: () => new PermissionDialog(
        choices,
        palette,
        (value) => { applyChoice(value) },
        () => { closeSelector() },
      ),
      options: {
        width: resolved.permissionDialogWidth,
        maxHeight: resolved.permissionDialogMaxHeight,
      },
    }, 'inline-below')
    permissionOverlay = session
    void session.closed.then(() => {
      /* v8 ignore next -- overlay FIFO closes this session before a replacement can become the tracked permission overlay */
      if (permissionOverlay === session) permissionOverlay = undefined
    })
    deps.requestRender()
  }

  return {
    queuePermissionCommand(raw: string): void {
      permissionCommands = permissionCommands.then(() => {
        const argument = raw.trim()
        if (argument === '') {
          showSelector()
          return
        }
        const service = presets()
        if (service !== undefined) {
          if (service.names.includes(argument)) {
            applyPreset(argument)
          } else {
            deps.appendNotice(`Unknown permission mode "${argument}". Usage: /permission [${service.names.join('|')}]`, 'warning')
          }
          return
        }
        if (APPROVAL_POLICIES.includes(argument as ApprovalPolicy)) {
          applyApprovalPolicy(argument as ApprovalPolicy)
          return
        }
        deps.appendNotice(`Unknown permission mode "${argument}". Usage: /permission [ask|never]`, 'warning')
      }).catch((error: unknown) => {
        if (!deps.isDisposed()) deps.appendNotice(`Permission command failed: ${errorChain(error)}`, 'error')
      })
    },
    clearOverlay(): void {
      permissionOverlay = undefined
    },
  }
}

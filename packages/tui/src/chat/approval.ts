/**
 * Approval answerer for the interactive chat channel: claims every
 * `approval/request` for the exact root agent this terminal drives and shows
 * one decision modal, delegating every other request with `next()`.
 * @module @deepseek-ai/dsh-tui/chat/approval
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { TuiOverlayManager } from '../extension/overlay-manager.ts'
import { ApprovalDialog, type ApprovalChoice } from '../components/dialogs.ts'
import type { Palette } from '../components/theme.ts'

/** Collaborators the approval answerer needs from the chat channel. */
export interface ApprovalAnswererDeps {
  readonly ctx: Context
  /** Exact root agent whose keyboard this terminal owns. */
  readonly agent: Agent
  readonly palette: Palette
  readonly overlayManager: TuiOverlayManager
  /** Whether the channel has begun shutting down. */
  isDisposed(): boolean
}

/**
 * Install the terminal's approval answerer as an effect-owned waterfall
 * listener.
 * @param deps - channel collaborators and overlay host.
 * @returns the exact disposer that unregisters the answerer.
 */
export function installApprovalAnswerer(deps: ApprovalAnswererDeps): () => void {
  const { ctx, agent, palette, overlayManager } = deps
  return ctx.on('approval/request', function (req, next) {
    // Scope-filtered dispatch only reaches this terminal when the TUI owns
    // the keyboard, but the root plugin context sees every agent's request,
    // so only the exact driven agent may be answered here.
    if (req.agent !== agent) return next()
    // Disposal detaches this listener in the same synchronous shutdown step,
    // so the branch only guards an out-of-order teardown race.
    /* v8 ignore next -- shutdown detaches the listener before any new request can arrive. */
    if (deps.isDisposed()) return Promise.resolve<ApprovalOutcome>('cancelled')
    return new Promise<ApprovalOutcome>((resolve) => {
      const settle = (choice: ApprovalChoice): void => {
        void session.close()
        resolve(choice)
      }
      let session: ReturnType<TuiOverlayManager['open']>
      try {
        session = overlayManager.open({
          ...req.signal === undefined ? {} : { signal: req.signal },
          create: () => new ApprovalDialog(
            req.toolName,
            req.reason,
            palette,
            settle,
            () => { settle('cancelled') },
          ),
          options: {
            width: 72,
            maxHeight: 20,
          },
        })
      }
      /* v8 ignore next 5 -- the disposed guard above settles the same shutting-down window */
      catch {
        // The TUI is shutting down or the modal queue rejected the request;
        // the question is withdrawn, never answered.
        resolve('cancelled')
        return
      }
      // Every non-answer close (abort, owner disposal, TUI shutdown, dialog
      // failure) withdraws the question rather than deciding it.
      void session.closed.then((result) => {
        if (result.reason === 'closed') return
        resolve('cancelled')
      })
    })
  })
}

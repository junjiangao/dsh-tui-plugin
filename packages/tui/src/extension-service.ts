/**
 * The public extension-overlay service one mounted TUI provides, and its
 * concrete fiber-bound implementation.
 *
 * The abstract contract keeps pi-tui, focus, and terminal lifecycle state
 * private to the manager; plugins receive only effect-owned overlay sessions.
 * @module @deepseek-ai/dsh-tui/extension-service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TuiOverlayRequest, TuiOverlaySession } from './extension/types.ts'
import type { TuiOverlayManager } from './extension/overlay-manager.ts'

/** Public terminal-local interaction service provided by one mounted TUI. */
export abstract class TuiExtensionService extends Service {
  /** Exact agent driven by this terminal instance. */
  abstract readonly agent: Agent

  /**
   * Queue an interactive overlay owned by the calling plugin fiber.
   *
   * The TUI displays one overlay at a time in FIFO order. Disposing the caller
   * removes a queued overlay or closes an active one before plugin teardown
   * settles. This live presentation is neither logged nor replayed.
   *
   * @param request - component factory, layout constraints, and cancellation.
   * @returns the effect-owned overlay session.
   * @throws when the TUI has begun shutting down.
   */
  abstract openOverlay(request: TuiOverlayRequest): TuiOverlaySession
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Interactive overlays owned by the mounted TUI, when one is composed. */
    tui: TuiExtensionService
  }
}

/** Cordis service whose method effects bind to the calling plugin fiber. */
export class TuiExtensionServiceImpl extends Service implements TuiExtensionService {
  constructor(
    ctx: Context,
    readonly agent: Agent,
    private readonly overlays: TuiOverlayManager,
  ) {
    super(ctx, 'tui')
  }

  /** @inheritdoc */
  openOverlay(request: TuiOverlayRequest): TuiOverlaySession {
    let operation: ReturnType<TuiOverlayManager['open']> | undefined
    const disposeOwner = this.ctx.effect(
      () => () => operation?.closeWith('owner-disposed'),
      'tui.openOverlay()',
    )
    try {
      operation = this.overlays.open(request)
    } catch (error) {
      void disposeOwner()
      throw error
    }
    void operation.closed.then(() => { void disposeOwner() })
    return operation
  }
}

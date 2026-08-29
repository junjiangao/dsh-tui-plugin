/**
 * The invocation boundary the interactive TUI runs against: the startup
 * service the tui bundle's provider publishes from the parsed flags, the
 * process-lifecycle host contract, and the runtime seam (terminal, exit,
 * clock, and optional prompt/git overrides). These are plain interfaces so
 * tests can drive the channel with a fake terminal.
 * @module @deepseek-ai/dsh-tui/runtime
 */

import type { Terminal } from '@earendil-works/pi-tui'

/** Service provided by the tui bundle's startup row and consumed by the tui row's lazy config. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the tui row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Persisted session to resume, from `--resume`; absent mints a fresh one. */
  resumeSessionId?: string
  /** Explicit id for the fresh session this invocation creates, from `--session`. */
  sessionId?: string
  /** Provider/model route, from `--model <provider>/<model>`; absent keeps the session default. */
  model?: string
  /** Tool presentation mode, from `--tool-mode`; absent keeps the deployment default. */
  toolMode?: 'native' | 'code' | 'both'
  /** Agent preset id, from `--preset`; absent mounts the roster default (or nothing without a roster). */
  preset?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Invocation-level TUI flags; provided by the bundle startup row before the tui row mounts. */
    tuiStartup?: TuiStartupValues
  }
}

/**
 * Host-owned process handoff for an in-place `/resume`: dispose the current
 * app and replace it with a runtime for `sessionId` in `cwd`. Success does
 * not return; a host may reject before it commits teardown. Provided by the
 * launcher when the platform supports it; absent leaves sessions selectable
 * but not resumable in place.
 */
export interface TuiResumeHost {
  /**
   * Hand the process over to the selected session.
   * @param sessionId - validated persisted session selected by the user.
   * @param cwd - the selected session's own workspace, which the replacement
   *   process must run in; may differ from the current workspace.
   */
  handoff(sessionId: string, cwd: string): Promise<never>
}

/**
 * Runtime boundary used by the interactive TUI: the terminal, the process
 * exit hook, and the optional host overrides.
 */
export interface TuiRuntime {
  /** Terminal implementation; production uses pi-tui's `ProcessTerminal`. */
  terminal: Terminal
  /** Exit hook used by terminal shutdown or a target-agent startup failure. */
  exit(code: number): void
  /**
   * Override the prompt's logical working-directory label without changing the
   * session directory used by tools.
   * @param cwd - Operational working directory from the session header.
   * @returns Unescaped label; the TUI makes terminal controls visible.
   */
  formatCwd?: (cwd: string | undefined) => string
  /**
   * Override the Git branch shown in the prompt context line. Resolves off the
   * event loop; the prompt fills the branch in when the query settles.
   * @param cwd - Operational working directory from the session header.
   * @returns Unescaped branch name, or `undefined` outside a Git worktree.
   */
  gitBranch?: (cwd: string) => Promise<string | undefined>
  /** Monotonic-enough wall clock for elapsed status rendering. Defaults to `Date.now`. */
  now?(): number
  /** Host-owned process handoff; absent leaves the session selectable but not resumable in place. */
  handoffResume?: TuiResumeHost['handoff']
  /**
   * Line the host wants printed once the terminal is released on exit, such as
   * the command that resumes this session. Absent prints nothing. The host owns
   * the wording; the TUI owns rendering and escapes terminal controls.
   */
  goodbyeMessage?: string
}

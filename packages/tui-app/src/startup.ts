/**
 * The terminal app's command-line provider: it parses the `dsh --profile tui`
 * flag family (`--resume`, `--session`, `--model`, `--tool-mode`) and its
 * `--help` text, then provides the immutable values as
 * {@link TUI_STARTUP_SERVICE}. Ordinary rows inject that service before
 * reading it from lazy config, so `--help` (which provides nothing) never
 * mounts the terminal.
 * @module @deepseek-ai/dsh-tui-app/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/**
 * The service key the tui row's lazy config reads. Duplicated here instead of
 * imported from @deepseek-ai/dsh-tui so the root bundle's startup entry stays
 * self-contained; the spec locks the two copies equal.
 */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** Invocation values the tui row reads; mirrors dsh-tui's TuiStartupValues. */
export interface TuiStartupValues {
  /** Persisted session to resume, from `--resume`; absent mints a fresh one. */
  resumeSessionId?: string
  /** Explicit id for the fresh session this invocation creates, from `--session`. */
  sessionId?: string
  /** Provider/model route, from `--model <provider>/<model>`; absent keeps the session default. */
  model?: string
  /** Tool presentation mode, from `--tool-mode`; absent keeps the deployment default. */
  toolMode?: 'native' | 'code' | 'both'
  /** Agent preset id, from `--preset`; absent mounts the roster default. */
  preset?: string
}

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/** The TUI flag family, as commander parsed it. */
interface TuiOptions {
  resume?: string
  session?: string
  model?: string
  toolMode?: string
  preset?: string
}

/**
 * Narrow a validated `--tool-mode` value to the tools row's presentation modes.
 * @param value - raw commander option value.
 * @returns the union member, or `undefined` for an absent flag or an invalid value.
 */
function parseToolMode(value: string | undefined): 'native' | 'code' | 'both' | undefined {
  if (value === undefined) return undefined
  if (value === 'native' || value === 'code' || value === 'both') return value
  return undefined
}


/**
 * This app's command: its flags, its description, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Run the interactive full-screen terminal coding agent.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <sessionId>', 'resume a persisted session instead of minting a fresh one')
    .option('--session <sessionId>', 'explicit id for the fresh session this invocation creates')
    .option('--model <provider>/<model>', 'provider/model route for this session, e.g. deepseek-official/deepseek-v4-pro')
    .option('--tool-mode <native|code|both>', 'tool presentation mode; overrides DSH_TOOLS_MODE and the schema default')
    .option('--preset <id>', 'compose this session from the named agent preset; absent mounts the roster default')
    .addHelpText('after', `
Examples:
  dsh --profile tui                        start a fresh session
  dsh --profile tui --resume <sessionId>   resume a persisted session
`)
}

/**
 * Parse and provide the TUI invocation as an ordinary Cordis service. The
 * command's action publishes the flags this invocation named; a non-TTY
 * stdin/stdout, a resume/session conflict, or a malformed flag is a usage
 * error, so on rejection (and on `--help`) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    // Refuse pipes BEFORE the tree can take over the terminal: a piped launch
    // would otherwise settle into an idle UI-less process instead of exiting
    // nonzero (the pi-tui terminal checks the same facts when it mounts).
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      program.error('error: the TUI requires stdin and stdout to be interactive TTYs; use `dsh --profile headless "task"` for pipes and automation')
    }
    const options = program.opts<TuiOptions>()
    const toolMode = parseToolMode(options.toolMode)
    if (options.resume !== undefined && options.session !== undefined) {
      program.error('error: --resume and --session are mutually exclusive: a session is either resumed or freshly created')
    }
    if (options.toolMode !== undefined && toolMode === undefined) {
      program.error(`error: --tool-mode must be native, code, or both, got ${JSON.stringify(options.toolMode)}`)
    }
    if (options.model !== undefined && !options.model.includes('/')) {
      program.error(`error: --model must be <provider>/<model>, got ${JSON.stringify(options.model)}`)
    }
    if (options.preset !== undefined && !/^[a-z0-9][a-z0-9-]*$/u.test(options.preset)) {
      program.error(`error: --preset must be a preset id ([a-z0-9][a-z0-9-]*), got ${JSON.stringify(options.preset)}`)
    }
    ctx.provide(TUI_STARTUP_SERVICE, {
      ...options.resume !== undefined && { resumeSessionId: options.resume },
      ...options.session !== undefined && { sessionId: options.session },
      ...options.model !== undefined && { model: options.model },
      ...toolMode !== undefined && { toolMode },
      ...options.preset !== undefined && { preset: options.preset },
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}

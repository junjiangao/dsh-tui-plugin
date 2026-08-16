# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

The interactive full-screen terminal front door for DeepSeek Harness agents. Mounted by the [`@deepseek-ai/dsh-tui-app`](../tui-app/README.md) bundle as the `tui` row, the plugin's `apply` fails loud when the process has no TTY, mounts the real terminal through the `TuiRuntime` seam, and owns the keyboard, the screen, and the root agent's lifetime until the operator exits or the process is torn down.

## Surface

- **One root agent** — `mountTui` creates (or resumes, via `--resume`) a persisted session and drives it for the whole terminal lifetime; the transcript, live streaming steps, tool cards, and dialogs all render from the durable session log.
- **Transcript** — user/assistant messages, streaming text and reasoning deltas, per-step timing footers, and turn-end notices. Long sessions never build the whole component tree: the mount replays only the newest `maxInitialMessages` user messages and `/more` (or PageUp) loads earlier pages of `historyPageSize` messages on demand, with a resident ledger that evicts the oldest settled rows and cards under the `transcriptResidentMaxBytes` / `cardCacheEntries` budgets.
- **Tool cards** — one card per tool call with `generic`, `terminal`, or `diff` presentation, collapsed/expanded via Ctrl+O, reasoning hidden via Ctrl+R; oversized diffs degrade to the full sides when `maxDiffEditLength` is exceeded.
- **Interactions** — goal status rows, approval dialogs, `ask_user_question` dialogs, and extension overlays render through `ctx.tui.openOverlay`; Ctrl+C cancels the active turn, Esc cancels an active overlay.
- **Commands** — `/clear`, `/details`, `/exit`, `/help`, `/model`, `/more`, `/palette`, `/quit`, `/resume`, `/status`, plus the goal command unit's own commands; Ctrl+D and Ctrl+C at an empty prompt also exit.
- **Selection and completion** — the `/model` picker (provider/model/effort from `ctx.llm`), the `/resume` session picker (projection-cache titles, bounded concurrent scan), and `@`-file and session-reference completion with a bounded workspace index.
- **Status footer** — phase glyph, elapsed wall time (ticks on `statusIntervalMs` while running), queued steering, token buckets, KV-cache hit rate, context occupancy, model route, and tool-card mode, truncated to the terminal width; the terminal title follows the durable session title.

## Config

| Key | Type | Default | Notes |
|---|---|---|---|
| `sessionId` | string | `'main'` | Session identity for a fresh session. |
| `model` | string | — | `provider/model` route parsed from the launcher flag. |
| `showReasoning` | boolean | `true` | Render reasoning blocks; Ctrl+R toggles. |
| `maxToolOutputLines` | number | `6` | Preview line budget for tool-card bodies. |
| `maxDiffEditLength` | number | `1000` | Diff budget; a larger edit renders full sides. |
| `maxQuestionOptions` / `maxModelOptions` / `maxResumeOptions` | number | `8` | Picker caps. |
| `resumeScanConcurrency` | number | `4` | Bounded title-scan parallelism for /resume. |
| `questionDialogWidth` / `questionDialogMaxHeight` | number | `200` / `20` | Question dialog geometry. |
| `modelDialogWidth` / `modelDialogMaxHeight` | number | `76` / `20` | Model picker geometry. |
| `fileSearchMaxResults` / `fileSearchMaxEntries` | number | `20` / `10_000` | Bounded `@`-completion index. |
| `fileSearchExcludedDirectories` | string[] | `['node_modules', '.git', …]` | Completion index exclusions. |
| `showHardwareCursor` | boolean | `false` | Hardware cursor instead of the Pi text cursor. |
| `maxInitialMessages` | number | `200` | User messages in the initial transcript window. |
| `historyPageSize` | number | `100` | User messages loaded per /more page. |
| `transcriptResidentMaxBytes` | number | `4194304` | Resident transcript byte budget. |
| `cardCacheEntries` | number | `2000` | Resident tool/context card budget. |
| `statusIntervalMs` | number | `500` | Footer elapsed-clock tick interval while running. |
| `theme` | object | `{color: true, …}` | `color`, `truecolor`. |
| `title` | string | `'DeepSeek Harness'` | Fallback terminal title. |

## Model Experience

### Terminal channel model context

#### What the model sees

The channel itself contributes no system-prompt blocks. Operator input is submitted as ordinary user messages (or steering while a turn runs); `@`-completions expand to plain prompt text; session references inject their recorded context snapshot at the message; the `/model` selection is applied atomically by the agent setup hook at each step boundary. Dialogs, the status footer, and the `/status` card are terminal-only diagnostics and never reach a request.

#### Token effect

None per request from the channel itself; prompt and tool tokens belong to the base rows and the selected model route. A session reference adds its snapshot's own token cost to the submitting message.

#### KV Cache effect

The model route and effort selection change the request prefix and therefore the provider KV-cache hit surface at the next step boundary; everything else reuses the cached prefix. The footer's cache-rate segment reflects the logged usage.

## Known Limitations and Deferred Work

- **One session at a time** — the terminal owns a single root agent; there is no multi-session split view (switch sessions via /resume, which hands the host the resume request).
- **No mouse interaction** — the surface is keyboard-only by design; dialogs and pickers use Tab/arrows/Enter.
- **TTY required** — `apply` fails loud on a non-TTY process; run inside `dsh --profile tui`.
- **Terminal recovery on crash** — a hard kill (SIGKILL) cannot restore the alternate screen; the shutdown path (`/exit`, Ctrl+C/Ctrl+D, SIGTERM handling) restores the terminal before exit.

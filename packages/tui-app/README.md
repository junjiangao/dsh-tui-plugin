# `@deepseek-ai/dsh-tui-app`

English | [中文](README.zh.md)

The dsh terminal startup glue plugin. The installable profile bundle lives at the repository root (root `cordis.patch.yml` + committed `lib/` entries): it overlays `dsh-base` with the coding persona, the tool presentation mode, the storage stack (durable checkpoint cache for /resume titles), the session-reference provider, the `tui-startup` flag provider, the `tui` row itself, the **agent-presets roster** (default `standard`), and the `code-runtime` row, and — like the web surface — disables the host-plane agent rows so each session's mounted preset is the only tool set the model sees.

## Startup

The `tui-startup` plugin ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` (host-provided `dsh-cmdline`), parses the `dsh --profile tui` flag family, and provides the immutable `tuiStartup` service; rows that need it inject it and read it from lazy config, so `--help` (which provides nothing) never mounts the terminal. The service key is duplicated here (not imported) so the root bundle's startup entry stays self-contained; the spec locks both copies equal.

| Flag | Effect |
|---|---|
| `--resume <sessionId>` | Resume a persisted session instead of minting a fresh one. |
| `--session <sessionId>` | Explicit id for the fresh session this invocation creates. |
| `--model <provider>/<model>` | Provider/model route for this session. |
| `--tool-mode <native\|code\|both>` | Tool presentation mode; overrides `DSH_TOOLS_MODE` and the schema default. |
| `--preset <id>` | Compose this session from the named agent preset; absent mounts the roster default. A resumed session keeps its recorded preset; a contradicting `--preset` fails the launch. |

## Goal stack relationship

The profile rides over `dsh-base`'s goal stack (goal service + projection + command unit): the goal status row the terminal renders comes from the durable goal projection, and the goal commands (`/goal`) are agent-scoped registrations the channel's command dispatch executes; the base's `interaction`/approval rows feed the terminal's approval dialogs.

## Model Experience

### Terminal bundle model context

#### What the model sees

The bundle itself adds no prompt content; it only selects the persona text (base-owned), the tool mode, and the model route parsed from `--model`. Everything model-visible comes from the base rows and the terminal channel (`dsh-tui`).

#### Token effect

None from this package; the persona and tool selection belong to the base rows.

#### KV Cache effect

None; the startup provider adds nothing to any request prefix.

## Known Limitations and Deferred Work

- **Terminal required** — the profile is interactive-only; a non-TTY invocation fails loud in the `tui` plugin's `apply` (except `--help` and `--dump-default-config`, which never mount the terminal).
- **One terminal surface** — the bundle mounts exactly one `tui` row; multi-surface layouts would need a second bundle.
- **pi-tui patch distribution** — the editor prompt/frame patch (repo `patches/`) applies at build time through this workspace's `patchedDependencies` and ships baked into the committed root bundle `lib/tui.mjs`; a locally built bundle from an unpatched tree falls back to the default editor frame and prompt (cosmetic only). Upstreaming the patch to pi-tui removes the caveat.

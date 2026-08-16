# dsh-tui-plugin

The DeepSeek Harness interactive terminal front door (`dsh --profile tui`) as a **standalone plugin project**, extracted from the `dsh-tui` worktree of the `deepseek-harness` repository. This project is deliberately **not** merged upstream; it exists as an independent directory so the TUI surface can live outside the harness repository.

## Layout

| Path | Package | Role |
|---|---|---|
| `packages/tui` | `@deepseek-ai/dsh-tui` | The terminal channel plugin: transcript rendering, tool cards, dialogs, commands, model/resume pickers, `@`-completion, and long-session virtualization |
| `packages/tui-app` | `@deepseek-ai/dsh-tui-app` | The `tui` profile bundle: `cordis.patch.yml` overlay over `dsh-base` plus the `tui-startup` flag provider (`--resume`/`--session`/`--model`/`--tool-mode`) |
| `patches/` | — | The `@earendil-works/pi-tui@0.80.7` patch, applied through pnpm `patchedDependencies` (root `package.json`) |

## Dependency contract: the host dsh provides the harness plane

The TUI consumes the harness's capability seam as **peer dependencies** — the runtime host (an installed `dsh` whose profile composes `dsh-base`) provides them; this project ships only the front-door code. Peer set (`packages/tui/package.json`): `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, `dsh-compaction`, `dsh-commands`, `dsh-goal`, `dsh-invariants`, `dsh-session-{persistence,projection,projection-cache,query,reference,title}`, `dsh-subprocess`, `dsh-user-{approval,questions}`. Third-party runtime dependencies (`pi-tui@0.80.7` + patch, `diff`, `saxes`) are declared normally.

## Current status

- **Not yet wired to a loader mechanism.** The code is organized and the manifests express the host-provides-peer contract, but no `--patch` overlay, plugin-install entry, or publish pipeline is configured yet. The natural next step is a `cordis.yml`/patch overlay that mounts these two packages against a host `dsh-base` composition.
- **Tests are kept but need a harness-equipped dev environment.** `packages/tui/tests` (289 tests, keyless snapshots, coverage 100%) and `packages/tui-app/tests` import many `@deepseek-ai/*` packages that are only partially published to the npm registry (e.g. `dsh-session` is published only as `0.0.1-rc.1`). To run them, either point `devDependencies` at published equivalents or link the packages from a local `deepseek-harness` checkout (`pnpm link` or a file: dependency), then `pnpm install` + `pnpm test`.
- **`pnpm install` currently fails** on missing registry versions for some dev/peer packages — this is expected until the harness publishes the missing `@deepseek-ai/*` packages or the dev environment links them.

## Source provenance

Extracted from the `dsh-tui` worktree (worktree of `deepseek-harness`) at the state where the TUI restoration goal completed: `packages/tui/tui` → `packages/tui`, `packages/bundle/tui-app` → `packages/tui-app`, plus the pi-tui patch. Package names, versions (`0.1.0-rc.5`), exports maps, and the `cordis.patch.yml` row ids are preserved verbatim so a future loader integration can reference them unchanged.

License: MIT (same as the harness sources this project extracts).

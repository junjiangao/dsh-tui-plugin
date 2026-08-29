# dsh-tui-plugin

The DeepSeek Harness interactive terminal front door (`dsh --profile tui`) as a **standalone plugin project**, extracted from the `dsh-tui` worktree of the `deepseek-harness` repository. This project is deliberately **not** merged upstream; it exists as an independent directory so the TUI surface can live outside the harness repository.

## Layout

| Path | Package | Role |
|---|---|---|
| (root) | `dsh-tui-plugin` | The git-installable profile bundle: root `cordis.patch.yml` overlay over `dsh-base` plus committed prebuilt entries `lib/tui.mjs`/`lib/startup.mjs` |
| `packages/tui` | `@deepseek-ai/dsh-tui` | The terminal channel plugin source: transcript rendering, tool cards, dialogs, commands, model/resume/preset pickers, `@`-completion, and long-session virtualization |
| `packages/tui-app` | `@deepseek-ai/dsh-tui-app` | The `tui-startup` flag-provider source (`--resume`/`--session`/`--model`/`--tool-mode`/`--preset`) |
| `patches/` | — | The `@earendil-works/pi-tui@0.80.7` patch, applied at build time through pnpm `patchedDependencies` and baked into `lib/tui.mjs` |

## Dependency contract: the host dsh provides the harness plane

The TUI consumes the harness's capability seam as **peer dependencies** — the runtime host (an installed `dsh` whose profile composes `dsh-base`) provides them; this project ships only the front-door code. Peer set (`packages/tui/package.json`): `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, `dsh-compaction`, `dsh-commands`, `dsh-goal`, `dsh-invariants`, `dsh-session-{persistence,projection,projection-cache,query,reference,title}`, `dsh-subprocess`, `dsh-user-{approval,questions}`. Third-party runtime dependencies (`pi-tui@0.80.7` + patch, `diff`, `saxes`) are declared normally.

## Installing from GitHub (dsh ≥ 0.1.1-rc.2)

The repository root is the plugin package: it declares `dsh.bundle.patch` and ships **prebuilt, self-contained ESM bundles under `lib/`** (committed to git). A git install therefore needs **no build step** — pi-tui (with the editor patch baked in), diff, saxes, commander, and marked are all bundled; only the `@deepseek-ai/*` seam stays external and resolves through the host's profiles fallback links.

```bash
dsh plugin --profile tui add github:junjiangao/dsh-tui-plugin
# pin a release: dsh plugin --profile tui add github:junjiangao/dsh-tui-plugin#v0.1.0-rc.5
dsh --profile tui                  # fresh session, roster default preset
dsh --profile tui --preset code    # fresh session on the code preset
dsh --profile tui --resume <id>    # resume (the recorded preset wins)
```

Uninstalling reverses it: `dsh plugin --profile tui remove dsh-tui-plugin` removes the dependency, the bundle entry, and the installed files; the profile directory itself stays (host behavior). Local development installs work the same way with a path spec: `dsh plugin --profile tui add /path/to/dsh-tui-plugin`.

The patch layer mounts the **agent-presets roster** (default `standard`), the `code-runtime` row, and disables the host-plane agent rows exactly like the web surface, so the mounted preset is the only tool set the model sees. In the TUI: `/preset` opens the picker, `/preset <id>` switches directly — allowed only while the session is blank; a started session keeps its preset (exit and start a new session to switch). The current preset shows in `/status` and the switch is recorded as an `agent-preset/selected` event, so resume rebuilds the composition the history ran under.

## Current status

- **Wired as a git-installable profile bundle.** The root package declares `dsh.bundle.patch`, ships `cordis.patch.yml` + committed `lib/` bundles, and installs via `dsh plugin --profile tui add github:junjiangao/dsh-tui-plugin` (no host source change needed — a `tui` template in `PROFILE_TEMPLATES` is not required). CI rebuilds the bundles and diffs them, so committed artifacts cannot go stale.
- **Dev environment: link a local harness checkout.** The `@deepseek-ai/*` dev/peer dependencies are only partially published to the npm registry (e.g. `dsh-session` is published only as `0.0.1-rc.1`). To develop and test standalone, run:

  ```bash
  DSH_HARNESS_ROOT=/path/to/deepseek-harness node scripts/link-harness.mjs
  pnpm install
  ```

  The script indexes the harness checkout (`vendor/*` plus `packages/*/*`), injects `link:` overrides and `linkWorkspacePackages` into a managed block of `pnpm-workspace.yaml`, and verifies every needed package is present. The harness checkout must have its own `pnpm install` completed first — linked packages resolve their transitive dependencies through the harness tree. `pnpm run link:harness:revert` restores the committed manifest state (run it before committing `pnpm-workspace.yaml`). CI (`.github/workflows/ci.yml`) reproduces the same flow against a pinned harness ref.
- **Lockfiles are environment-local.** `pnpm-lock.yaml` embeds absolute `link:` paths into the harness checkout, so it is gitignored; every environment (and CI) regenerates its own.
- **Verification gates.** `pnpm lint` (oxlint) · `pnpm typecheck` (tsc × 2) · `pnpm test` (vitest, 321 tests incl. 13 keyless snapshots) · `pnpm build` (tsc declaration emit + tsdown, both packages). The CI verifies against the pinned harness ref `b150a551b8` (dsh-v0.1.1-rc.2).

## Source provenance

Extracted from the `dsh-tui` worktree (worktree of `deepseek-harness`) at the state where the TUI restoration goal completed: `packages/tui/tui` → `packages/tui`, `packages/bundle/tui-app` → `packages/tui-app`, plus the pi-tui patch. Package names, versions (`0.1.0-rc.5`), exports maps, and the `cordis.patch.yml` row ids are preserved verbatim so a future loader integration can reference them unchanged.

License: MIT (same as the harness sources this project extracts).

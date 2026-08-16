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
- **Dev environment: link a local harness checkout.** The `@deepseek-ai/*` dev/peer dependencies are only partially published to the npm registry (e.g. `dsh-session` is published only as `0.0.1-rc.1`). To develop and test standalone, run:

  ```bash
  DSH_HARNESS_ROOT=/path/to/deepseek-harness node scripts/link-harness.mjs
  pnpm install
  ```

  The script indexes the harness checkout (`vendor/*` plus `packages/*/*`), injects `link:` overrides and `linkWorkspacePackages` into a managed block of `pnpm-workspace.yaml`, and verifies every needed package is present. The harness checkout must have its own `pnpm install` completed first — linked packages resolve their transitive dependencies through the harness tree. `pnpm run link:harness:revert` restores the committed manifest state (run it before committing `pnpm-workspace.yaml`). CI (`.github/workflows/ci.yml`) reproduces the same flow against a pinned harness ref.
- **Lockfiles are environment-local.** `pnpm-lock.yaml` embeds absolute `link:` paths into the harness checkout, so it is gitignored; every environment (and CI) regenerates its own.
- **Verification gates.** `pnpm lint` (oxlint) · `pnpm typecheck` (tsc × 2) · `pnpm test` (vitest, 297 tests incl. 13 keyless snapshots) · `pnpm build` (tsc declaration emit + tsdown, both packages).

## Source provenance

Extracted from the `dsh-tui` worktree (worktree of `deepseek-harness`) at the state where the TUI restoration goal completed: `packages/tui/tui` → `packages/tui`, `packages/bundle/tui-app` → `packages/tui-app`, plus the pi-tui patch. Package names, versions (`0.1.0-rc.5`), exports maps, and the `cordis.patch.yml` row ids are preserved verbatim so a future loader integration can reference them unchanged.

License: MIT (same as the harness sources this project extracts).

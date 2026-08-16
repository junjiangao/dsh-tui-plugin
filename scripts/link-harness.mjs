#!/usr/bin/env node
/**
 * Link unpublished @deepseek-ai/* harness packages from a local deepseek-harness
 * checkout into this workspace, so `pnpm install && pnpm test` run standalone.
 *
 * What it does:
 *   1. Indexes every workspace package in the harness checkout (vendor and
 *      packages subtrees, two levels deep) by package name.
 *   2. Collects the @deepseek-ai/* dev/peer dependencies declared by this
 *      repo's packages (excluding this repo's own packages).
 *   3. Injects a managed block into pnpm-workspace.yaml with `overrides`
 *      (`link:` to the harness directories) and `linkWorkspacePackages: true`
 *      (so @deepseek-ai/dsh-tui resolves to this repo's workspace member).
 *
 * The committed manifests stay clean: the managed block is local-only state.
 * `node scripts/link-harness.mjs --revert` removes it. Re-running replaces
 * the block (idempotent). The harness root is taken from DSH_HARNESS_ROOT
 * (default: /work/Repos/github/deepseek-harness) and must contain its own
 * completed `pnpm install` — linked packages resolve their transitive
 * dependencies through the harness tree's node_modules.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..')
const workspaceYamlPath = join(repoRoot, 'pnpm-workspace.yaml')
const BEGIN = '# BEGIN link-harness (managed by scripts/link-harness.mjs — local dev state, do not commit)'
const END = '# END link-harness'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Map every harness workspace package name to its directory. */
function indexHarnessPackages(harnessRoot) {
  const index = new Map()
  for (const group of ['vendor', 'packages']) {
    const groupDir = join(harnessRoot, group)
    if (!existsSync(groupDir)) continue
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (group === 'packages') {
        // packages/<group>/<pkg>
        const pkgDir = join(groupDir, entry.name)
        for (const pkg of readdirSync(pkgDir, { withFileTypes: true })) {
          if (!pkg.isDirectory()) continue
          const manifest = join(pkgDir, pkg.name, 'package.json')
          if (!existsSync(manifest)) continue
          const { name } = readJson(manifest)
          if (name) index.set(name, join(pkgDir, pkg.name))
        }
      } else {
        // vendor/<pkg>
        const manifest = join(groupDir, entry.name, 'package.json')
        if (!existsSync(manifest)) continue
        const { name } = readJson(manifest)
        if (name) index.set(name, join(groupDir, entry.name))
      }
    }
  }
  return index
}

/** @deepseek-ai/* dependency names this repo's packages need from the harness. */
function collectNeededNames() {
  const own = new Set(['@deepseek-ai/dsh-tui', '@deepseek-ai/dsh-tui-app'])
  const needed = new Set()
  for (const pkg of ['tui', 'tui-app']) {
    const manifest = readJson(join(repoRoot, 'packages', pkg, 'package.json'))
    for (const depTable of [manifest.devDependencies, manifest.peerDependencies]) {
      for (const name of Object.keys(depTable ?? {})) {
        if (name.startsWith('@deepseek-ai/') && !own.has(name)) needed.add(name)
      }
    }
  }
  return [...needed].sort()
}

function stripManagedBlock(yaml) {
  const begin = yaml.indexOf(BEGIN)
  const end = yaml.indexOf(END)
  if (begin === -1 || end === -1) return yaml
  return yaml.slice(0, begin) + yaml.slice(end + END.length).replace(/^\n+/, '')
}

function main() {
  const yaml = readFileSync(workspaceYamlPath, 'utf8')
  if (process.argv.includes('--revert')) {
    const stripped = stripManagedBlock(yaml)
    if (stripped === yaml) {
      console.log('link-harness: no managed block present, nothing to revert')
      return
    }
    writeFileSync(workspaceYamlPath, stripped.replace(/\s+$/, '\n'))
    console.log('link-harness: reverted pnpm-workspace.yaml to committed state')
    return
  }

  const harnessRoot = resolve(process.env.DSH_HARNESS_ROOT ?? '/work/Repos/github/deepseek-harness')
  if (!existsSync(join(harnessRoot, 'pnpm-workspace.yaml'))) {
    console.error(`link-harness: ${harnessRoot} is not a deepseek-harness checkout (pnpm-workspace.yaml missing)`)
    process.exit(1)
  }

  const index = indexHarnessPackages(harnessRoot)
  const needed = collectNeededNames()
  const missing = needed.filter((name) => !index.has(name))
  if (missing.length > 0) {
    console.error(`link-harness: packages not found in ${harnessRoot}:\n  ${missing.join('\n  ')}`)
    process.exit(1)
  }

  const lines = [
    BEGIN,
    'overrides:',
    ...needed.map((name) => `  '${name}': link:${index.get(name)}`),
    "linkWorkspacePackages: true",
    END,
  ]
  const next = stripManagedBlock(yaml).replace(/\s+$/, '\n') + '\n' + lines.join('\n') + '\n'
  writeFileSync(workspaceYamlPath, next)
  console.log(`link-harness: linked ${needed.length} @deepseek-ai/* packages from ${harnessRoot}`)
  console.log('link-harness: run `pnpm install` next; revert with `pnpm run link:harness:revert`')
}

main()

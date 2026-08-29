/**
 * The root bundle patch the loader applies over dsh-base for the
 * git-installed package. Parse it with the include plugin's own dialect
 * (js-yaml + entryListSchema, `!!js` included), then lock the structural
 * facts that keep the tui profile consistent: self-resolving rows, the roster
 * and code-runtime rows, the tuiStartup injections, the host-plane disable
 * set, and id uniqueness across the whole layer.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const patchPath = join(root, 'cordis.patch.yml')
const manifestPath = join(root, 'package.json')

/** One parsed patch entry; shapes are validated structurally below. */
type PatchEntry = Record<string, unknown>

function loadPatch(): PatchEntry[] {
  const content = readFileSync(patchPath, 'utf8')
  const parsed = yaml.load(content, { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error('the patch must be a top-level YAML array')
  return parsed as PatchEntry[]
}

/** The exact host-plane rows the tui overlay disables (mirrors the web surface plus hmr). */
const DISABLED_IDS = [
  'hmr',
  'tool-bash',
  'tool-pwsh',
  'tool-jobs',
  'tool-fs',
  'tool-fs-search',
  'tool-str-replace-editor',
  'skill-filesystem',
  'tool-skill',
  'tool-goal',
  'plan-mode',
  'compaction-basic',
  'command-compact',
  'tool-result-pruner',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent',
  'tool-subagent-fork',
  'workflow-worker-thread',
  'tool-workflow',
  'tool-ralph',
  'agent-instructions',
  'tool-todo',
  'tool-web',
] as const

describe('root bundle patch', () => {
  it('parses with the loader patch dialect', () => {
    const patch = loadPatch()
    expect(patch.length).toBeGreaterThan(0)
    for (const entry of patch) {
      expect(typeof entry).toBe('object')
      expect(entry).not.toBeNull()
    }
  })

  it('declares the bundle patch and ships the prebuilt entries', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
      files?: string[]
      exports?: Record<string, unknown>
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(manifest.files).toContain('lib/tui.mjs')
    expect(manifest.files).toContain('lib/startup.mjs')
    expect(manifest.exports?.['./tui']).toBe('./lib/tui.mjs')
    expect(manifest.exports?.['./startup']).toBe('./lib/startup.mjs')
  })

  it('disables exactly the host-plane agent rows the presets replace', () => {
    const patch = loadPatch()
    const disabled = patch
      .filter(entry => entry.disabled === true)
      .map(entry => String(entry.id))
      .sort()
    expect(disabled).toEqual([...DISABLED_IDS].sort())
  })

  it('resolves its own rows through the root exports map', () => {
    const patch = loadPatch()
    const inserted = patch.flatMap(entry => Array.isArray(entry.insert) ? entry.insert as PatchEntry[] : [])
    const byId = new Map(inserted.map(row => [String(row.id), row]))
    const tui = byId.get('tui')
    expect(tui?.name).toBe('dsh-tui-plugin/tui')
    expect(tui?.inject).toEqual(['tuiStartup'])
    const startup = byId.get('tui-startup')
    expect(startup?.name).toBe('dsh-tui-plugin/startup')
    const tools = patch.find(entry => entry.id === 'tools')
    expect(tools?.inject).toEqual(['tuiStartup'])
  })

  it('mounts the roster and the code runtime, without a global ask-user row', () => {
    const patch = loadPatch()
    const inserted = patch.flatMap(entry => Array.isArray(entry.insert) ? entry.insert as PatchEntry[] : [])
    const byId = new Map(inserted.map(row => [String(row.id), row]))
    const roster = byId.get('agent-presets')
    expect(roster?.name).toBe('@deepseek-ai/dsh-agent-presets')
    expect((roster?.config as Record<string, unknown> | undefined)?.default).toBe('standard')
    expect(byId.get('code-runtime')?.name).toBe('@deepseek-ai/dsh-code-runtime-worker-thread')
    // The global ask-user row moved behind presets: standard, code, and cordis
    // each mount their own, so the tui layer must not insert another.
    expect(byId.has('tool-ask-user')).toBe(false)
  })

  it('keeps every row id unique across the layer', () => {
    const patch = loadPatch()
    const ids = [
      ...patch.filter(entry => entry.id !== undefined).map(entry => String(entry.id)),
      ...patch.flatMap(entry => Array.isArray(entry.insert) ? (entry.insert as PatchEntry[]).map(row => String(row.id)) : []),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })
})

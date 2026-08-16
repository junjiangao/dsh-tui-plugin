/**
 * Shared collaborators for the interactive channel: compaction-checkpoint
 * recognition. Additional helpers (cwd formatting, git branch, hint editor)
 * join in later rounds.
 * @module @deepseek-ai/dsh-tui/chat/helpers
 */

import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Whether an event is a landed compaction checkpoint. Recognition goes through
 * {@link isCompactCheckpointSource} — the compaction seam's backend-independent
 * contract for the source every backend stamps on its replacement user message —
 * rather than the shape of the replacement. Other replacements (a pruned
 * `tool/result`, a regenerated `assistant/message`) rewrite one node for the
 * model and mark no boundary in the conversation.
 * @param event - event to test.
 * @returns true when the event compacted a surface range.
 */
export function isCompactCheckpoint(event: SessionEvent): boolean {
  return event.type === 'user/message'
    && isCompactCheckpointSource(event.data.source)
    && isReplacementSurfaceEvent(event)
}

import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

/**
 * Format a working directory for the prompt, abbreviating the home prefix as
 * `~`.
 * @param cwd - Operational working directory.
 * @returns The display label.
 */
export function formatCwd(cwd: string | undefined): string {
  if (cwd === undefined) return 'cwd unset'
  const home = homedir()
  const rel = relative(resolve(home), resolve(cwd))
  if (rel === '') return '~'
  /* v8 ignore next -- Windows cross-drive coverage; POSIX relative() cannot return an absolute path. */
  if (isAbsolute(rel)) return cwd
  if (rel !== '..' && !rel.startsWith(`..${sep}`)) return `~${sep}${rel}`
  return cwd
}

/**
 * Read a session-reference context card's display labels from an event source.
 * @param source - event source to inspect.
 * @returns per-reference labels, or `undefined` when the source is not a reference card.
 */
export function sessionReferenceCard(source: unknown): string[] | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const record = source as Record<string, unknown>
  if (record['kind'] !== 'session-reference' || !Array.isArray(record['references'])) return undefined
  const references = record['references'] as unknown[]
  const labels: string[] = []
  for (const reference of references) {
    if (typeof reference !== 'object' || reference === null) return undefined
    const entry = reference as Record<string, unknown>
    const sessionId = entry['sessionId']
    const label = entry['label']
    if (typeof sessionId !== 'string' || typeof label !== 'string') return undefined
    labels.push(label === sessionId ? sessionId : `${label} (${sessionId})`)
  }
  return labels
}

/**
 * Resolve the current Git branch for the prompt context line. The query runs
 * off the event loop (bounded, scrubbed environment) so the mount path never
 * blocks on the subprocess; the prompt fills the branch in when it resolves.
 * @param cwd - Operational working directory to query.
 * @returns Branch name, or `undefined` outside a worktree or on any failure.
 */
export function gitBranch(cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf8',
      env: scrubbedParentEnv(),
      timeout: 1_000,
    }, (error, stdout) => {
      if (error !== null) {
        resolve(undefined)
        return
      }
      const branch = stdout.trim()
      /* v8 ignore next -- detached-HEAD behavior is exercised by the runtime smoke, not the unit checkout. */
      resolve(branch === '' ? undefined : branch)
    })
  })
}

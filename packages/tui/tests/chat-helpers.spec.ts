import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCwd, gitBranch, sessionReferenceCard } from '../src/chat/helpers.ts'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => 'main\n'),
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('sessionReferenceCard', () => {
  it('reads labels from a session-reference source', () => {
    expect(sessionReferenceCard({
      kind: 'session-reference',
      references: [
        { sessionId: 's-1', label: 'First session' },
        { sessionId: 's-2', label: 's-2' },
      ],
    })).toEqual(['First session (s-1)', 's-2'])
  })

  it('returns undefined for non-reference shapes', () => {
    expect(sessionReferenceCard(undefined)).toBeUndefined()
    expect(sessionReferenceCard('nope')).toBeUndefined()
    expect(sessionReferenceCard({ kind: 'user' })).toBeUndefined()
    expect(sessionReferenceCard({ kind: 'session-reference' })).toBeUndefined()
    expect(sessionReferenceCard({ kind: 'session-reference', references: [{ sessionId: 1, label: 'x' }] })).toBeUndefined()
    expect(sessionReferenceCard({ kind: 'session-reference', references: [{ sessionId: 's-1' }] })).toBeUndefined()
    expect(sessionReferenceCard({ kind: 'session-reference', references: ['bad'] })).toBeUndefined()
    // A valid entry followed by a malformed one still yields nothing.
    expect(sessionReferenceCard({
      kind: 'session-reference',
      references: [{ sessionId: 's-1', label: 'ok' }, { sessionId: 1, label: 'x' }],
    })).toBeUndefined()
  })
})

describe('formatCwd', () => {
  it('abbreviates the home prefix and keeps foreign paths absolute', () => {
    const home = homedir()
    expect(formatCwd(undefined)).toBe('cwd unset')
    expect(formatCwd(home)).toBe('~')
    expect(formatCwd(`${home}/project`)).toBe(`~${process.platform === 'win32' ? '\\' : '/'}project`)
    expect(formatCwd('/elsewhere/path')).toBe('/elsewhere/path')
    expect(formatCwd(`${home}/../outside`)).toBe(`${home}/../outside`)
  })
})

describe('gitBranch', () => {
  it('scrubs ambient credentials and DSH names from the Git child', () => {
    vi.stubEnv('TUI_TEST_PASSWORD', 'ambient-password')
    vi.stubEnv('DSH_TUI_TEST_FLAG', 'ambient-harness-state')
    expect(gitBranch('/workspace')).toBe('main')
    const call = vi.mocked(execFileSync).mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ]
    expect(call[0]).toBe('git')
    expect(call[1]).toEqual(['branch', '--show-current'])
    expect(call[2].env).not.toHaveProperty('TUI_TEST_PASSWORD')
    expect(call[2].env).not.toHaveProperty('DSH_TUI_TEST_FLAG')
  })

  it('is undefined when git is unavailable or outside a worktree', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('git not found') })
    expect(gitBranch('/workspace')).toBeUndefined()
  })
})

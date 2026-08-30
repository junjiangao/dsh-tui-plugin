/**
 * Session-resume sub-controller for the interactive chat channel: the
 * `/resume` selector, one metadata-plus-title scan that tolerates a corrupt
 * neighbor, the pre-handoff preflight, and the terminal handoff itself.
 * @module @deepseek-ai/dsh-tui/chat/resume
 */

import { stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionCache } from '@deepseek-ai/dsh-session-projection-cache'
import type {
  SessionQueryEngine,
  SessionRecord,
} from '@deepseek-ai/dsh-session-query'
import type { Palette } from '../components/theme.ts'
import type { ResolvedTuiConfig } from '../config.ts'
import type { TuiOverlayManager } from '../extension/overlay-manager.ts'
import type { TuiOverlaySession } from '../extension/types.ts'
import type { TuiRuntime } from '../runtime.ts'
import {
  ResumePicker,
  summarizeResumeCandidate,
  type ResumeCandidate,
} from '../components/dialogs.ts'
import { formatCwd } from './helpers.ts'

/** Collaborators the resume controller needs from the chat channel. */
export interface ResumeControllerDeps {
  readonly ctx: Context
  readonly resolved: ResolvedTuiConfig
  readonly palette: Palette
  readonly overlayManager: TuiOverlayManager
  readonly agent: Agent
  readonly runtime: TuiRuntime
  /**
   * The optional session-query service, re-read at each use. `sessionQuery` is
   * mounted by an independent plugin, and a flat config tree gives no ordering
   * guarantee between it and this front door, so a value captured once at
   * construction can be `undefined` even though the service arrives moments later.
   */
  sessionQuery: () => SessionQueryEngine | undefined
  appendNotice(message: string, kind: 'info' | 'warning' | 'error'): void
  requestRender(): void
  isDisposed(): boolean
  /** Drain pending input and stop the pi-tui screen so a host can take over the terminal. */
  releaseTerminal(): Promise<void>
  /** Restart the pi-tui screen and refocus the editor after a failed handoff. */
  reacquireTerminal(): void
}

/** Session-resume controller for one chat channel. */
export interface ResumeController {
  /** Open the searchable session selector, scoped to this workspace until the user widens it. */
  showResume(): void
}

/**
 * How many times the preflight re-reads a session whose log looks torn. A
 * concurrent web surface can transiently expose a complete Zstandard frame
 * that has not yet received its final JSONL newline; the read is stable at the
 * filesystem level, so the persistence layer does not retry it. Bounded retries
 * let the other writer finish before we report the session as unreadable.
 */
const RESUME_READ_RETRIES = 3

/** Base delay before the first preflight read retry; each retry doubles it. */
const RESUME_READ_RETRY_BASE_MS = 150

type TitleResolution = { title?: string; failure?: unknown }

/**
 * Build the session-resume controller for one chat channel.
 * @param deps - channel collaborators, terminal handles, and optional services.
 * @returns the controller wired to the `/resume` command.
 */
export function createResumeController(deps: ResumeControllerDeps): ResumeController {
  const {
    ctx, agent, runtime, resolved, palette, overlayManager, sessionQuery,
  } = deps
  let resumeOverlay: TuiOverlaySession | undefined
  let resumeInFlight = false
  let resumeScan = 0

  /** Label any session's own workspace the way the prompt labels the current one. */
  const workspaceLabel = (cwd: string | undefined): string =>
    runtime.formatCwd?.(cwd) ?? formatCwd(cwd)

  /** Summarize one record from metadata and its batch-folded title. */
  const summarize = (
    record: SessionRecord,
    title: string | undefined,
    lastActivityAt: number | undefined,
  ): ResumeCandidate => summarizeResumeCandidate(
    record,
    title,
    lastActivityAt,
    agent.session.id,
    agent.session.header.cwd,
    workspaceLabel,
  )

  /** The disabled fallback row for a session whose title read failed. */
  const unreadableCandidate = (
    record: SessionRecord,
    lastActivityAt: number | undefined,
    error: unknown,
  ): ResumeCandidate => ({
    record,
    title: 'Unreadable session',
    lastActivityAt: lastActivityAt ?? record.header.createdAt,
    currentWorkspace: record.header.cwd === agent.session.header.cwd,
    workspaceLabel: workspaceLabel(record.header.cwd),
    disabledReason: `session cannot be loaded: ${errorChain(error)}`,
  })

  /**
   * Metadata-only activity time: a live session's last in-memory event time,
   * otherwise the persisted artifact's mtime. Never reads a log, so browsing
   * cost stays independent of log size; any append (including bookkeeping)
   * moves it.
   */
  const lastActivityAt = async (record: SessionRecord): Promise<number | undefined> => {
    const live = ctx.sessions.get(record.header.id)
    if (live !== undefined) return live.events.at(-1)?.time
    const location = ctx.get('sessionPersistence')?.locate(record.header)
    if (location === undefined) return undefined
    try {
      return (await stat(location.path)).mtimeMs
    } catch {
      // Only a just-deleted or never-materialized artifact fails stat; the row falls back to created-at.
      return undefined
    }
  }

  /**
   * One persisted row's title through the projection-cache ladder: the
   * zero-I/O checkpoint row when usable, otherwise a cold read that folds
   * only the log tail since the checkpoint and writes the refreshed row
   * back — so a store scanned once serves later scans without log reads.
   */
  const projectedTitle = async (
    cache: SessionProjectionCache,
    record: SessionRecord,
    signal: AbortSignal,
  ): Promise<string | null | undefined> => {
    const live = ctx.sessions.get(record.header.id)
    if (live !== undefined) return ctx.get('sessionProjections')?.snapshot(live).values.title
    const cached = cache.cachedSnapshot(record.header)
    if (cached !== undefined && 'title' in cached.values) return cached.values.title
    return (await cache.coldSnapshot(record.header.id, signal)).values.title
  }

  /**
   * Resolve every row's title without reading whole logs when the projection
   * cache is mounted (live registry snapshot / checkpoint row / tail-only
   * cold read, bounded by `resumeScanConcurrency`); a composition without
   * the cache falls back to one bounded raw-log title batch.
   */
  const resolveTitles = async (
    listQuery: SessionQueryEngine,
    records: readonly SessionRecord[],
    signal: AbortSignal,
  ): Promise<TitleResolution[]> => {
    const cache = ctx.get('sessionProjectionCache')
    if (cache === undefined) {
      const results = await listQuery.readTitleSnapshots(records.map(record => record.header.id), signal)
      return records.map((record, index): TitleResolution => {
        const result = results[index]
        // readTitleSnapshots returns one result per unique listed id in input
        // order, so a misaligned result is a contract violation.
        /* v8 ignore next -- readTitleSnapshots returns one result per unique listed id in input order */
        if (result === undefined || result.sessionId !== record.header.id) throw new Error(`resume scan misaligned at "${record.header.id}"`)
        if (result.status === 'rejected') return { failure: result.reason }
        const title = result.value.title?.title
        return title === undefined ? {} : { title }
      })
    }
    const resolutions = new Array<TitleResolution>(records.length)
    let cursor = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor
        if (index >= records.length) return
        cursor += 1
        const record = records[index] as SessionRecord
        try {
          const value = await projectedTitle(cache, record, signal)
          resolutions[index] = typeof value === 'string' ? { title: value } : {}
        } catch (failure: unknown) {
          resolutions[index] = { failure }
        }
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(resolved.resumeScanConcurrency, records.length) },
      () => worker(),
    ))
    return resolutions
  }

  /** The latest logged provider/model route, for the preflight availability check. */
  const resumeRoute = (events: readonly SessionEvent[]): { provider: string; model: string } | undefined => {
    const header = events.findLast(item => item.type === 'request/header')
    if (header?.type === 'request/header') {
      return { provider: header.data.header.config.provider, model: header.data.header.config.model }
    }
    const assistant = events.findLast(item => item.type === 'assistant/message')
    return assistant?.type === 'assistant/message'
      ? { provider: assistant.data.message.source.provider, model: assistant.data.message.source.model }
      : undefined
  }

  /**
   * Read the chosen session's full log for preflight, retrying a bounded
   * number of times when the failure looks like a torn frame from a concurrent
   * writer. A filesystem-stable read can still observe a complete frame whose
   * JSONL record was flushed incrementally by another surface; waiting a short
   * moment lets that writer finish before we give up.
   */
  const readSessionEvents = async (
    query: SessionQueryEngine,
    sessionId: SessionId,
  ): Promise<readonly SessionEvent[]> => {
    let lastError: unknown
    for (let attempt = 0; attempt < RESUME_READ_RETRIES; attempt += 1) {
      try {
        return (await query.readSession(sessionId)).events
      } catch (error: unknown) {
        lastError = error
        const message = errorChain(error)
        const retriable = message.includes('complete frame contains a torn JSONL record')
        if (!retriable || attempt === RESUME_READ_RETRIES - 1) throw error
        await new Promise(resolve => setTimeout(resolve, RESUME_READ_RETRY_BASE_MS * 2 ** attempt))
      }
    }
    /* v8 ignore next -- the loop always throws on the final attempt; this is unreachable */
    throw lastError
  }

  /**
   * Re-read every mutable precondition immediately before terminal handoff and
   * resolve the exact identity and workspace the host will re-exec into. This
   * is where the one chosen log is fully read, replay-validated, and checked
   * for a currently-available route — the listing never does any of that.
   */
  const preflightResume = async (sessionId: SessionId): Promise<{ id: SessionId; cwd: string }> => {
    const query = sessionQuery()
    /* v8 ignore start -- showResume alone calls this after proving the optional service exists */
    if (query === undefined) throw new Error('Resume is unavailable: session query is not mounted.')
    /* v8 ignore stop */
    const initialStatus = agent.status
    if (initialStatus !== 'idle') throw new Error(`Resume requires an idle agent (status: ${initialStatus}).`)
    const record = (await query.listSessions()).find(candidate => candidate.header.id === sessionId)
    if (record === undefined) throw new Error(`Session "${sessionId}" is no longer available.`)
    const candidate = summarize(record, undefined, undefined)
    // The picker already disables such rows; only a record that changed
    // between the scan and the preflight can reach this check.
    /* v8 ignore next -- the picker blocks disabled rows before preflight */
    if (candidate.disabledReason !== undefined) throw new Error(candidate.disabledReason)
    let events: readonly SessionEvent[]
    try {
      events = await readSessionEvents(query, record.header.id)
    } catch (error: unknown) {
      const message = errorChain(error)
      if (message.includes('complete frame contains a torn JSONL record')) {
        throw new Error(
          `session cannot be loaded: ${message} `
          + '(if another dsh surface is still using this session, close it before resuming)',
        )
      }
      throw new Error(`session cannot be loaded: ${message}`)
    }
    const route = resumeRoute(events)
    if (route !== undefined && !ctx.llm.listProviders().some(provider => provider.id === route.provider)) {
      throw new Error(`session is complete, but route is currently unavailable (${route.provider}/${route.model})`)
    }
    const cwd = record.header.cwd
    /* v8 ignore next -- summarizeResumeCandidate disables a cwd-less record, so the check above already rejected it */
    if (cwd === undefined) throw new Error(`Session "${sessionId}" has no recorded workspace to resume in.`)
    const finalStatus = agent.status
    // The first status check just ran; only a concurrent activity change can
    // move the agent between the two reads.
    /* v8 ignore next -- the initial idle check runs immediately above */
    if (finalStatus !== 'idle') throw new Error(`Resume requires an idle agent (status: ${finalStatus}).`)
    return { id: record.header.id, cwd }
  }

  const handoffResume = async (candidate: ResumeCandidate, overlay: TuiOverlaySession): Promise<void> => {
    if (resumeInFlight) return
    resumeInFlight = true
    let terminalReleased = false
    try {
      const checked = await preflightResume(candidate.record.header.id)
      const hostHandoff = runtime.handoffResume
      if (hostHandoff === undefined) {
        await overlay.close()
        resumeOverlay = undefined
        deps.appendNotice('Session is resumable, but this host cannot hand it off in place.', 'warning')
        return
      }
      /* v8 ignore next -- shutdown during preflight invalidates an awaited service read or reaches this guard */
      if (deps.isDisposed()) return
      await ctx.sessions.flush(agent.session)
      // Disposal can run while the flush promise is pending; the overlay
      // still owns the keyboard until close(), so the agent cannot leave idle
      // between the preflight check and the terminal release.
      /* v8 ignore next -- shutdown during the flush reaches this guard; the overlay holds input until close() */
      if (deps.isDisposed()) return
      /* v8 ignore next -- preflight re-reads idle and the overlay blocks input until close() */
      if (agent.status !== 'idle') throw new Error(`Resume requires an idle agent (status: ${agent.status}).`)
      await overlay.close()
      resumeOverlay = undefined
      await deps.releaseTerminal()
      terminalReleased = true
      // The host re-execs into the session's own workspace: process cwd, not the
      // restored session header, is what the filesystem and shell tools resolve
      // against.
      await hostHandoff(checked.id, checked.cwd)
      throw new Error('resume host returned without replacing the process')
    } catch (error: unknown) {
      // A shutdown racing the handoff settles it silently.
      /* v8 ignore next -- shutdown during the handoff is covered by owner teardown */
      if (!deps.isDisposed()) {
        if (terminalReleased) {
          deps.reacquireTerminal()
          deps.appendNotice(`Resume handoff failed: ${errorChain(error)}`, 'error')
        } else {
          await overlay.close()
          resumeOverlay = undefined
          deps.appendNotice(`Resume failed: ${errorChain(error)}`, 'error')
        }
      }
    } finally {
      resumeInFlight = false
    }
  }

  return {
    showResume(): void {
      if (agent.status !== 'idle') {
        deps.appendNotice('Resume requires the current turn to finish or be cancelled first.', 'warning')
        return
      }
      const listQuery = sessionQuery()
      if (listQuery === undefined) {
        deps.appendNotice('Resume is not available: session query is not mounted.', 'warning')
        return
      }
      const scan = ++resumeScan
      void resumeOverlay?.close()
      // The picker opens before the scan settles so the terminal stops feeding
      // the editor immediately; a queued activation (the closing predecessor
      // still holds the slot) receives an already-scanned set through
      // `scanned` instead of a loading placeholder.
      let picker: ResumePicker | undefined
      let scanned: ResumeCandidate[] | undefined
      const session = overlayManager.open({
        create: (host) => {
          picker = new ResumePicker(
            scanned,
            resolved.maxResumeOptions,
            workspaceLabel(agent.session.header.cwd),
            () => host.viewport.rows,
            palette,
            (candidate) => { void handoffResume(candidate, session) },
            () => { void session.close() },
          )
          return picker
        },
        options: {
          width: '100%',
          maxHeight: '100%',
          anchor: 'top-left',
          margin: 0,
        },
      })
      resumeOverlay = session
      // Closing the picker — Escape, supersession, disposal — aborts the scan:
      // the borrowed-log pass over a large store must not outlive its overlay.
      const scanAbort = new AbortController()
      void session.closed.then(() => {
        scanAbort.abort()
        /* v8 ignore next -- overlay FIFO closes this session before a replacement can become the tracked resume overlay */
        if (resumeOverlay === session) resumeOverlay = undefined
      })
      deps.requestRender()
      /** Whether this scan's overlay, session generation, or TUI is gone. */
      const scanStale = (): boolean =>
        deps.isDisposed() || scan !== resumeScan || scanAbort.signal.aborted
      const scanCandidates = async (): Promise<void> => {
        // Every workspace in the store is listed; the picker owns the
        // current-workspace/all-workspaces scope split over the whole set.
        const records = await listQuery.listSessions(scanAbort.signal)
        if (scanStale()) return
        // Rows need only metadata, an mtime, and a title — resolved without
        // whole-log reads when the projection cache is mounted. A corrupt
        // neighbor degrades to one disabled row.
        const [titles, activity] = await Promise.all([
          resolveTitles(listQuery, records, scanAbort.signal),
          Promise.all(records.map(record => lastActivityAt(record))),
        ])
        const candidates = records.map((record, index) => {
          const resolution = titles[index] as TitleResolution
          return 'failure' in resolution
            ? unreadableCandidate(record, activity[index], resolution.failure)
            : summarize(record, resolution.title, activity[index])
        })
        // Conversations read top to bottom, oldest first: a fresh session
        // lands at the bottom of the list instead of jumping to the top.
        // Equal activity ties break on the session id.
        candidates.sort((a, b) => a.lastActivityAt - b.lastActivityAt
          || a.record.header.id.localeCompare(b.record.header.id))
        // The cancelled-scan path is pinned by the in-flight cancel test,
        // which asserts the aborted signal and the silent settle.
        /* v8 ignore next -- covered behaviorally by the in-flight cancel test */
        if (scanStale()) return
        scanned = candidates
        picker?.setCandidates(candidates)
        deps.requestRender()
      }
      // One catch covers listing, titles, and mtimes, so a scan failure
      // cannot strand the overlay on its loading placeholder; an aborted
      // scan's rejection stays silent because the user already dismissed the
      // picker.
      void scanCandidates().catch((error: unknown) => {
        if (scanStale()) return
        void session.close()
        deps.appendNotice(`Resume session scan failed: ${errorChain(error)}`, 'error')
      })
    },
  }
}

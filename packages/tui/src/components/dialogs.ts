/**
 * Modal dialogs for the interactive channel: the question panel behind
 * `ask_user_question` and the approval panel behind `approval/request`.
 * @module @deepseek-ai/dsh-tui/components/dialogs
 */

import {
  Component,
  Focusable,
  Input,
  Key,
  SelectList,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type SelectItem,
} from '@earendil-works/pi-tui'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { LlmModelInfo, LlmModelReasoningInfo, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { BRACKETED_PASTE_END, BRACKETED_PASTE_START, displayText, sanitizePastedText } from './text.ts'
import { selectTheme, type Palette } from './theme.ts'

/** One answered question: selected option labels plus optional custom text. */
export interface QuestionSelection {
  selected: string[]
  custom?: string
}

/** The human's decision from one approval dialog. */
export type ApprovalChoice = Extract<ApprovalOutcome, 'allowed-once' | 'rejected' | 'cancelled'>

/** A selectable model advertised by a provider, plus its reasoning metadata. */
export interface ModelChoice extends ModelSelection {
  /** Human-readable model name for the selector row. */
  modelName: string
  description?: string
  reasoning?: LlmModelReasoningInfo
}

/** The provider/model route and effort resolved from a model dialog. */
export interface ModelDialogSelection {
  choice: ModelChoice
  reasoningEffort: ReasoningEffortId | undefined
}

/**
 * Format a provider/model target as its `provider/model` label.
 * @param target - The LLM target.
 * @returns The `provider/model` label.
 */
export function targetLabel(target: ModelSelection): string {
  return `${target.provider}/${target.model}`
}

/**
 * Format a target compactly as its model name with any selected effort appended.
 * @param target - The LLM target.
 * @returns The compact `model [effort]` label.
 */
export function compactTargetLabel(target: ModelSelection): string {
  return `${target.model}${target.reasoningEffort === undefined ? '' : ` ${target.reasoningEffort}`}`
}

/**
 * Resolve the display label for a choice's reasoning effort.
 * @param choice - The model choice carrying advertised reasoning metadata.
 * @param effort - The selected effort, or `undefined` for provider default.
 * @returns The effort's display name, `Default`, or `undefined` when the model has no reasoning metadata.
 */
export function targetReasoningLabel(choice: ModelChoice, effort: ReasoningEffortId | undefined): string | undefined {
  if (effort === undefined) return choice.reasoning === undefined ? undefined : 'Default'
  return choice.reasoning?.efforts.find(candidate => candidate.id === effort)?.name ?? effort
}

/**
 * Derive the agent's initial LLM target from its logged request header or options.
 * @param agent - The driven agent.
 * @returns The initial target, or `undefined` when unset.
 */
export function initialTarget(agent: Agent): ModelSelection | undefined {
  const logged = agent.session.requestHeader()?.config
  if (logged !== undefined) {
    return {
      provider: logged.provider,
      model: logged.model,
      ...logged.reasoningEffort === undefined ? {} : { reasoningEffort: logged.reasoningEffort },
    }
  }
  if (agent.options.provider === undefined || agent.options.model === undefined) return undefined
  return { provider: agent.options.provider, model: agent.options.model }
}

/**
 * List every advertised model across registered providers, appending the current
 * target when a provider does not advertise it.
 * @param ctx - Context supplying the LLM service.
 * @param current - The current target, appended when unadvertised.
 * @returns The model choices, flattened across providers.
 */
export async function readModelChoices(
  ctx: Context,
  current: ModelSelection | undefined,
): Promise<ModelChoice[]> {
  const providers = ctx.llm.listProviders()
  const groups = await Promise.all(providers.map(async (provider) => {
    const advertised = await ctx.llm.listModels(provider.id)
    const models: LlmModelInfo[] = [...advertised]
    if (
      current?.provider === provider.id
      && !models.some(model => model.id === current.model)
    ) {
      models.push({ provider: provider.id, id: current.model, name: current.model })
    }
    return Promise.all(models.map(async (model): Promise<ModelChoice> => {
      const reasoning = (await ctx.llm.resolveModelInfo(provider.id, model.id)).reasoning
      return {
        provider: provider.id,
        model: model.id,
        modelName: model.name,
        ...model.description === undefined ? {} : { description: model.description },
        ...reasoning === undefined ? {} : { reasoning },
      }
    }))
  }))
  return groups.flat()
}

/**
 * Format a diagnostic integer with grouping separators.
 * @param value - the integer to format.
 * @returns the grouped decimal representation.
 */
export function formatDiagnosticNumber(value: number): string {
  return value.toLocaleString('en-US')
}

/**
 * Format a diagnostic timestamp as an ISO date-time in UTC.
 * @param value - Epoch milliseconds.
 * @returns The formatted UTC timestamp.
 */
export function formatDiagnosticTime(value: number): string {
  return new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/u, ' UTC')
}

/**
 * Format a pluralized count for a diagnostic row.
 * @param value - Count.
 * @param singular - Singular noun; an `s` is appended for other counts.
 * @returns The formatted count.
 */
export function formatDiagnosticCount(value: number, singular: string): string {
  return `${String(value)} ${singular}${value === 1 ? '' : 's'}`
}

/**
 * Render a fixed-width filled meter bar for a percentage.
 * @param percent - Percentage in [0, 100].
 * @param palette - Active role palette.
 * @returns The rendered meter.
 */
export function diagnosticMeter(percent: number, palette: Palette): string {
  const width = 16
  const filled = Math.round(Math.min(100, Math.max(0, percent)) / 100 * width)
  return `${palette.dim('[')}${palette.accent('█'.repeat(filled))}${palette.dim(`${'░'.repeat(width - filled)}]`)}`
}

/** One `label: value` row of a status card group. */
export type StatusCardRow = readonly [label: string, value: string]

/** Bordered, grouped field card for one point-in-time status snapshot. */
export class StatusCardComponent implements Component {
  constructor(
    private readonly groups: readonly (readonly StatusCardRow[])[],
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const labels = this.groups.flatMap(group => group.map(([label]) => `${label}:`))
    const naturalLabelWidth = Math.max(...labels.map(label => label.length))
    const naturalBodyWidth = Math.max(...this.groups.flatMap(group => group.map(([, value]) =>
      1 + naturalLabelWidth + 2 + visibleWidth(value))))
    const cardWidth = Math.min(
      Math.max(8, width),
      Math.max('Session status'.length + 5, naturalBodyWidth + 4),
    )
    const innerWidth = Math.max(1, cardWidth - 4)
    const labelWidth = Math.min(
      naturalLabelWidth,
      Math.max(1, Math.floor(innerWidth / 3)),
    )
    const body: string[] = []
    for (const [groupIndex, group] of this.groups.entries()) {
      if (groupIndex > 0) body.push('')
      for (const [label, value] of group) {
        const plainLabel = truncateToWidth(`${label}:`, labelWidth, '')
        const prefix = ` ${this.palette.dim(plainLabel.padEnd(labelWidth))}  `
        const continuation = ' '.repeat(1 + labelWidth + 2)
        const valueWidth = Math.max(1, innerWidth - visibleWidth(prefix))
        const wrapped = wrapTextWithAnsi(value, valueWidth)
        for (const [lineIndex, line] of wrapped.entries()) {
          body.push(`${lineIndex === 0 ? prefix : continuation}${line}`)
        }
      }
    }

    const title = truncateToWidth('Session status', Math.max(1, cardWidth - 5), '')
    const topTail = '─'.repeat(Math.max(0, cardWidth - visibleWidth(title) - 5))
    const top = `${this.palette.dim('╭─ ')}${this.palette.bold(this.palette.accent(title))}${this.palette.dim(` ${topTail}╮`)}`
    const lines = [top]
    for (const line of body) {
      lines.push(`${this.palette.dim('│')} ${padRow(line, innerWidth)} ${this.palette.dim('│')}`)
    }
    lines.push(this.palette.dim(`╰${'─'.repeat(Math.max(0, cardWidth - 2))}╯`))
    return lines
  }
}

/**
 * Clip one dialog row to the inner width, pad it to the full inner width, and
 * flank it with symmetric outer padding — the shared row-fitting idiom behind
 * the bordered dialogs and the full-width question/approval panels.
 * @param line - Row text (may carry SGR styling).
 * @param innerWidth - Target visible width of the clipped+padded row.
 * @param outerPad - Blank columns added on each side of the row.
 * @param ellipsis - Marker appended when the row clips (empty for hard cuts).
 * @returns The fitted row, exactly `innerWidth + 2 * outerPad` columns wide.
 */
function padRow(line: string, innerWidth: number, outerPad = 0, ellipsis = ''): string {
  const bounded = truncateToWidth(line, innerWidth, ellipsis)
  const pad = ' '.repeat(Math.max(0, innerWidth - visibleWidth(bounded)))
  const outer = ' '.repeat(outerPad)
  return `${outer}${bounded}${pad}${outer}`
}

/**
 * Render a bordered dialog frame around body lines with a titled top edge.
 * @param title - Dialog title shown in the top border.
 * @param body - Body lines.
 * @param width - Dialog width in columns.
 * @param palette - Active role palette.
 * @returns The framed dialog lines.
 */
export function renderDialog(
  title: string,
  body: readonly string[],
  width: number,
  palette: Palette,
): string[] {
  const innerWidth = Math.max(1, width - 4)
  const topLabel = ` ${displayText(title)} `
  const top = `╭${topLabel}${'─'.repeat(Math.max(0, width - visibleWidth(topLabel) - 2))}╮`
  const lines: string[] = [palette.accent(top)]
  for (const line of body) {
    lines.push(`${palette.accent('│')} ${padRow(line, innerWidth)} ${palette.accent('│')}`)
  }
  lines.push(palette.accent(`╰${'─'.repeat(Math.max(0, width - 2))}╯`))
  return lines
}

/** Keyboard model selector rendered as a bordered overlay, with a filter box and per-model reasoning-effort cycling. */
export class ModelDialog implements Component {
  private list: SelectList
  private readonly filter = new Input()
  private readonly items: Map<string, SelectItem>
  private readonly choices: Map<string, ModelChoice>
  private readonly efforts: Map<string, ReasoningEffortId | undefined>
  private readonly currentValue: string | undefined

  constructor(
    choices: readonly ModelChoice[],
    current: ModelSelection | undefined,
    private readonly maxVisible: number,
    private readonly palette: Palette,
    private readonly done: (selection: ModelDialogSelection) => void,
    private readonly cancel: () => void,
  ) {
    this.items = new Map()
    this.choices = new Map()
    this.efforts = new Map()
    this.currentValue = current === undefined ? undefined : targetLabel(current)
    for (const choice of choices) {
      const value = targetLabel(choice)
      const isCurrent = current?.provider === choice.provider && current.model === choice.model
      this.choices.set(value, choice)
      this.efforts.set(
        value,
        isCurrent
          ? current.reasoningEffort ?? choice.reasoning?.defaultEffort
          : choice.reasoning?.defaultEffort,
      )
      this.items.set(value, {
        value,
        label: displayText(value),
        description: this.describeChoice(choice, isCurrent),
      })
    }
    this.list = this.buildList(this.currentValue)
  }

  /** Build a SelectList over the currently filtered items, selecting `selectValue` when present. */
  private buildList(selectValue: string | undefined): SelectList {
    const items = this.filteredItems()
    const list = new SelectList(items, this.maxVisible, selectTheme(this.palette))
    const index = selectValue === undefined ? 0 : items.findIndex(item => item.value === selectValue)
    list.setSelectedIndex(Math.max(0, index))
    list.onSelect = (item) => { this.confirm(item) }
    list.onCancel = this.cancel
    return list
  }

  /** Items matching the filter box, as a case-insensitive substring over the label, model name, and description. */
  private filteredItems(): SelectItem[] {
    const query = this.filter.getValue().trim().toLocaleLowerCase()
    if (query === '') return [...this.items.values()]
    return [...this.items.values()].filter((item) => {
      const choice = this.choices.get(item.value)
      /* v8 ignore next -- items and choices share the same keys. */
      if (choice === undefined) return false
      return [item.value, choice.modelName, choice.description ?? '']
        .some(field => field.toLocaleLowerCase().includes(query))
    })
  }

  private confirm(item: SelectItem): void {
    const selected = this.choices.get(item.value)
    /* v8 ignore next -- SelectList only returns values built from `choices`. */
    if (selected === undefined) return
    this.done({ choice: selected, reasoningEffort: this.efforts.get(item.value) })
  }

  private describeChoice(choice: ModelChoice, isCurrent: boolean): string {
    const effortLabel = targetReasoningLabel(choice, this.efforts.get(targetLabel(choice)))
    return [
      displayText(choice.modelName),
      ...choice.description === undefined ? [] : [displayText(choice.description)],
      ...effortLabel === undefined ? [] : [displayText(effortLabel)],
      ...isCurrent ? ['current'] : [],
    ].join(' — ')
  }

  private cycleReasoningEffort(): void {
    const selectedItem = this.list.getSelectedItem()
    /* v8 ignore next -- the dialog is opened only for a non-empty catalog. */
    if (selectedItem === null) return
    const choice = this.choices.get(selectedItem.value)
    if (choice?.reasoning === undefined) return
    const current = this.efforts.get(selectedItem.value)
    const efforts: Array<ReasoningEffortId | undefined> = [
      ...choice.reasoning.defaultEffort === undefined ? [undefined] : [],
      ...choice.reasoning.efforts.map(effort => effort.id),
    ]
    const currentIndex = efforts.indexOf(current)
    const next = efforts[(currentIndex + 1) % efforts.length]
    this.efforts.set(selectedItem.value, next)
    const item = this.items.get(selectedItem.value)
    /* v8 ignore next -- items and choices are constructed from the same values. */
    if (item === undefined) return
    item.description = this.describeChoice(choice, selectedItem.value === this.currentValue)
  }

  invalidate(): void {
    this.filter.invalidate()
    this.list.invalidate()
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.shift(Key.tab))) {
      this.cycleReasoningEffort()
    } else if (matchesKey(data, Key.escape)) {
      if (this.filter.getValue() === '') this.cancel()
      else {
        this.filter.setValue('')
        this.list = this.buildList(undefined)
      }
    } else if (
      matchesKey(data, Key.up)
      || matchesKey(data, Key.down)
      || matchesKey(data, Key.enter)
    ) {
      this.list.handleInput(data)
    } else {
      const previous = this.filter.getValue()
      this.filter.focused = true
      this.filter.handleInput(data)
      if (this.filter.getValue() !== previous) {
        const selected = this.list.getSelectedItem()
        this.list = this.buildList(selected?.value)
      }
    }
    this.invalidate()
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 4)
    this.filter.focused = true
    const results = this.filteredItems()
    const filterContent = truncateToWidth(this.filter.render(innerWidth).join(''), innerWidth, '')
    return renderDialog('Select model', [
      filterContent,
      '',
      ...results.length === 0
        ? [this.palette.dim('  No models match the filter')]
        : this.list.render(innerWidth),
      '',
      this.palette.dim('type to filter • ↑/↓ move • Shift+Tab reasoning • Enter select • Esc'),
    ], width, this.palette)
  }
}

/** One preset roster row surfaced in the preset selector. */
export interface PresetChoice {
  /** Preset id (the roster directory name). */
  id: string
  /** Display name from the preset metadata; absent falls back to the id. */
  label: string
  /** Optional metadata description. */
  description?: string
  /** Where the preset ships from: the deployment or the user's home. */
  trust: 'system' | 'user'
  /** Discovery-reported reason the preset cannot compose; selecting it still fails on mount. */
  broken?: string
}

/** Keyboard agent-preset selector: a bordered list over the roster with the current preset marked. */
export class PresetDialog implements Component {
  private list: SelectList
  private readonly items: Map<string, SelectItem>

  constructor(
    choices: readonly PresetChoice[],
    current: string | undefined,
    maxVisible: number,
    private readonly palette: Palette,
    private readonly done: (id: string) => void,
    private readonly cancel: () => void,
  ) {
    this.items = new Map()
    for (const choice of choices) {
      this.items.set(choice.id, {
        value: choice.id,
        label: displayText(choice.label),
        description: [
          choice.trust === 'user' ? 'user' : 'shipped',
          ...choice.broken === undefined ? [] : [`broken: ${choice.broken}`],
          ...choice.description === undefined ? [] : [choice.description],
          ...choice.id === current ? ['current'] : [],
        ].join(' — '),
      })
    }
    const items = [...this.items.values()]
    this.list = new SelectList(items, maxVisible, selectTheme(this.palette))
    const index = current === undefined ? 0 : items.findIndex(item => item.value === current)
    this.list.setSelectedIndex(Math.max(0, index))
    this.list.onSelect = (item) => { this.done(item.value) }
    this.list.onCancel = this.cancel
  }

  invalidate(): void {
    this.list.invalidate()
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.cancel()
    } else if (
      matchesKey(data, Key.up)
      || matchesKey(data, Key.down)
      || matchesKey(data, Key.enter)
    ) {
      this.list.handleInput(data)
    }
    this.invalidate()
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 4)
    return renderDialog('Select agent preset', [
      ...this.list.render(innerWidth),
      '',
      this.palette.dim('↑/↓ move • Enter select • Esc'),
    ], width, this.palette)
  }
}

/** A resume selector row summarizing one session from metadata and its folded title. */
export interface ResumeCandidate {
  record: SessionRecord
  title: string
  /** Last observed change: live last-event time or artifact mtime, falling back to creation. */
  lastActivityAt: number
  /** Whether the session's workspace is the one the current session runs in, which selects the picker scope that lists it. */
  currentWorkspace: boolean
  /** The session's own workspace as a prompt-style label; the all-workspaces scope shows it per row. */
  workspaceLabel: string
  disabledReason?: string
}

/**
 * Build one resume selector row from a record, its batch-folded title, and a
 * metadata-derived activity time, deriving the workspace scope and any reason
 * the session cannot be resumed here.
 * @param record - The session record.
 * @param title - The session's batch-folded title, absent for an untitled log.
 * @param lastActivityAt - Metadata activity time; absent falls back to the header's creation time.
 * @param currentId - The current session id.
 * @param cwd - The CURRENT session's workspace, which decides the picker scope this row falls in.
 * @param formatWorkspace - Renders THIS record's own cwd as its prompt-style label.
 * @returns The summarized resume candidate.
 */
export function summarizeResumeCandidate(
  record: SessionRecord,
  title: string | undefined,
  lastActivityAt: number | undefined,
  currentId: SessionId,
  cwd: string | undefined,
  formatWorkspace: (cwd: string | undefined) => string,
): ResumeCandidate {
  let disabledReason: string | undefined
  if (record.header.id === currentId) disabledReason = 'current session'
  else if (record.live) disabledReason = 'session is already live in this runtime'
  else if (record.header.cwd === undefined) disabledReason = 'session has no recorded workspace'
  return {
    record,
    title: title ?? 'Untitled session',
    lastActivityAt: lastActivityAt ?? record.header.createdAt,
    currentWorkspace: record.header.cwd === cwd,
    workspaceLabel: formatWorkspace(record.header.cwd),
    ...disabledReason === undefined ? {} : { disabledReason },
  }
}

/** Which workspaces the resume picker currently lists. */
export type ResumeScope = 'workspace' | 'all'

/** Full-viewport keyboard selector over detached, preflighted resume summaries. */
export class ResumePicker implements Component, Focusable {
  private readonly search = new Input()
  private pasteBuffer: string | undefined
  private selectedIndex = 0
  private error = ''
  private scope: ResumeScope = 'workspace'
  private candidates: readonly ResumeCandidate[] | undefined
  focused = false

  constructor(
    candidates: readonly ResumeCandidate[] | undefined,
    private readonly maxVisible: number,
    private readonly workspaceLabel: string,
    private readonly viewportRows: () => number,
    private readonly palette: Palette,
    private readonly done: (candidate: ResumeCandidate) => void,
    private readonly cancel: () => void,
  ) {
    this.candidates = candidates
  }

  invalidate(): void {
    this.search.invalidate()
  }

  /**
   * Replace the loading placeholder with the scanned candidate set.
   * @param candidates - The summarized rows the finished scan produced.
   */
  setCandidates(candidates: readonly ResumeCandidate[]): void {
    this.candidates = candidates
    this.selectedIndex = 0
    // A still-loading error is false the moment rows exist.
    this.error = ''
    this.invalidate()
  }

  /** Candidates in the active scope, before the search query narrows them. */
  private scoped(): ResumeCandidate[] {
    const candidates = this.candidates ?? []
    return this.scope === 'all'
      ? [...candidates]
      : candidates.filter(candidate => candidate.currentWorkspace)
  }

  private filtered(): ResumeCandidate[] {
    const query = this.search.getValue().trim().toLocaleLowerCase()
    const scoped = this.scoped()
    if (query === '') return scoped
    return scoped.filter(candidate => candidate.title.toLocaleLowerCase().includes(query)
      || candidate.record.header.id.toLocaleLowerCase().includes(query)
      || (this.scope === 'all' && candidate.workspaceLabel.toLocaleLowerCase().includes(query)))
  }

  private visibleCandidateCount(): number {
    const rowHeight = this.scope === 'all' ? 4 : 3
    const candidateBudget = Math.max(1, Math.floor((Math.max(1, this.viewportRows()) - 13) / rowHeight))
    return Math.min(this.maxVisible, candidateBudget)
  }

  private handleBracketedPaste(data: string): boolean {
    const start = data.indexOf(BRACKETED_PASTE_START)
    if (this.pasteBuffer === undefined && start < 0) return false
    if (this.pasteBuffer === undefined) {
      const prefix = data.slice(0, start)
      if (prefix !== '') this.handleInput(prefix)
      this.pasteBuffer = data.slice(start + BRACKETED_PASTE_START.length)
    } else {
      this.pasteBuffer += data
    }
    const end = this.pasteBuffer.indexOf(BRACKETED_PASTE_END)
    if (end < 0) return true
    const pasted = sanitizePastedText(this.pasteBuffer.slice(0, end))
    const remaining = this.pasteBuffer.slice(end + BRACKETED_PASTE_END.length)
    this.pasteBuffer = undefined
    const previous = this.search.getValue()
    this.search.handleInput(`${BRACKETED_PASTE_START}${pasted}${BRACKETED_PASTE_END}`)
    if (this.search.getValue() !== previous) {
      this.selectedIndex = 0
      this.error = ''
    }
    if (remaining !== '') this.handleInput(remaining)
    this.invalidate()
    return true
  }

  handleInput(data: string): void {
    if (this.handleBracketedPaste(data)) return
    const filtered = this.filtered()
    if (matchesKey(data, Key.ctrl('c'))) {
      this.cancel()
      return
    }
    if (matchesKey(data, Key.escape)) {
      if (this.search.getValue() === '') this.cancel()
      else {
        this.search.setValue('')
        this.selectedIndex = 0
        this.error = ''
      }
    } else if (matchesKey(data, Key.up)) {
      this.selectedIndex = filtered.length === 0
        ? 0
        : (this.selectedIndex + filtered.length - 1) % filtered.length
    } else if (matchesKey(data, Key.down)) {
      this.selectedIndex = filtered.length === 0 ? 0 : (this.selectedIndex + 1) % filtered.length
    } else if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.visibleCandidateCount())
    } else if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(
        Math.max(0, filtered.length - 1),
        this.selectedIndex + this.visibleCandidateCount(),
      )
    } else if (matchesKey(data, Key.tab)) {
      this.scope = this.scope === 'workspace' ? 'all' : 'workspace'
      this.search.setValue('')
      this.selectedIndex = 0
      this.error = ''
    } else if (matchesKey(data, Key.enter)) {
      const selected = filtered[this.selectedIndex]
      if (this.candidates === undefined) this.error = 'Sessions are still loading.'
      else if (selected === undefined) this.error = 'No session matches this search.'
      else if (selected.disabledReason !== undefined) this.error = selected.disabledReason
      else this.done(selected)
    } else {
      const previous = this.search.getValue()
      this.search.focused = this.focused
      this.search.handleInput(data)
      if (this.search.getValue() !== previous) {
        this.selectedIndex = 0
        this.error = ''
      }
    }
    this.invalidate()
  }

  /**
   * The scope line under the search box: the active scope with the current
   * workspace it means, and the inactive scope with the count Tab would reveal.
   */
  private renderScopeLine(): string {
    const candidates = this.candidates ?? []
    const inWorkspace = candidates.filter(candidate => candidate.currentWorkspace).length
    const active = this.scope === 'workspace'
      ? `this workspace ${displayText(this.workspaceLabel)}`
      : `all workspaces (${candidates.length})`
    const other = this.scope === 'workspace'
      ? `all workspaces (${candidates.length})`
      : `this workspace (${inWorkspace})`
    return `${this.palette.accent(active)}${this.palette.dim(`  ⇥ ${other}`)}`
  }

  render(width: number): string[] {
    this.search.focused = this.focused
    const height = Math.max(1, this.viewportRows())
    const horizontalPadding = width >= 12 ? 2 : 0
    const contentWidth = Math.max(1, width - horizontalPadding * 2)
    const indent = ' '.repeat(horizontalPadding)
    const filtered = this.filtered()
    if (this.selectedIndex >= filtered.length) this.selectedIndex = Math.max(0, filtered.length - 1)
    const selected = filtered[this.selectedIndex]
    const position = selected === undefined ? 0 : this.selectedIndex + 1
    const title = this.candidates === undefined
      ? 'Resume session'
      : `Resume session (${position} of ${filtered.length})`
    const lines: string[] = [
      '',
      `${indent}${this.palette.bold(this.palette.accent(title))}`,
      '',
    ]

    const searchInnerWidth = Math.max(1, contentWidth - 4)
    lines.push(`${indent}${this.palette.dim(`╭${'─'.repeat(Math.max(0, contentWidth - 2))}╮`)}`)
    const searchContent = this.search.render(searchInnerWidth).join('').replace(/^> /u, '⌕ ')
    const clippedSearch = truncateToWidth(searchContent, searchInnerWidth, '')
    lines.push(
      `${indent}${this.palette.dim('│')} ${clippedSearch}${' '.repeat(Math.max(0, searchInnerWidth - visibleWidth(clippedSearch)))} ${this.palette.dim('│')}`,
      `${indent}${this.palette.dim(`╰${'─'.repeat(Math.max(0, contentWidth - 2))}╯`)}`,
      '',
      `${indent}${this.renderScopeLine()}`,
      '',
    )

    const visibleCount = this.visibleCandidateCount()
    const start = Math.max(0, Math.min(
      this.selectedIndex - Math.floor(visibleCount / 2),
      filtered.length - visibleCount,
    ))
    const end = Math.min(filtered.length, start + visibleCount)
    const push = (line: string): void => {
      lines.push(`${indent}${truncateToWidth(line, contentWidth, '…')}`)
    }
    for (let index = start; index < end; index += 1) {
      const candidate = filtered[index] as ResumeCandidate
      const active = index === this.selectedIndex
      const status = [
        candidate.disabledReason === 'current session' ? 'current' : undefined,
        candidate.record.live ? 'live' : undefined,
        candidate.record.persisted ? 'persisted' : undefined,
      ].filter((value): value is string => value !== undefined).join(' · ')
      const lead = `${active ? '❯' : ' '} ${displayText(candidate.title)}`
      push(active ? this.palette.bold(this.palette.accent(lead)) : lead)
      push(this.palette.dim(`  ${new Date(candidate.lastActivityAt).toISOString()} · ${status} · ${displayText(candidate.record.header.id)}`))
      if (this.scope === 'all') {
        push(this.palette.dim(`  workspace ${displayText(candidate.workspaceLabel)}`))
      }
      if (candidate.disabledReason !== undefined) {
        push(this.palette.warning(`  unavailable: ${displayText(candidate.disabledReason)}`))
      }
    }
    if (this.candidates === undefined) push(this.palette.dim('Loading sessions…'))
    else if (filtered.length === 0) push(this.palette.warning('No matching sessions.'))
    if (this.error !== '') {
      lines.push('')
      push(this.palette.error(displayText(this.error)))
    }

    const footer = `${indent}${this.palette.dim('Type to search  •  ↑/↓ navigate  •  Tab scope  •  Enter resume  •  Esc clear/cancel')}`
    while (lines.length < height - 2) lines.push('')
    lines.push(footer, '')
    return lines.slice(0, height)
  }
}

interface SelectedBlockPage {
  offset: number
  size: number
  maxOffset: number
}

/** Inline dialog for one user question with option or custom-answer modes. */
export class QuestionDialog implements Component, Focusable {
  private selectedIndex = 0
  private selected = new Set<number>()
  private headerPage: SelectedBlockPage = { offset: 0, size: 1, maxOffset: 0 }
  private selectedBlockPage: SelectedBlockPage = { offset: 0, size: 1, maxOffset: 0 }
  private mode: 'options' | 'custom'
  private error = ''
  private readonly input = new Input()
  private readonly options: NonNullable<AskUserQuestionItem['options']>
  focused = false

  constructor(
    private readonly question: AskUserQuestionItem,
    private readonly position: number,
    private readonly total: number,
    private readonly unanswered: number,
    private readonly maxVisible: number,
    private readonly maxHeight: () => number,
    private readonly palette: Palette,
    private readonly done: (selection: QuestionSelection) => void,
    private readonly cancel: () => void,
  ) {
    this.options = question.options ?? []
    this.mode = this.options.length > 0 ? 'options' : 'custom'
    this.input.onSubmit = (value) => { this.submitCustom(value) }
    this.input.onEscape = () => {
      if (this.options.length > 0) {
        this.mode = 'options'
        this.error = ''
      } else {
        this.cancel()
      }
    }
  }

  invalidate(): void {
    this.input.invalidate()
  }

  handleInput(data: string): void {
    this.invalidate()
    if (matchesKey(data, Key.pageUp)) {
      this.pageBackward()
      return
    }
    if (matchesKey(data, Key.pageDown)) {
      this.pageForward()
      return
    }
    if (this.mode === 'custom') {
      this.input.focused = this.focused
      this.input.handleInput(data)
      return
    }
    const options = this.options
    if (matchesKey(data, Key.up)) {
      this.selectedBlockPage = { offset: 0, size: 1, maxOffset: 0 }
      this.selectedIndex = this.selectedIndex === 0 ? options.length - 1 : this.selectedIndex - 1
    } else if (matchesKey(data, Key.down)) {
      this.selectedBlockPage = { offset: 0, size: 1, maxOffset: 0 }
      this.selectedIndex = this.selectedIndex === options.length - 1 ? 0 : this.selectedIndex + 1
    } else if (matchesKey(data, Key.space) && this.question.multiSelect) {
      if (this.selected.has(this.selectedIndex)) this.selected.delete(this.selectedIndex)
      else this.selected.add(this.selectedIndex)
    } else if (matchesKey(data, Key.enter)) {
      const selected = this.question.multiSelect
        ? this.selectedOptionLabels()
        : [options[this.selectedIndex]?.label].filter((label): label is string => label !== undefined)
      const custom = this.question.multiSelect ? this.input.getValue().trim() : ''
      if (selected.length === 0 && custom === '') {
        this.error = 'Select at least one option, or press Tab for a custom answer.'
        return
      }
      this.done({ selected, ...(custom === '' ? {} : { custom }) })
    } else if (matchesKey(data, Key.tab) || data.toLowerCase() === 'c') {
      this.mode = 'custom'
      this.selectedBlockPage = { offset: 0, size: 1, maxOffset: 0 }
      this.error = ''
    } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.cancel()
    }
  }

  private submitCustom(value: string): void {
    const custom = value.trim()
    if (custom === '') {
      this.error = 'Enter an answer before submitting.'
      return
    }
    this.done({
      selected: this.question.multiSelect ? this.selectedOptionLabels() : [],
      custom,
    })
  }

  private selectedOptionLabels(): string[] {
    return [...this.selected]
      .sort((a, b) => a - b)
      .map(index => this.options[index]?.label)
      .filter((label): label is string => label !== undefined)
  }

  /** Page backward through an oversized option, then through question detail. */
  private pageBackward(): void {
    if (this.mode === 'options' && this.selectedBlockPage.offset > 0) {
      this.selectedBlockPage = {
        ...this.selectedBlockPage,
        offset: Math.max(0, this.selectedBlockPage.offset - this.selectedBlockPage.size),
      }
      return
    }
    this.headerPage = {
      ...this.headerPage,
      offset: Math.max(0, this.headerPage.offset - this.headerPage.size),
    }
  }

  /** Page forward through question detail, then through an oversized option. */
  private pageForward(): void {
    if (this.headerPage.offset < this.headerPage.maxOffset) {
      this.headerPage = {
        ...this.headerPage,
        offset: Math.min(
          this.headerPage.maxOffset,
          this.headerPage.offset + this.headerPage.size,
        ),
      }
      return
    }
    if (this.mode === 'custom') return
    this.selectedBlockPage = {
      ...this.selectedBlockPage,
      offset: Math.min(
        this.selectedBlockPage.maxOffset,
        this.selectedBlockPage.offset + this.selectedBlockPage.size,
      ),
    }
  }

  render(width: number): string[] {
    this.input.focused = this.focused
    const horizontalPadding = Math.min(2, Math.max(0, Math.floor((width - 1) / 2)))
    const innerWidth = Math.max(1, width - horizontalPadding * 2)
    const header = `Question ${this.position}/${this.total} (${this.unanswered} unanswered)${this.question.header === undefined ? '' : ` · ${displayText(this.question.header)}`}`
    const questionLines = wrapTextWithAnsi(
      this.palette.text(displayText(this.question.question)),
      innerWidth,
    )
    const contentLines = [...questionLines]
    const headerLines: string[] = [
      ...wrapTextWithAnsi(this.palette.dim(header), innerWidth),
      ...questionLines,
    ]
    // Supporting detail (e.g. the full plan under review) renders between the
    // question and the answer surface, kept out of option labels.
    if (this.question.detail !== undefined) {
      headerLines.push('')
      contentLines.push('')
      for (const line of wrapTextWithAnsi(displayText(this.question.detail), innerWidth)) {
        headerLines.push(line)
        contentLines.push(line)
      }
    }
    headerLines.push('')

    const customControls = [
      ...(this.options.length > 0 && this.question.multiSelect ? [`${this.selected.size} selected`] : []),
      'Enter submit',
      this.options.length > 0 ? 'Esc options' : 'Esc cancel',
    ]
    const customHint = this.palette.dim(customControls.join(' • '))
    const footerLines: string[] = []
    if (this.mode === 'custom') {
      for (const line of this.input.render(innerWidth)) footerLines.push(line)
      for (const line of wrapTextWithAnsi(customHint, innerWidth)) footerLines.push(line)
    } else {
      const controls = [
        'Tab custom answer',
        ...(this.options.length > 1 ? ['↑/↓ navigate'] : []),
        ...(this.question.multiSelect ? ['Space toggle'] : []),
        'Enter submit',
        'Esc interrupt',
      ]
      const hint = this.palette.dim(controls.join(' • '))
      for (const line of wrapTextWithAnsi(hint, innerWidth)) footerLines.push(line)
    }
    if (this.error) {
      for (const line of wrapTextWithAnsi(this.palette.error(this.error), innerWidth)) footerLines.push(line)
    }
    const positionLines = this.mode === 'options' && this.options.length > this.maxVisible
      ? [this.palette.dim(`${this.selectedIndex + 1}/${this.options.length}`)]
      : []

    // Options receive only the rows left after fixed chrome and outer padding.
    // The final height window handles fixed chrome that cannot fit even alone.
    const paddingRows = 2
    const maxHeight = this.maxHeight()
    const availableForOptions = Math.max(
      this.mode === 'options' ? 4 : 1,
      maxHeight - paddingRows - headerLines.length - positionLines.length - footerLines.length,
    )

    const body: string[] = [...headerLines]
    const optionLines: string[] = []
    if (this.mode === 'custom') {
      for (const line of footerLines) body.push(line)
    } else {
      const optionBlocks = this.options.map((option, index) => this.renderOptionBlock(option, index, innerWidth))
      const { visibleBlocks, hiddenBefore, hiddenAfter } = this.windowBlocks(optionBlocks, availableForOptions, innerWidth)
      if (hiddenBefore > 0) optionLines.push(this.palette.dim(`↑ ${hiddenBefore} more`))
      for (const block of visibleBlocks) {
        for (const line of block) optionLines.push(line)
      }
      if (hiddenAfter > 0) optionLines.push(this.palette.dim(`↓ ${hiddenAfter} more`))
      for (const line of optionLines) body.push(line)
      for (const line of positionLines) body.push(line)
      for (const line of footerLines) body.push(line)
    }

    const rows = ['', ...body, '']
    let visibleRows = rows
    if (rows.length <= maxHeight) this.headerPage = { offset: 0, size: 1, maxOffset: 0 }
    if (rows.length > maxHeight && this.mode === 'options' && maxHeight >= 6) {
      const headerBudget = Math.max(
        0,
        maxHeight - optionLines.length - (this.error === '' ? 1 : 2),
      )
      const compactFooter = [
        ...this.error === ''
          ? []
          : [truncateToWidth(this.palette.error(`Error: ${this.error}`), innerWidth, '…')],
        this.compactOptionControls(
          innerWidth,
          headerBudget === 1 && contentLines.length > headerBudget,
        ),
      ]
      const compactHeader = this.compactQuestionHeader(contentLines, headerBudget, innerWidth)
      visibleRows = [...compactHeader, ...optionLines, ...compactFooter]
    } else if (rows.length > maxHeight && this.mode === 'custom' && maxHeight >= 2) {
      const compactFooterSource = [
        ...this.input.render(innerWidth),
        this.compactCustomControls(innerWidth),
        ...this.error === ''
          ? []
          : [truncateToWidth(this.palette.error(this.error), innerWidth, '…')],
      ]
      const footerBudget = Math.max(1, maxHeight - 1)
      const compactFooter = compactFooterSource.length <= footerBudget
        ? compactFooterSource
        : footerBudget === 1
          ? compactFooterSource.slice(0, 1)
          : [
            ...compactFooterSource.slice(0, 1),
            ...compactFooterSource.slice(-(footerBudget - 1)),
          ]
      const compactHeader = this.compactQuestionHeader(
        contentLines,
        Math.max(0, maxHeight - compactFooter.length),
        innerWidth,
      )
      visibleRows = [...compactHeader, ...compactFooter]
    }
    if (visibleRows.length > maxHeight) {
      visibleRows = maxHeight === 1
        ? [this.palette.dim(`↑ ${visibleRows.length} lines hidden`)]
        : [
          this.palette.dim(`↑ ${visibleRows.length - maxHeight + 1} lines hidden`),
          ...visibleRows.slice(-(maxHeight - 1)),
        ]
    }
    return visibleRows.map((line) => padRow(line, innerWidth, horizontalPadding, '…'))
  }

  /** Render one option as wrapped label and indented description lines. */
  private renderOptionBlock(
    option: NonNullable<AskUserQuestionItem['options']>[number],
    index: number,
    innerWidth: number,
  ): string[] {
    const cursor = index === this.selectedIndex ? '›' : ' '
    const number = `${index + 1}. `
    const mark = this.question.multiSelect
      ? this.selected.has(index) ? '[x] ' : '[ ] '
      : ''
    const labelPrefixPlain = ` ${cursor} ${number}${mark}`
    const labelPrefixWidth = visibleWidth(labelPrefixPlain)
    const labelBodyWidth = Math.max(1, innerWidth - labelPrefixWidth)
    const labelLines = wrapTextWithAnsi(displayText(option.label), labelBodyWidth)
    const continuation = ' '.repeat(labelPrefixWidth)
    const lines: string[] = []
    for (const [lineIndex, labelLine] of labelLines.entries()) {
      const prefix = lineIndex === 0 ? labelPrefixPlain : continuation
      const composed = `${prefix}${labelLine}`
      lines.push(index === this.selectedIndex ? this.palette.bold(this.palette.accent(composed)) : composed)
    }
    if (option.description !== undefined) {
      const descIndent = ' '.repeat(labelPrefixWidth)
      const descBodyWidth = Math.max(1, innerWidth - labelPrefixWidth)
      const descLines = wrapTextWithAnsi(displayText(option.description), descBodyWidth)
      for (const descLine of descLines) lines.push(`${descIndent}${this.palette.dim(descLine)}`)
    }
    return lines
  }

  /** Keep the question visible when fixed chrome must be compacted. */
  private compactQuestionHeader(
    contentLines: readonly string[],
    budget: number,
    innerWidth: number,
  ): string[] {
    /* v8 ignore next 2 -- a zero budget leaves no rows for the header at all. */
    if (budget <= 0) return []
    if (contentLines.length <= budget) {
      this.headerPage = { offset: 0, size: 1, maxOffset: 0 }
      return [...contentLines]
    }
    const pageSize = Math.max(1, budget - 1)
    const maxOffset = Math.max(0, contentLines.length - pageSize)
    const offset = Math.min(this.headerPage.offset, maxOffset)
    this.headerPage = { offset, size: pageSize, maxOffset }
    const keptLines = contentLines.slice(offset, offset + pageSize)
    if (budget === 1) {
      // A page is non-empty because pageSize is one and offset is clamped inside contentLines.
      return [keptLines[0] as string]
    }
    return [
      ...keptLines,
      this.pagerStatus(offset + 1, offset + keptLines.length, contentLines.length, innerWidth),
    ]
  }

  /** Keep Page Up / Page Down discoverable when a full pager status cannot fit. */
  private pagerStatus(first: number, last: number, total: number, innerWidth: number): string {
    const full = `… lines ${first}-${last}/${total} • PgUp/PgDn`
    const compact = `PgUp/PgDn ${first}/${total}`
    return this.palette.dim(truncateToWidth(
      visibleWidth(full) <= innerWidth ? full : compact,
      innerWidth,
      '…',
    ))
  }

  /** Render custom-mode controls on one row when the header must compact. */
  private compactCustomControls(innerWidth: number): string {
    const controls = this.options.length > 0
      ? 'Enter submit • Esc options'
      : 'Enter submit • Esc cancel'
    const fallback = this.options.length > 0 ? '↵ Esc options' : 'Enter Esc cancel'
    const line = visibleWidth(controls) <= innerWidth ? controls : fallback
    return this.palette.dim(truncateToWidth(line, innerWidth, '…'))
  }

  /** Render a one-row option footer that retains every mode-specific control. */
  private compactOptionControls(innerWidth: number, showPager = false): string {
    const controls = [
      ...(this.options.length > 1 ? ['↑/↓'] : []),
      'Tab custom',
      ...(this.question.multiSelect ? ['Space toggle'] : []),
      'Enter',
      'Esc interrupt',
      ...(showPager ? ['PgUp/PgDn'] : []),
    ].join(' • ')
    const optionNavigation = this.options.length > 1 ? '↑↓ ' : ''
    const fallback = showPager
      ? `P↑↓ ${optionNavigation}Tab${this.question.multiSelect ? ' S' : ''}↵Esc`
      : this.question.multiSelect ? `${optionNavigation}Tab Sp ↵Esc` : `${optionNavigation}Tab ↵ Esc`
    const line = visibleWidth(controls) <= innerWidth ? controls : fallback
    return this.palette.dim(truncateToWidth(line, innerWidth, '…'))
  }

  /**
   * Choose option blocks that fit while keeping the selected option visible.
   * Omitted blocks are counted at each end for explicit overflow markers.
   */
  private windowBlocks(
    blocks: readonly string[][],
    budget: number,
    innerWidth: number,
  ): { visibleBlocks: string[][]; hiddenBefore: number; hiddenAfter: number } {
    const totalLines = blocks.reduce((sum, block) => sum + block.length, 0)
    if (totalLines <= budget && blocks.length <= this.maxVisible) {
      return { visibleBlocks: [...blocks], hiddenBefore: 0, hiddenAfter: 0 }
    }
    // `blocks` is dense and selectedIndex is derived from the same options.
    let start = this.selectedIndex
    let end = this.selectedIndex + 1
    /* v8 ignore next -- selectedIndex stays inside [0, options.length). */
    let used = blocks[this.selectedIndex]?.length ?? 0
    const markerLines = (before: number, after: number): number =>
      (before > 0 ? 1 : 0) + (after > 0 ? 1 : 0)
    const fits = (nextStart: number, nextEnd: number, nextUsed: number): boolean =>
      nextEnd - nextStart <= this.maxVisible
      && nextUsed + markerLines(nextStart, blocks.length - nextEnd) <= budget
    const selectedMarkers = markerLines(start, blocks.length - end)
    if (used + selectedMarkers > budget) {
      /* v8 ignore next -- selectedIndex stays inside [0, options.length). */
      const selectedBlock = blocks[this.selectedIndex] ?? []
      const hiddenBefore = start
      const hiddenAfter = blocks.length - end
      const pageSize = budget - selectedMarkers - 1
      const maxOffset = Math.max(0, selectedBlock.length - pageSize)
      const offset = Math.min(this.selectedBlockPage.offset, maxOffset)
      this.selectedBlockPage = { offset, size: pageSize, maxOffset }
      const keptLines = selectedBlock.slice(offset, offset + pageSize)
      const first = offset + 1
      const last = offset + keptLines.length
      const overflow = this.pagerStatus(first, last, selectedBlock.length, innerWidth)
      return {
        visibleBlocks: [[...keptLines, overflow]],
        hiddenBefore,
        hiddenAfter,
      }
    }
    this.selectedBlockPage = { offset: 0, size: 1, maxOffset: 0 }
    /* v8 ignore start -- the greedy walk only declines when both sides are already tight against the budget. */
    let expanded = true
    while (expanded && (start > 0 || end < blocks.length)) {
      expanded = false
      if (end < blocks.length) {
        const next = blocks[end]?.length ?? 0
        if (fits(start, end + 1, used + next)) {
          used += next
          end += 1
          expanded = true
          continue
        }
      }
      if (start > 0) {
        const previous = blocks[start - 1]?.length ?? 0
        if (fits(start - 1, end, used + previous)) {
          used += previous
          start -= 1
          expanded = true
        }
      }
    }
    /* v8 ignore stop */
    return {
      visibleBlocks: blocks.slice(start, end),
      hiddenBefore: start,
      hiddenAfter: blocks.length - end,
    }
  }
}


/** One pending approval decision, rendered as a two-option modal. */
export class ApprovalDialog implements Component, Focusable {
  private selectedIndex = 0
  focused = false

  constructor(
    private readonly toolName: string,
    private readonly reason: string | undefined,
    private readonly palette: Palette,
    private readonly done: (choice: ApprovalChoice) => void,
    private readonly cancel: () => void,
  ) {}

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = this.selectedIndex === 0 ? 1 : 0
    } else if (matchesKey(data, Key.down)) {
      this.selectedIndex = this.selectedIndex === 1 ? 0 : 1
    } else if (matchesKey(data, Key.enter)) {
      this.done(this.selectedIndex === 0 ? 'allowed-once' : 'rejected')
    } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.cancel()
    }
  }

  render(width: number): string[] {
    const horizontalPadding = Math.min(2, Math.max(0, Math.floor((width - 1) / 2)))
    const innerWidth = Math.max(1, width - horizontalPadding * 2)
    const lines: string[] = ['', this.palette.bold(this.palette.accent(`Approve ${displayText(this.toolName)}?`))]
    const push = (line: string): void => {
      lines.push(padRow(line, innerWidth, horizontalPadding, '…'))
    }
    if (this.reason !== undefined && this.reason !== '') {
      for (const line of wrapTextWithAnsi(displayText(this.reason), innerWidth)) {
        lines.push(this.palette.dim(line))
      }
    }
    lines.push('')
    for (const [index, label] of ['Allow once', 'Reject'].entries()) {
      const cursor = index === this.selectedIndex ? '›' : ' '
      const row = ` ${cursor} ${index + 1}. ${label}`
      push(index === this.selectedIndex ? this.palette.bold(this.palette.accent(row)) : row)
    }
    lines.push('')
    push(this.palette.dim('Enter choose • Esc withdraw'))
    return lines
  }
}

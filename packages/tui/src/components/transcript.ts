/**
 * pi-tui transcript components: the startup banner, user/assistant messages,
 * per-step timing footer, streaming assistant buffer, tool cards, and the
 * injected-context card. Each is a pure function of its inputs and the active
 * palette.
 * @module @deepseek-ai/dsh-tui/components/transcript
 */

import {
  Container,
  Markdown,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type MarkdownTheme,
} from '@earendil-works/pi-tui'
import { diffLines as compareLines } from 'diff'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { JsonValue, SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  TerminalCallView,
  ToolCallView,
  ToolDefinition,
  ToolResultView,
} from '@deepseek-ai/dsh-tools'
import type { FileDiff } from '@deepseek-ai/dsh-tools'
import { preview, renderUnknownXml } from './xml-tool-output.ts'
import { displayInlineText, displayText } from './text.ts'
import { gradientText, type BackgroundRole, type Palette } from './theme.ts'
import { contentText, type ParsedArguments } from './content.ts'
import {
  formatCompletionTime,
  formatTimingTotals,
  type StepPosition,
  type StepTimingTracker,
} from '../chat/timing.ts'

/** Concatenate the text of every block of one type, separated by blank lines. */
function textBlocks(content: readonly ContentBlock[], type: 'text' | 'reasoning'): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: typeof type }> => block.type === type)
    .map(block => block.text)
    .join('\n\n')
}

/** Render a value as terminal-safe text: strings escaped, other values as pretty JSON. */
function pretty(value: unknown): string {
  if (typeof value === 'string') return displayText(value)
  // JSON.stringify is typed to return string but yields undefined for e.g. symbols.
  const serialized = JSON.stringify(value, null, 2) as string | undefined
  return displayText(serialized ?? String(value))
}

interface RenderedDiff {
  lines: string[]
  added: number
  removed: number
  approximate: boolean
}

/**
 * A side's content lines under the terminator rule the Web DiffBlock also
 * applies: empty text is zero lines, a trailing newline terminates the last
 * line, and an interior blank line survives.
 */
function diffContentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * A file diff whose unchanged context stays neutral and does not affect exact
 * change totals. Comparisons beyond the edit-distance budget fall back to
 * whole-side rendering so a model-authored pending edit cannot stall the TUI.
 */
function renderDiff(diff: FileDiff, maxDiffEditLength: number, palette: Palette): RenderedDiff {
  // The card header is a fixed `Tool / <name>` frame that never names a file, so
  // each hunk always carries its own path header (no redundancy to suppress).
  const lines = [palette.bold(displayText(diff.path))]
  let added = 0
  let removed = 0
  if (diff.oldText === null) {
    const newLines = diffContentLines(displayText(diff.newText))
    added = newLines.length
    for (const line of newLines) lines.push(palette.success(`+ ${line}`))
    return { lines, added, removed, approximate: false }
  }
  const changes = compareLines(diff.oldText, diff.newText, { maxEditLength: maxDiffEditLength })
  if (changes === undefined) {
    const oldLines = diffContentLines(displayText(diff.oldText))
    const newLines = diffContentLines(displayText(diff.newText))
    lines.push(palette.dim(`[exact line diff omitted: >${maxDiffEditLength} changed lines]`))
    removed = oldLines.length
    added = newLines.length
    for (const line of oldLines) lines.push(palette.error(`- ${line}`))
    for (const line of newLines) lines.push(palette.success(`+ ${line}`))
    return { lines, added, removed, approximate: true }
  }
  for (const change of changes) {
    const changedLines = diffContentLines(displayText(change.value))
    if (change.added) {
      added += changedLines.length
      for (const line of changedLines) lines.push(palette.success(`+ ${line}`))
    } else if (change.removed) {
      removed += changedLines.length
      for (const line of changedLines) lines.push(palette.error(`- ${line}`))
    } else {
      for (const line of changedLines) lines.push(palette.dim(`  ${line}`))
    }
  }
  return { lines, added, removed, approximate: false }
}

/**
 * A message's bold, underlined role header in the role color. The underline
 * bands each role without a background fill or per-line prefix, so it reads on
 * any theme and a body drag-select copies the message text verbatim.
 */
function messageHeader(label: string, color: (text: string) => string, palette: Palette): string {
  return palette.bold(palette.underline(color(displayText(label))))
}

/** Which background bar (if any) paints a block's 1-column left gutter. */
export type BlockBar = 'none' | 'panel' | 'accent' | 'success' | 'warning' | 'error'

interface MessageBlockOptions {
  /** Left gutter bar background; `'none'` renders no bar column. Default `'none'`. */
  bar?: BlockBar
  /** Paint the body with the panel background. Default `true`. */
  panel?: boolean
  /** Horizontal padding columns on each side of the body. Default `2`. */
  paddingX?: number
  /** Blank padding rows above and below the body. Default `1`. */
  paddingY?: number
}

/** {@link MessageBlockOptions} with every default applied. */
type BlockOptions = Required<MessageBlockOptions>

/** A block's body placement inside its render width, decided before painting. */
interface BlockLayout {
  /** Columns the body is rendered at; paintBlock truncates every row to this. */
  readonly innerWidth: number
  /** Left padding columns actually applied, clamped for narrow widths. */
  readonly padX: number
}

/** Fill the block defaults. */
function blockOptions(options: MessageBlockOptions): BlockOptions {
  const { bar = 'none', panel = true, paddingX = 2, paddingY = 1 } = options
  return { bar, panel, paddingX, paddingY }
}

/**
 * Place a block's body inside `width`. Every non-default form reserves a
 * 1-column left slot — the visible bar, or the invisible slot that keeps flat
 * bodies' content column aligned with barred blocks (opencode's 1 border +
 * 2 padding).
 */
function blockLayout(width: number, options: BlockOptions): BlockLayout {
  const slot = options.bar !== 'none' || !options.panel ? 1 : 0
  const padX = Math.min(options.paddingX, Math.max(0, Math.floor((width - slot - 1) / 2)))
  return { padX, innerWidth: Math.max(1, width - slot - padX * 2) }
}

/** The palette background that paints a block's visible gutter bar. */
function barBackground(palette: Palette, bar: Exclude<BlockBar, 'none'>): BackgroundRole {
  if (bar === 'panel') return palette.panel
  if (bar === 'accent') return palette.accentBg
  if (bar === 'success') return palette.successBg
  if (bar === 'warning') return palette.warningBg
  return palette.errorBg
}

/**
 * Paint body rows as one message block across `width` columns. `body` is
 * already rendered at `layout.innerWidth`; painting truncates each row to it,
 * applies the padding, and emits the bar/panel spans. Pure so the tool card's
 * cached rows can paint through it without a Container.
 */
function paintBlock(
  palette: Palette,
  body: readonly string[],
  width: number,
  layout: BlockLayout,
  options: BlockOptions,
): string[] {
  if (body.length === 0) return []
  const rows: string[] = []
  if (!options.panel) {
    // Flat bodies emit no SGR and no row-end padding, so a drag-select copies
    // the text verbatim; child rows may arrive padded to `innerWidth`, so the
    // padding is stripped. The gutter's bar slot plus padding keeps the content
    // column aligned with barred blocks.
    const indent = ' '.repeat(layout.padX + 1)
    for (let index = 0; index < options.paddingY; index += 1) rows.push('')
    for (const line of body) {
      const row = `${indent}${truncateToWidth(line, layout.innerWidth, '')}`.replace(/\s+$/u, '')
      rows.push(truncateToWidth(row, width, ''))
    }
    for (let index = 0; index < options.paddingY; index += 1) rows.push('')
    return rows
  }
  const bar = options.bar === 'none' ? undefined : barBackground(palette, options.bar)
  const panelWidth = Math.max(0, width - (bar === undefined ? 0 : 1))
  const paint = (content: string): string => {
    const panel = palette.panel(content + ' '.repeat(Math.max(0, panelWidth - visibleWidth(content))))
    const row = bar === undefined ? panel : `${bar(' ')}${panel}`
    // A bar column leaves no room for a 1-column body at degenerate widths;
    // clamp the composed row back to `width` (a no-op once it fits).
    return bar === undefined ? row : truncateToWidth(row, width, '')
  }
  for (let index = 0; index < options.paddingY; index += 1) rows.push(paint(''))
  for (const line of body) {
    rows.push(paint(`${' '.repeat(layout.padX)}${truncateToWidth(line, layout.innerWidth, '')}`))
  }
  for (let index = 0; index < options.paddingY; index += 1) rows.push(paint(''))
  return rows
}

/**
 * The unified container for the transcript's message blocks (user message,
 * assistant body, reasoning; tool cards reuse {@link paintBlock} without a
 * Container). A block is an optional 1-column background bar in the left
 * gutter, the recessed panel background behind the body, and shared padding,
 * so every block indents, truncates, and spaces identically. The message
 * blocks use all three forms: the user message bars with `accent`, reasoning
 * bars with `panel` (an invisible rail on the panel floor), and the assistant
 * body renders flat (no paint at all).
 */
class MessageBlock extends Container {
  constructor(
    private readonly palette: Palette,
    private readonly options: MessageBlockOptions = {},
  ) {
    super()
  }

  override render(width: number): string[] {
    const options = blockOptions(this.options)
    const layout = blockLayout(width, options)
    return paintBlock(this.palette, super.render(layout.innerWidth), width, layout, options)
  }
}

/** How reasoning blocks render: hidden, collapsed to a header, or expanded. */
export type ReasoningVisibility = 'hidden' | 'collapsed' | 'expanded'

/**
 * Borderless startup banner: product title, an optional configured subtitle,
 * and the session id. No box frame — each line renders as plain left-padded
 * text (matching transcript notices) so it reads on any theme.
 */
export class HeaderComponent implements Component {
  /** Columns of the banner currently revealed; `undefined` renders it whole. */
  private revealWidth: number | undefined

  constructor(
    private readonly agent: Agent,
    private readonly subtitle: () => string | undefined,
    private readonly palette: Palette,
    private readonly gradient: boolean,
  ) {}

  /**
   * Clip the banner to `width` columns (the sweep reveal); `undefined` restores it.
   * @param width - Revealed banner width in columns, or `undefined` for the whole banner.
   */
  setRevealWidth(width: number | undefined): void {
    this.revealWidth = width
  }

  invalidate(): void {}

  render(width: number): string[] {
    const usable = Math.max(1, width - 2)
    const name = this.gradient
      ? this.palette.bold(gradientText('DEEPSEEK'))
      : this.palette.bold(this.palette.accent('DEEPSEEK'))
    const title = `${name} ${this.palette.bold('HARNESS')}`
    const detail = displayText(this.agent.session.id)
    const subtitle = this.subtitle()
    const lines = [
      title,
      ...subtitle === undefined ? [] : [this.palette.dim(displayText(subtitle))],
      this.palette.dim(detail),
    ]
      .flatMap(line => wrapTextWithAnsi(line, usable))
      .map(line => ` ${truncateToWidth(line, usable, '')}`)
    if (this.revealWidth === undefined) return lines
    const revealed = this.revealWidth
    return lines.map(line => truncateToWidth(line, revealed, ''))
  }
}

/**
 * A user or steering prompt in the transcript. An underlined accent role header
 * plus blank-line spacing separate it from surrounding blocks; the body sits on
 * the panel floor behind a 1-column accent bar (the opencode user-block blue
 * rail), so its content column indents 3 and a drag-select copies the bar and
 * padding spaces along with the prompt — the accepted trade for the shared
 * block geometry.
 */
export class UserMessageComponent extends Container {
  constructor(text: string, palette: Palette, mdTheme: MarkdownTheme, label = 'You') {
    super()
    this.addChild(new Text(messageHeader(label, palette.accent, palette), 0, 0))
    const body = new MessageBlock(palette, { bar: 'accent' })
    body.addChild(new Markdown(displayText(text), 0, 0, mdTheme, { color: value => palette.text(value) }, {
      preserveOrderedListMarkers: true,
      preserveBackslashEscapes: true,
    }))
    this.addChild(body)
  }
}

/**
 * Children of a settled assistant message: an optional reasoning block (the
 * panel-floored Thinking block, collapsed to a one-row chip or expanded with
 * its muted body), a blank spacer, then the response text as a flat unpainted
 * block indented to the shared content column — no `Response` subtitle, so the
 * body reads as one continuation of the `Assistant` header. A folded
 * continuation (a later step of a turn while tool cards are hidden) drops the
 * `Assistant` header and renders nothing when it has no visible body, so
 * tool-only steps leave no blank segment behind.
 */
function assistantMessageChildren(
  content: readonly ContentBlock[],
  reasoningMode: ReasoningVisibility,
  foldedContinuation: boolean,
  palette: Palette,
  mdTheme: MarkdownTheme,
): Component[] {
  const reasoning = displayText(textBlocks(content, 'reasoning').trim())
  const text = displayText(textBlocks(content, 'text').trim())
  const showsReasoning = reasoning !== '' && reasoningMode !== 'hidden'
  if (foldedContinuation && !showsReasoning && text === '') return []
  const children: Component[] = [new Spacer(1)]
  if (!foldedContinuation) {
    children.push(new Text(messageHeader('Assistant', palette.accent, palette), 0, 0))
  }
  if (showsReasoning) {
    const collapsed = reasoningMode === 'collapsed'
    if (collapsed) {
      // A single panel row: the title chip lies on the full-width panel floor.
      const chip = new MessageBlock(palette, { bar: 'panel', paddingY: 0 })
      chip.addChild(new Text(palette.italic(palette.dim('▸ Thinking')), 0, 0))
      children.push(chip)
    } else {
      // The opencode thinking block: panel floor, invisible bar column, an
      // italic dim title, a blank row, then the muted (non-italic) body.
      const block = new MessageBlock(palette, { bar: 'panel' })
      block.addChild(new Text(palette.italic(palette.dim('▾ Thinking')), 0, 0))
      block.addChild(new Spacer(1))
      block.addChild(new Markdown(reasoning, 0, 0, mdTheme, { color: value => palette.dim(value) }))
      children.push(block)
    }
  }
  if (text) {
    // The blank line that separated the old panel's top padding row now comes
    // from this spacer, in front of the flat (unpainted) body.
    children.push(new Spacer(1))
    const body = new MessageBlock(palette, { panel: false, paddingY: 0 })
    body.addChild(new Markdown(text, 0, 0, mdTheme, { color: value => palette.text(value) }))
    children.push(body)
  }
  return children
}

/**
 * A step's timing summary, rendered as a self-refreshing footer that stays at
 * the tail of the step's output. Kept separate from the assistant message so
 * the timing line trails any tool cards the step appends after its message.
 */
class StepTimingComponent extends Container {
  private completionTime: number | undefined

  constructor(
    private readonly position: StepPosition,
    private readonly events: () => readonly SessionEvent[],
    private readonly tracker: StepTimingTracker,
    private readonly now: () => number,
    private readonly palette: Palette,
  ) {
    super()
    this.rebuild()
  }

  complete(time: number): void {
    this.completionTime = time
    this.rebuild()
  }

  override invalidate(): void {
    this.rebuild()
    super.invalidate()
  }

  private rebuild(): void {
    this.clear()
    const totals = this.tracker.totalsAt(this.events(), this.position, this.completionTime ?? this.now())
    const timing = formatTimingTotals(totals, true)
    const header = this.completionTime === undefined
      ? `Status · ${timing}`
      : `Status · ${timing} · Completed ${formatCompletionTime(this.completionTime)}`
    this.addChild(new Text(this.palette.dim(header), 0, 0))
  }
}

interface StreamingBlock {
  type: string
  text: string
}

/** A live assistant step: streamed reasoning/text blocks until the message settles. */
export class StreamingAssistantComponent extends Container {
  private readonly blocks = new Map<number, StreamingBlock>()
  private settledContent: readonly ContentBlock[] | undefined
  private foldedContinuation = false
  /**
   * The step's timing footer. The renderer keeps it at the tail of the chat so
   * it trails any tool cards the step appends after this assistant message; it
   * is not a child of this component.
   */
  readonly timing: StepTimingComponent

  constructor(
    /** The step's turn/step coordinates, used to group steps into their turn. */
    readonly position: StepPosition,
    events: () => readonly SessionEvent[],
    tracker: StepTimingTracker,
    now: () => number,
    private reasoningMode: ReasoningVisibility,
    private readonly palette: Palette,
    private readonly mdTheme: MarkdownTheme,
  ) {
    super()
    this.timing = new StepTimingComponent(position, events, tracker, now, palette)
    this.rebuild()
  }

  /**
   * Replace the streamed blocks with the step's settled content.
   * @param content - The settled assistant content blocks.
   */
  settle(content: readonly ContentBlock[]): void {
    this.settledContent = content
    this.rebuild()
  }

  /**
   * Whether this step's assistant message has settled.
   * @returns `true` once {@link settle} has run.
   */
  isSettled(): boolean {
    return this.settledContent !== undefined
  }

  /**
   * Pin the step's timing footer to its completion time.
   * @param time - Step completion time in epoch milliseconds.
   */
  complete(time: number): void {
    this.timing.complete(time)
  }

  override invalidate(): void {
    this.rebuild()
    this.timing.invalidate()
    super.invalidate()
  }

  /**
   * Fold one streamed chunk into the live block buffer and re-render.
   * @param chunk - The streamed assistant chunk.
   */
  update(chunk: StreamChunk): void {
    if (chunk.type === 'block-start') {
      this.blocks.set(chunk.index, { type: chunk.blockType, text: '' })
    } else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      const type = chunk.type === 'text-delta' ? 'text' : 'reasoning'
      const block = this.blocks.get(chunk.index) ?? { type, text: '' }
      block.text += chunk.text
      this.blocks.set(chunk.index, block)
    } else if (chunk.type === 'block-end' && (chunk.block.type === 'text' || chunk.block.type === 'reasoning')) {
      this.blocks.set(chunk.index, { type: chunk.block.type, text: chunk.block.text })
    }
    this.rebuild()
    this.timing.invalidate()
  }

  /**
   * Set how reasoning blocks render, then re-render.
   * @param mode - Hidden, collapsed to a header, or expanded.
   */
  setReasoningMode(mode: ReasoningVisibility): void {
    this.reasoningMode = mode
    this.rebuild()
  }

  /**
   * Mark this step as a folded continuation of its turn: no `Assistant` header,
   * and no output at all while the step has no visible body. Used while tool
   * cards are hidden so a turn reads as one assistant message.
   * @param folded - Whether to render as a headerless continuation.
   */
  setFoldedContinuation(folded: boolean): void {
    if (this.foldedContinuation === folded) return
    this.foldedContinuation = folded
    this.rebuild()
  }

  /**
   * Whether the step currently renders visible reasoning or text.
   * @returns `true` when a header-owning render would show a body.
   */
  hasVisibleBody(): boolean {
    const content = this.presentedContent()
    return textBlocks(content, 'text').trim() !== ''
      || (this.reasoningMode !== 'hidden' && textBlocks(content, 'reasoning').trim() !== '')
  }

  /** The settled content when available, otherwise the streamed blocks in model order. */
  private presentedContent(): readonly ContentBlock[] {
    return this.settledContent ?? [...this.blocks.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap<ContentBlock>(([, block]) => {
        if (block.type === 'text') return [{ type: 'text', text: block.text }]
        if (block.type === 'reasoning') return [{ type: 'reasoning', text: block.text }]
        return []
      })
  }

  private rebuild(): void {
    this.clear()
    const children = assistantMessageChildren(
      this.presentedContent(),
      this.reasoningMode,
      this.foldedContinuation,
      this.palette,
      this.mdTheme,
    )
    for (const child of children) this.addChild(child)
  }
}

/**
 * A tool card's body split at the Markdown boundary. `prelude` rows are already
 * styled and render verbatim (a terminal `$` command, its cwd, a diff's hunks);
 * `lines` is the tool's own text. A generic card renders both as one Markdown
 * document under the dim body tone.
 */
interface CardBody {
  readonly prelude: readonly string[]
  readonly lines: readonly string[]
}

/**
 * Ctrl+O card-visibility cycle: `hidden` drops tool cards from the transcript,
 * `collapsed` previews the first body lines, `expanded` shows everything.
 */
export type ToolCardVisibility = 'hidden' | 'collapsed' | 'expanded'

/**
 * Transcript card with a width-keyed rendered-row cache. pi-tui re-renders
 * every component each frame and relies on per-component line caches (its own
 * `Text`/`Markdown` do this); a card that rebuilds rows inside `render(width)`
 * would re-wrap its output every frame. Subclasses render through
 * {@link renderLines} and call {@link dropLines} from every state mutator; with
 * `invalidate()` (pi-tui's tree-wide cascade) also dropping, a state change
 * always re-renders.
 */
abstract class CachedCardComponent implements Component {
  private cached: { width: number; lines: string[] } | undefined

  /** Discard the cached rows so the next render recomputes them. */
  protected dropLines(): void {
    this.cached = undefined
  }

  invalidate(): void {
    this.cached = undefined
  }

  render(width: number): string[] {
    if (this.cached?.width !== width) this.cached = { width, lines: this.renderLines(width) }
    return this.cached.lines
  }

  /**
   * Render the card's rows for `width` without caching.
   * @param width - Render width the rows are wrapped to.
   * @returns The card's rows.
   */
  protected abstract renderLines(width: number): string[]
}

/** A tool call and its result, rendered as a collapsible status card. */
export class ToolCardComponent extends CachedCardComponent {
  private result: { content: ContentBlock[]; isError: boolean; meta?: JsonValue } | undefined
  private visibility: ToolCardVisibility = 'collapsed'
  private callView: ToolCallView
  private resultView: ToolResultView | undefined
  private diffBodyCache: { view: ToolCallView | ToolResultView; body: CardBody } | undefined

  constructor(
    private readonly name: string,
    private readonly parsed: ParsedArguments,
    private readonly definition: ToolDefinition | undefined,
    private readonly maxOutputLines: number,
    private readonly maxDiffEditLength: number,
    private readonly palette: Palette,
    private readonly mdTheme: MarkdownTheme,
  ) {
    super()
    this.callView = this.presentCall()
  }

  private presentCall(): ToolCallView {
    if (this.parsed.valid && this.definition?.presentCall) {
      try {
        const view = this.definition.presentCall(this.parsed.value)
        if (view !== undefined) return view
      } catch (error: unknown) {
        return { card: 'generic', title: displayText(this.name), rawInput: `Presenter failed: ${String(error)}` }
      }
    }
    return { card: 'generic', title: displayText(this.name), rawInput: this.parsed.value }
  }

  /**
   * Record the tool result and derive its result view.
   * @param event - The `tool/result` event payload.
   */
  updateResult(event: Extract<SessionEvent, { type: 'tool/result' }>['data']): void {
    this.diffBodyCache = undefined
    this.dropLines()
    const result = event.message.content[0]
    this.result = {
      content: [...result.content],
      isError: result.isError === true,
      ...event.meta !== undefined ? { meta: event.meta } : {},
    }
    if (this.parsed.valid && this.definition?.presentResult) {
      try {
        const view = this.definition.presentResult(this.parsed.value, this.result)
        if (view !== undefined) this.resultView = view
      } catch (error: unknown) {
        this.resultView = { card: 'generic', content: [{ type: 'text', text: `Presenter failed: ${String(error)}` }] }
      }
    }
  }

  /**
   * Set the card's visibility state.
   * @param visibility - Hidden, collapsed preview, or full body.
   */
  setVisibility(visibility: ToolCardVisibility): void {
    this.visibility = visibility
    this.dropLines()
  }

  protected renderLines(width: number): string[] {
    // Hidden renders nothing — not even the leading gap — so the transcript
    // keeps only the conversation, the way Codex hides tool calls.
    if (this.visibility === 'hidden') return []
    const isError = this.result?.isError ?? false
    // A ring marker: hollow while the call is pending, filled once it settles;
    // the header color (warning/success/error) tells pending from ok from error.
    const glyph = this.result === undefined ? '○' : '●'
    const rawBody = this.renderBody()
    const view = this.resultView ?? this.callView
    const markdownContent = view.card === 'generic'
      ? view.content ?? this.result?.content
      : view.card === 'search' || view.card === 'web' || view.card === 'read'
        ? this.result?.content
        : undefined
    const unknownXml = this.definition === undefined && markdownContent !== undefined
      ? renderUnknownXml(
        displayText(contentText(markdownContent)),
        this.maxOutputLines,
        this.visibility === 'expanded',
        displayText,
        text => this.palette.dim(text),
        text => this.palette.dim(text),
        /* v8 ignore next -- renderUnknownXml calls the collapsed summary only when hidden XML children exceed this card's limit. */
        count => this.palette.dim(`  … +${count} lines (Ctrl+O to expand)`),
      )
      : undefined
    // A generic card renders title and result as one Markdown document, so the
    // document's own block spacing is preserved, then dims every row — the whole
    // card body reads as one dim block under the status-colored header.
    const body = unknownXml ?? (markdownContent !== undefined && rawBody.lines.length > 0
      ? this.dimBody(rawBody, width)
      : [...rawBody.prelude, ...rawBody.lines])
    const visibleBody = unknownXml !== undefined || this.visibility === 'expanded'
      ? body
      : preview(body, this.maxOutputLines, count => this.palette.dim(`… +${count} lines (Ctrl+O to expand)`))
    // The header is a fixed `Tool / <name>` frame. Only the leading status
    // glyph carries the pending/ok/error color; the rest stays dim so the tool
    // block reads as a supporting block rather than competing with the body.
    const statusColor = this.result === undefined
      ? this.palette.warning
      : isError ? this.palette.error : this.palette.success
    // The header is a single card row: collapse an embedded newline in the
    // description to an inline escape so it cannot break onto extra rows and
    // collide with the body lines that follow.
    const desc = this.headerDescription()
    const headerText = `${glyph} Tool / ${displayText(this.name)}${desc === undefined ? '' : ` / ${displayInlineText(desc)}`}`
    const header = truncateToWidth(
      `${statusColor(glyph)} ${this.palette.dim(headerText.slice(glyph.length + 1))}`,
      Math.max(1, width - 2),
      '',
    )
    // The blank first row is the card's own paragraph gap (no external Spacer),
    // so the hidden state removes the gap together with the card.
    const lines: string[] = ['', header]
    if (visibleBody.length > 0) lines.push(...new Text(visibleBody.join('\n'), 0, 0).render(width))
    return lines
  }

  /** The pending terminal call view, when this row is a terminal card. */
  private terminalPending(): TerminalCallView | undefined {
    return this.callView.card === 'terminal' ? this.callView : undefined
  }

  /**
   * The optional header `/ <desc>` segment: a bash (terminal) card's
   * model-authored description. Non-terminal tools contribute no header detail.
   */
  private headerDescription(): string | undefined {
    const description = this.terminalPending()?.description
    return description !== undefined && description !== '' ? description : undefined
  }

  /**
   * The presenter's title for a non-terminal card, shown as the first body line
   * now that the header is a fixed `Tool / <name>` frame. The result-state
   * title replaces the pending one.
   */
  private bodyTitle(): string {
    return this.resultView?.title ?? this.callView.title
  }

  private renderBody(): CardBody {
    const view = this.resultView ?? this.callView
    if (view.card === 'terminal') {
      const pending = this.terminalPending()
      const prelude: string[] = []
      const lines: string[] = []
      const headlined = pending?.description !== undefined && pending.description !== ''
      const commandInBody = pending !== undefined && (headlined || this.result === undefined)
      if (commandInBody) prelude.push(this.palette.dim(`$ ${displayInlineText(pending.title)}`))
      if (pending?.cwd) prelude.push(this.palette.dim(displayInlineText(pending.cwd)))
      if (this.resultView?.card === 'terminal') {
        if (this.resultView.output) lines.push(...this.dimOutput(this.resultView.output))
        if (this.resultView.exitCode !== undefined) lines.push(this.palette.dim(`[exit ${this.resultView.exitCode}]`))
        if (this.resultView.signal !== undefined) {
          lines.push(this.palette.error(`[signal ${displayText(this.resultView.signal)}]`))
        }
      } else if (this.result !== undefined) {
        lines.push(...this.dimOutput(contentText(this.result.content)))
      }
      return { prelude: prelude.filter(Boolean), lines: lines.filter(Boolean) }
    }
    if (view.card === 'diff') {
      if (this.diffBodyCache?.view === view) return this.diffBodyCache.body
      // The header no longer names the file, so each diff keeps its own path
      // header. A trailing footer summarizes the exact changed rows when the
      // bounded comparison succeeds (`+A -R · N file(s)`).
      const renderedDiffs = view.diffs.map(diff =>
        renderDiff(diff, this.maxDiffEditLength, this.palette),
      )
      const added = renderedDiffs.reduce((total, rendered) => total + rendered.added, 0)
      const removed = renderedDiffs.reduce((total, rendered) => total + rendered.removed, 0)
      const approximate = renderedDiffs.some(rendered => rendered.approximate)
      const hunks = renderedDiffs.flatMap((rendered, index) => {
        return [...index > 0 ? [''] : [], ...rendered.lines]
      })
      const files = new Set(view.diffs.map(diff => diff.path)).size
      const footer = this.palette.dim(
        `└ +${added} -${removed} · ${files} file${files === 1 ? '' : 's'}${approximate ? ' · approximate' : ''}`,
      )
      // A diff's own `+`/`-` colors carry its meaning, so it renders verbatim
      // rather than under the dim result-output color.
      const body = { prelude: [...hunks, footer], lines: [] }
      this.diffBodyCache = { view, body }
      return body
    }
    // A generic card carries its own envelope-stripped `content`; a search or
    // web card carries no `content` copy and falls back to the raw result
    // content here.
    const content = (view.card === 'generic' || view.card === 'read' ? view.content : undefined) ?? this.result?.content
    const prelude: string[] = []
    const lines: string[] = []
    // The presenter title headlines the body now that the header is a fixed
    // `Tool / <name>` frame. Skip it when it only repeats the tool name, which
    // the header already shows.
    const bodyTitle = this.bodyTitle()
    if (bodyTitle !== displayText(this.name)) prelude.push(displayInlineText(bodyTitle))
    if (content !== undefined) lines.push(...displayText(contentText(content)).split('\n'))
    const rawInput = this.result === undefined && this.callView.card === 'generic'
      ? this.callView.rawInput
      : undefined
    if (rawInput !== undefined) lines.push(...pretty(rawInput).split('\n'))
    // Blank-line trimming spans the whole body, so the title counts as a row:
    // interior blanks survive while the body's leading and trailing ones drop.
    const total = prelude.length + lines.length
    return {
      prelude,
      lines: lines.filter((line, index) => {
        const row = prelude.length + index
        return line.length > 0 || (row > 0 && row < total - 1)
      }),
    }
  }

  /**
   * A tool's own output text as dim rows — the card's result-output color. A
   * blank row stays the empty string so the terminal branch's blank-row filter
   * still reads it as blank instead of as an ANSI-wrapped value.
   */
  private dimOutput(text: string): string[] {
    return displayText(text).split('\n').map(line => line === '' ? line : this.palette.dim(line))
  }

  /**
   * Render a generic card's prelude and result as one Markdown document under the
   * dim body tone. Rendering both together preserves the document's own block
   * spacing; dimming every row keeps the card body one uniform tone, so only
   * the status-colored header carries color.
   */
  private dimBody(body: CardBody, width: number): string[] {
    const rows = new Markdown([...body.prelude, ...body.lines].join('\n'), 0, 0, this.mdTheme, {
      color: value => this.palette.text(value),
    }).render(width)
    // A whitespace-only row carries no output to dim; leaving it unwrapped keeps
    // Markdown's padding out of the styled ranges.
    return rows.map(row => row.trim() === '' ? row : this.palette.dim(row))
  }
}

/**
 * Matches a lone reminder-frame tag on its own line, capturing the element name.
 */
const REMINDER_FRAME_LINE = /^<(\/?)([a-zA-Z][\w:.-]*)>$/u

/**
 * Drop a producer's outer reminder frame, keeping the instruction body verbatim.
 * The card header already names the source, so the frame lines carry nothing.
 * Only a matched open/close pair on the first and last lines is removed, so a
 * body that merely starts with a tag-like line is left intact.
 * @param text - Complete model-facing context text.
 * @returns The body without its outer frame lines, trimmed of the blank lines they leave.
 */
function stripReminderFrame(text: string): string {
  // A frame needs an open line and a distinct close line, so anything shorter than
  // two lines is already frameless.
  const [first = '', ...rest] = text.split('\n')
  const last = rest.at(-1)
  if (last === undefined) return text
  const open = REMINDER_FRAME_LINE.exec(first.trim())
  const close = REMINDER_FRAME_LINE.exec(last.trim())
  if (open?.[1] !== '' || close?.[1] !== '/' || open[2] !== close[2]) return text
  return rest.slice(0, -1).join('\n').replace(/^\n+|\n+$/gu, '')
}

/**
 * Injected context (plugin/goal source), rendered as a collapsible dim card that
 * shares the tool-card `Ctrl+O` toggle. The header is `Context · <label>`; the
 * body is the message text as dim prose, one tone with the header and the fold
 * marker, folded to `maxOutputLines`, with a surrounding reminder frame stripped
 * because the source label already names the context.
 *
 * Injected context is prose, not markup, so this card does not parse it.
 */
export class ContextCardComponent extends CachedCardComponent {
  private expanded = false

  constructor(
    private readonly label: string,
    private readonly text: string,
    private readonly maxOutputLines: number,
    private readonly palette: Palette,
  ) {
    super()
  }

  /**
   * Expand or collapse the card body.
   * @param expanded - Whether the full body is shown.
   */
  setExpanded(expanded: boolean): void {
    this.expanded = expanded
    this.dropLines()
  }

  protected renderLines(width: number): string[] {
    const header = this.palette.dim(`Context · ${displayText(this.label)}`)
    // Emptiness is decided on the stripped text: styling a blank body would yield
    // one escape-only row, which reads as a stray blank line under the header.
    const stripped = stripReminderFrame(this.text)
    if (stripped === '') return [header]
    const body = stripped.split('\n')
      .map(line => line === '' ? line : this.palette.dim(displayText(line)))
    const visibleBody = this.expanded
      ? body
      : preview(body, this.maxOutputLines, count => this.palette.dim(`… +${count} lines (Ctrl+O to expand)`))
    return [header, ...new Text(visibleBody.join('\n'), 0, 0).render(width)]
  }
}

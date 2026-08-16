/**
 * Serializable configuration and defaults for the pi-tui terminal mode. Loader
 * schema validation normally fills defaults; {@link resolveTuiConfig} applies
 * the same defaults for direct callers that bypass the Loader.
 * @module @deepseek-ai/dsh-tui/config
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
} from './chat/file-autocomplete.ts'

/** Theme settings for the pi-tui terminal mode. */
export interface TuiThemeConfig {
  /** Apply the built-in ANSI color palette. */
  color?: boolean
  /** Paint the startup banner with the 24-bit DeepSeek brand gradient. */
  truecolor?: boolean
}

/** Interaction and presentation settings for the pi-tui terminal mode. */
export interface TuiConfig {
  /** Render model reasoning blocks. */
  showReasoning?: boolean
  /** Maximum tool-card body lines retained in its collapsed head/tail preview. */
  maxToolOutputLines?: number
  /** Maximum added and removed lines explored while deriving an exact line diff. */
  maxDiffEditLength?: number
  /** Maximum options visible at once in a user-question panel. */
  maxQuestionOptions?: number
  /** Maximum models visible at once in the model selector. */
  maxModelOptions?: number
  /** Maximum sessions visible at once in the resume selector. */
  maxResumeOptions?: number
  /** Maximum concurrent cold projection reads in one resume scan. */
  resumeScanConcurrency?: number
  /** User-question panel width in terminal columns, clamped to the terminal. */
  questionDialogWidth?: number
  /** User-question panel maximum height in terminal rows. */
  questionDialogMaxHeight?: number
  /** Model-selector width in terminal columns. */
  modelDialogWidth?: number
  /** Model-selector maximum height in terminal rows. */
  modelDialogMaxHeight?: number
  /** Maximum fuzzy file candidates displayed for one `@` query. */
  fileSearchMaxResults?: number
  /** Maximum paths retained in one `@` workspace index. */
  fileSearchMaxEntries?: number
  /** Directory basenames excluded from `@` traversal and completion. */
  fileSearchExcludedDirectories?: string[]
  /** Show the terminal's hardware cursor at the pi editor's IME marker. */
  showHardwareCursor?: boolean
  /** User messages replayed into the transcript on mount; earlier history loads on demand. */
  maxInitialMessages?: number
  /** Events loaded by one history-page request. */
  historyPageSize?: number
  /** Approximate resident transcript bytes; oldest rows evict when the budget overflows. */
  transcriptResidentMaxBytes?: number
  /** Maximum resident transcript cards; oldest cards evict when the budget overflows. */
  cardCacheEntries?: number
  /** Status-footer refresh interval in milliseconds while the agent is running. */
  statusIntervalMs?: number
  /** Color settings. */
  theme?: TuiThemeConfig
  /** Terminal window title while the UI is mounted; a logged session title prefixes it. */
  title?: string
}

const showReasoningSchema = z.boolean().default(true)
const maxToolOutputLinesSchema = z.number().step(1).min(1).default(6)
const maxDiffEditLengthSchema = z.number().step(1).min(1).default(1000)
const maxQuestionOptionsSchema = z.number().step(1).min(1).default(8)
const maxModelOptionsSchema = z.number().step(1).min(1).default(8)
const maxResumeOptionsSchema = z.number().step(1).min(1).default(8)
const resumeScanConcurrencySchema = z.number().step(1).min(1).default(4)
const questionDialogWidthSchema = z.number().step(1).min(20).default(200)
const questionDialogMaxHeightSchema = z.number().step(1).min(6).default(20)
const modelDialogWidthSchema = z.number().step(1).min(20).default(76)
const modelDialogMaxHeightSchema = z.number().step(1).min(6).default(20)
const fileSearchMaxResultsSchema = z.number().step(1).min(1).default(DEFAULT_FILE_SEARCH_MAX_RESULTS)
const fileSearchMaxEntriesSchema = z.number().step(1).min(1).default(DEFAULT_FILE_SEARCH_MAX_ENTRIES)
const fileSearchExcludedDirectoriesSchema = z.array(z.string()).default([...DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES])
const showHardwareCursorSchema = z.boolean().default(false)
const maxInitialMessagesSchema = z.number().step(1).min(1).default(200)
const historyPageSizeSchema = z.number().step(1).min(1).default(100)
const transcriptResidentMaxBytesSchema = z.number().step(1).min(1024).default(4_194_304)
const cardCacheEntriesSchema = z.number().step(1).min(16).default(2000)
const statusIntervalMsSchema = z.number().step(1).min(50).default(500)
const colorSchema = z.boolean().default(true)
// No default: an unset value auto-detects truecolor from COLORTERM in `apply`.
const truecolorSchema = z.boolean()
const TuiThemeConfigSchema: z<TuiThemeConfig> = z.object({
  color: colorSchema,
  truecolor: truecolorSchema,
})
const titleSchema = z.string().default('DeepSeek Harness')

/**
 * Presentation fields shared verbatim by {@link TuiConfigSchema} and the
 * plugin-level {@link Config} schema — the single field table; both schemas
 * spread it, so a knob added here is settable through either path.
 */
const tuiConfigSchemaFields = {
  showReasoning: showReasoningSchema,
  maxToolOutputLines: maxToolOutputLinesSchema,
  maxDiffEditLength: maxDiffEditLengthSchema,
  maxQuestionOptions: maxQuestionOptionsSchema,
  maxModelOptions: maxModelOptionsSchema,
  maxResumeOptions: maxResumeOptionsSchema,
  resumeScanConcurrency: resumeScanConcurrencySchema,
  questionDialogWidth: questionDialogWidthSchema,
  questionDialogMaxHeight: questionDialogMaxHeightSchema,
  modelDialogWidth: modelDialogWidthSchema,
  modelDialogMaxHeight: modelDialogMaxHeightSchema,
  fileSearchMaxResults: fileSearchMaxResultsSchema,
  fileSearchMaxEntries: fileSearchMaxEntriesSchema,
  fileSearchExcludedDirectories: fileSearchExcludedDirectoriesSchema,
  showHardwareCursor: showHardwareCursorSchema,
  maxInitialMessages: maxInitialMessagesSchema,
  historyPageSize: historyPageSizeSchema,
  transcriptResidentMaxBytes: transcriptResidentMaxBytesSchema,
  cardCacheEntries: cardCacheEntriesSchema,
  statusIntervalMs: statusIntervalMsSchema,
  theme: TuiThemeConfigSchema,
  title: titleSchema,
}

/** Schemastery schema for presentation settings embedded by app bundles. */
export const TuiConfigSchema: z<TuiConfig> = z.object(tuiConfigSchemaFields)

/** Serializable plugin configuration. */
export interface Config extends TuiConfig {
  /** Banner subtitle line. When absent, the banner has no subtitle and sweeps in on start. */
  welcome?: string
  /** Exact shared agent/session identity driven by this terminal. Defaults to `main`. */
  sessionId?: string
  /** Provider/model route from `--model <provider>/<model>`; absent keeps the session default. */
  model?: string
}

/** Schemastery schema for the full plugin configuration. */
export const Config: z<Config> = z.object({
  welcome: z.string(),
  sessionId: z.string().default('main'),
  model: z.string(),
  ...tuiConfigSchemaFields,
})

/** Fully defaulted TUI theme settings. */
export interface ResolvedTuiThemeConfig {
  color: boolean
  truecolor: boolean
}

/** Fully defaulted TUI presentation settings. */
export interface ResolvedTuiConfig {
  showReasoning: boolean
  maxToolOutputLines: number
  maxDiffEditLength: number
  maxQuestionOptions: number
  maxModelOptions: number
  maxResumeOptions: number
  resumeScanConcurrency: number
  questionDialogWidth: number
  questionDialogMaxHeight: number
  modelDialogWidth: number
  modelDialogMaxHeight: number
  fileSearchMaxResults: number
  fileSearchMaxEntries: number
  fileSearchExcludedDirectories: string[]
  showHardwareCursor: boolean
  maxInitialMessages: number
  historyPageSize: number
  transcriptResidentMaxBytes: number
  cardCacheEntries: number
  statusIntervalMs: number
  theme: ResolvedTuiThemeConfig
  title: string
}

/**
 * Apply direct-call defaults after Loader schema validation has normally run.
 *
 * @param config - Deployment-provided terminal presentation settings.
 * @returns Complete settings consumed by the TUI renderer.
 */
export function resolveTuiConfig(config: TuiConfig | undefined): ResolvedTuiConfig {
  return {
    showReasoning: config?.showReasoning ?? true,
    maxToolOutputLines: config?.maxToolOutputLines ?? 6,
    maxDiffEditLength: config?.maxDiffEditLength ?? 1000,
    maxQuestionOptions: config?.maxQuestionOptions ?? 8,
    maxModelOptions: config?.maxModelOptions ?? 8,
    maxResumeOptions: config?.maxResumeOptions ?? 8,
    resumeScanConcurrency: config?.resumeScanConcurrency ?? 4,
    questionDialogWidth: config?.questionDialogWidth ?? 200,
    questionDialogMaxHeight: config?.questionDialogMaxHeight ?? 20,
    modelDialogWidth: config?.modelDialogWidth ?? 76,
    modelDialogMaxHeight: config?.modelDialogMaxHeight ?? 20,
    fileSearchMaxResults: config?.fileSearchMaxResults ?? DEFAULT_FILE_SEARCH_MAX_RESULTS,
    fileSearchMaxEntries: config?.fileSearchMaxEntries ?? DEFAULT_FILE_SEARCH_MAX_ENTRIES,
    fileSearchExcludedDirectories: [...(config?.fileSearchExcludedDirectories ?? DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES)],
    showHardwareCursor: config?.showHardwareCursor ?? false,
    maxInitialMessages: config?.maxInitialMessages ?? 200,
    historyPageSize: config?.historyPageSize ?? 100,
    transcriptResidentMaxBytes: config?.transcriptResidentMaxBytes ?? 4_194_304,
    cardCacheEntries: config?.cardCacheEntries ?? 2000,
    statusIntervalMs: config?.statusIntervalMs ?? 500,
    theme: {
      color: config?.theme?.color ?? true,
      truecolor: config?.theme?.truecolor ?? false,
    },
    title: config?.title ?? 'DeepSeek Harness',
  }
}

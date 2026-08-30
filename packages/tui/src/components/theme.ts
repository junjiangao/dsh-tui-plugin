/**
 * Theme-agnostic ANSI palette and derived pi-tui themes for the terminal front
 * door. The palette is built from the standard 16-color ANSI set plus SGR
 * attributes so every terminal remaps it to its active color scheme.
 * @module @deepseek-ai/dsh-tui/components/theme
 */

import type {
  MarkdownTheme,
  SelectListTheme,
  TerminalColorScheme,
} from '@earendil-works/pi-tui'

/**
 * Text carrying exactly one palette color. Branded so the compiler rejects
 * wrapping it in a second color: SGR has no color stack, so an inner span's
 * close reverts to the default foreground rather than the outer color, which
 * silently drops the outer color for the remainder of the line.
 */
export type Colored = string & { readonly __coloredBy: unique symbol }

/**
 * Text a color may still be applied to: a bare string, or one already carrying
 * SGR attributes. Attributes (bold, italic, underline, strike, reverse) occupy
 * independent SGR groups from the foreground color, so they compose in either
 * order without either side clobbering the other.
 */
export type Colorable = string & { readonly __coloredBy?: undefined }

/** Applies one color role; rejects input that already carries a color. */
export type ColorRole = (text: Colorable) => Colored

/** Applies one SGR attribute; accepts colored or uncolored text and preserves its color. */
export type AttributeRole = <T extends string>(text: T) => T

/** Applies one SGR background; accepts colored or uncolored text and preserves its foreground. */
export type BackgroundRole = (text: string) => string

/**
 * Theme-agnostic role colors and SGR attribute wrappers.
 *
 * One role per visual meaning: `dim` is the single recessed tone, `accent` the
 * single emphasis color, and `success`/`error` double as a diff's added/removed
 * pair. Roles that resolved to the same escape were merged rather than kept as
 * aliases, so a reader cannot pick a name that silently renders as another.
 */
export interface Palette {
  accent: ColorRole
  /** DeepSeek brand ink; exact gradient callers may override it on truecolor terminals. */
  brand: ColorRole
  /** The terminal's own default foreground; still a color, so it does not stack. */
  text: ColorRole
  /** The one recessed tone, below `text`: tool-card bodies, chrome, reasoning, footers. */
  dim: ColorRole
  success: ColorRole
  warning: ColorRole
  error: ColorRole
  code: ColorRole
  /** The one recessed background tone: message-body panels and cards. */
  panel: BackgroundRole
  bold: AttributeRole
  italic: AttributeRole
  underline: AttributeRole
  strike: AttributeRole
  /** Reverse video for the active selection; swaps the theme's own fg/bg so it reads on any scheme. */
  selected: AttributeRole
}

/** Names of the palette's color roles, in the order `/palette` prints them. */
export const COLOR_ROLES = ['text', 'dim', 'accent', 'brand', 'code', 'success', 'warning', 'error'] as const

/** Names of the palette's attribute roles, in the order `/palette` prints them. */
export const ATTRIBUTE_ROLES = ['bold', 'italic', 'underline', 'strike', 'selected'] as const

/** Names of the palette's background roles, in the order `/palette` prints them. */
export const BACKGROUND_ROLES = ['panel'] as const

/** One role's SGR parameters and the reason it carries them. */
export interface RoleSpec {
  /** SGR parameters that open the span, without the `ESC [` prefix or `m` suffix. */
  readonly open: string
  /** SGR parameters that close it; MUST reset every group `open` sets. */
  readonly close: string
  /** What the role means, shown by `/palette`. */
  readonly purpose: string
}

/**
 * Every SGR code the TUI is allowed to emit, keyed by role. This table is the
 * single source: {@link createPalette} derives the wrappers from it, so no
 * component hand-writes an escape.
 *
 * Only the standard 16-color set and SGR attributes appear here. Terminals remap
 * those to the user's active theme, so the TUI stays legible on any background.
 *
 * @param scheme - Active terminal color scheme; only `code` differs between them.
 * @returns The SGR spec for every color, background, and attribute role.
 */
export function paletteSpec(scheme: TerminalColorScheme): {
  readonly colors: Readonly<Record<typeof COLOR_ROLES[number], RoleSpec>>
  readonly backgrounds: Readonly<Record<typeof BACKGROUND_ROLES[number], RoleSpec>>
  readonly attributes: Readonly<Record<typeof ATTRIBUTE_ROLES[number], RoleSpec>>
} {
  return {
    colors: {
      // The terminal's own foreground, emitted as no escape at all: ordinary body
      // text must inherit whatever the user's theme uses.
      text: { open: '', close: '', purpose: 'Body text, the terminal default foreground' },
      // SGR 2 over an explicit default foreground, closing both groups it sets.
      dim: { open: '2;39', close: '22;39', purpose: 'The one recessed tone: tool bodies, chrome, footers' },
      accent: { open: '95', close: '39', purpose: 'The one emphasis color: role headers, prompt, borders' },
      brand: { open: '34', close: '39', purpose: 'DeepSeek brand art when truecolor is unavailable' },
      // ANSI 36 (cyan) is difficult to read on a light background — use ANSI 34
      // (blue) which is legible on both light and dark schemes.
      code: scheme === 'light'
        ? { open: '34', close: '39', purpose: 'Inline code and code blocks in prose' }
        : { open: '36', close: '39', purpose: 'Inline code and code blocks in prose' },
      success: { open: '32', close: '39', purpose: 'Succeeded calls, and a diff\'s added lines' },
      warning: { open: '33', close: '39', purpose: 'Pending calls and warnings' },
      error: { open: '31', close: '39', purpose: 'Failures, signals, and a diff\'s removed lines' },
    },
    backgrounds: {
      // Bright black (ANSI 100) is a neutral recessed panel in both dark and
      // light terminal themes without leaving the standard 16-color set.
      panel: { open: '100', close: '49', purpose: 'Message-body panels and cards' },
    },
    attributes: {
      bold: { open: '1', close: '22', purpose: 'Emphasis; composes with any color' },
      italic: { open: '3', close: '23', purpose: 'Reasoning text' },
      underline: { open: '4', close: '24', purpose: 'Role-header banding' },
      strike: { open: '9', close: '29', purpose: 'Struck-through Markdown' },
      selected: { open: '7', close: '27', purpose: 'Reverse video for the active selection' },
    },
  }
}

/**
 * Wrap text in an SGR pair, or pass it through when color is disabled.
 * An empty `open` emits nothing, so the `text` role costs no escape.
 */
function ansi(spec: RoleSpec, enabled: boolean): (text: string) => string {
  if (!enabled || spec.open === '') return text => text
  return text => `\x1b[${spec.open}m${text}\x1b[${spec.close}m`
}

/**
 * Theme-agnostic palette derived from {@link paletteSpec}. Body `text` stays the
 * terminal's default foreground so it reads on light and dark backgrounds alike.
 *
 * @param enabled - Whether ANSI is emitted at all.
 * @param scheme - Active terminal color scheme; adjusts the code role.
 * @returns The role palette for the given scheme.
 */
export function createPalette(enabled: boolean, scheme: TerminalColorScheme = 'dark'): Palette {
  const spec = paletteSpec(scheme)
  const roles = {} as Record<string, unknown>
  for (const name of COLOR_ROLES) roles[name] = ansi(spec.colors[name], enabled)
  for (const name of BACKGROUND_ROLES) roles[name] = ansi(spec.backgrounds[name], enabled)
  for (const name of ATTRIBUTE_ROLES) roles[name] = ansi(spec.attributes[name], enabled)
  return roles as unknown as Palette
}

/**
 * DeepSeek brand gradient stops (indigo → light blue) taken from the
 * deepseek.com logo, painted across the startup banner's product name on
 * truecolor terminals. Fixed brand identity, deliberately outside the
 * theme-adaptive {@link Palette}.
 */
const BRAND_GRADIENT = [
  [77, 107, 254], // #4D6BFE
  [57, 130, 255], // #3982FF
  [36, 152, 255], // #2498FF
] as const

/** Official DeepSeek icon ink from the shipped 24x24 SVG. */
const DEEPSEEK_BRAND_RGB = BRAND_GRADIENT[0]

/**
 * Paint trusted static DeepSeek brand art with the official `#4D6BFE` ink.
 * @param text - Static brand text or raster cells.
 * @returns text wrapped in the official truecolor foreground and a foreground reset.
 */
export function brandText(text: string): string {
  const [r, g, b] = DEEPSEEK_BRAND_RGB
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`
}

/**
 * Sample {@link BRAND_GRADIENT} at fraction `t` via piecewise-linear
 * interpolation across its stops.
 *
 * @param t - Position along the gradient; clamped to [0, 1].
 * @returns The interpolated `[r, g, b]` channels, each rounded to 0–255.
 */
function brandColorAt(t: number): readonly [number, number, number] {
  const span = Math.min(Math.max(t, 0), 1) * (BRAND_GRADIENT.length - 1)
  const index = Math.min(Math.floor(span), BRAND_GRADIENT.length - 2)
  const local = span - index
  // `index` is clamped to a valid adjacent pair, so both lookups are in-bounds.
  const from = BRAND_GRADIENT[index] as readonly [number, number, number]
  const to = BRAND_GRADIENT[index + 1] as readonly [number, number, number]
  return [
    Math.round(from[0] + (to[0] - from[0]) * local),
    Math.round(from[1] + (to[1] - from[1]) * local),
    Math.round(from[2] + (to[2] - from[2]) * local),
  ]
}

/**
 * Paint `text` left-to-right in the DeepSeek brand gradient with per-character
 * 24-bit foreground codes, resetting to the default foreground at the end.
 * Foreground-only, so it stays legible on any terminal background; the caller
 * gates it on truecolor support and wraps it in bold.
 *
 * @param text - Text to colorize; sampled once per character.
 * @returns `text` wrapped in truecolor SGR foreground codes.
 */
export function gradientText(text: string): string {
  const glyphs = Array.from(text)
  const last = Math.max(1, glyphs.length - 1)
  let painted = ''
  for (let index = 0; index < glyphs.length; index += 1) {
    const [r, g, b] = brandColorAt(index / last)
    painted += `\x1b[38;2;${r};${g};${b}m${glyphs[index]}`
  }
  return `${painted}\x1b[39m`
}

/**
 * Derive the pi-tui Markdown theme from a role palette.
 * @param palette - Active role palette.
 * @returns The Markdown theme wired to palette roles.
 */
export function markdownTheme(palette: Palette): MarkdownTheme {
  return {
    heading: text => palette.accent(text),
    link: text => palette.accent(text),
    // pi-tui requires this URL slot but its current Markdown renderer does not invoke it.
    /* v8 ignore next */
    linkUrl: text => palette.dim(text),
    code: text => palette.code(text),
    codeBlock: text => palette.code(text),
    // pi-tui presents both fence rows through this callback. Keep the opening
    // language label, but hide Markdown syntax and the otherwise-empty close.
    codeBlockBorder: text => palette.dim(text.slice(3)),
    quote: text => palette.dim(text),
    quoteBorder: text => palette.accent(text),
    hr: text => palette.dim(text),
    listBullet: text => palette.accent(text),
    bold: text => palette.bold(text),
    italic: text => palette.italic(text),
    strikethrough: text => palette.strike(text),
    underline: text => palette.underline(text),
  }
}

/**
 * Derive the pi-tui select-list theme from a role palette.
 * @param palette - Active role palette.
 * @returns The select-list theme wired to palette roles.
 */
export function selectTheme(palette: Palette): SelectListTheme {
  return {
    selectedPrefix: palette.accent,
    selectedText: palette.accent,
    description: palette.dim,
    scrollInfo: palette.dim,
    noMatch: palette.warning,
  }
}

/** The painted swatch every /palette sample row uses. */
const PALETTE_SAMPLE = '████'

/**
 * Render the complete role palette as transcript rows: each color role's name,
 * SGR pair, and purpose, plus the attribute roles that compose with any color.
 * @param palette - Active role palette.
 * @param scheme - The color scheme the palette was built for.
 * @param colorEnabled - Whether the palette applies its escapes.
 * @returns The painted rows the /palette command appends to the transcript.
 */
export function renderPalette(
  palette: Palette,
  scheme: TerminalColorScheme,
  colorEnabled: boolean,
): string[] {
  const spec = paletteSpec(scheme)
  const width = Math.max(...[...COLOR_ROLES, ...BACKGROUND_ROLES, ...ATTRIBUTE_ROLES].map(name => name.length))
  // Two rows per role: the painted sample beside its name and SGR pair, then the
  // purpose indented under it. Splitting the purpose onto its own row keeps every
  // sample on one visual line at the narrow widths a side-by-side pane gives.
  const head = (name: string, role: RoleSpec, sample: string): string => {
    const pair = role.open === '' ? 'no escape' : `ESC[${role.open}m ESC[${role.close}m`
    return `  ${sample}  ${palette.dim(`${name.padEnd(width)} ${pair}`)}`
  }
  const purpose = (role: RoleSpec): string => `  ${palette.dim(`    ${role.purpose}`)}`
  const rows = [
    palette.bold(palette.accent('Palette')),
    palette.dim(`${scheme} scheme · color ${colorEnabled ? 'on' : 'off'}`),
    '',
    palette.dim('Colors — exactly one per span; they never nest inside each other.'),
  ]
  for (const name of COLOR_ROLES) {
    rows.push(head(name, spec.colors[name], palette[name](PALETTE_SAMPLE)), purpose(spec.colors[name]))
  }
  rows.push('', palette.dim('Backgrounds — one recessed panel tone; compose with any foreground.'))
  for (const name of BACKGROUND_ROLES) {
    rows.push(head(name, spec.backgrounds[name], palette[name](PALETTE_SAMPLE)), purpose(spec.backgrounds[name]))
  }
  rows.push('', palette.dim('Attributes — compose with any color, in either order.'))
  for (const name of ATTRIBUTE_ROLES) {
    rows.push(head(name, spec.attributes[name], palette[name](PALETTE_SAMPLE)), purpose(spec.attributes[name]))
  }
  return rows
}

/**
 * features/channels/skin/schema.ts
 * ---------------------------------------------------------------------------
 * `OutletSkinTokens` (FC-3b): the type and the runtime schema of one skin
 * token file (channels-foundation story 13, D3-P1 / D3-P2).
 *
 * The token set IS the D3-P2 **CAN** list and nothing else: type stack,
 * palette, density, media treatment, breaking treatment, byline/dateline
 * format, layout enums and the sanctioned clutter set, plus the `ext.<ns>`
 * channel namespaces. The **CANNOT** list (slot order, the scenario-time
 * source, the Pulse embed/link-card, the watermark slot, share behaviour,
 * comments, the a11y floor, telemetry invisibility) is unreachable because no
 * key addresses it: every object schema here is `strict`, so an unknown key is
 * rejected rather than silently carried.
 *
 * The enum values come from the news skin stories (news 10..13) and D3-P3.
 * The server allowlist (`ISkinOverridesValidator`, story 03) mirrors this
 * file; change both together.
 *
 * World: participant. Pure data; no React, no MUI, no COBRA.
 */

import { z } from 'zod'

/** The token schema version (FC-3b). A token file declares it literally. */
export const SKIN_SCHEMA_VERSION = 1

/**
 * The one skin key allowed to use `clutter` and `layout.homeLead: 'clutter'`
 * (D3-P2: busyness as an untrustworthiness signal, The Scoop only). Equals the
 * `skinKey` story 03 seeds for The Scoop.
 */
export const TABLOID_SKIN_KEY = 'the-scoop'

/** The neutral fallback skin key: never replaceable, always registered. */
export const NEUTRAL_SKIN_KEY = 'neutral'

export const HED_CASES = ['none', 'uppercase', 'small-caps'] as const
export const CROP_AGGRESSIONS = ['low', 'medium', 'high'] as const
export const CAPTION_STYLES = ['plain', 'italic-serif', 'small-caps', 'shouty'] as const
export const BREAKING_STYLES = ['bar', 'rule', 'slug', 'rotated-flag'] as const
export const HOME_LEADS = ['video-lead', 'text-lead', 'list-lead', 'clutter'] as const
/** The sanctioned clutter-module set (D3-P3, The Scoop only). */
export const CLUTTER_MODULES = ['chip-row', 'rotated-flag', 'highlight-mark'] as const
/** The `ext.<ns>` channel namespaces (FC-8a; mirrors F03's server allowlist). */
export const SKIN_EXT_NAMESPACES = ['news', 'press', 'weather', 'portal'] as const

export type HedCase = (typeof HED_CASES)[number]
export type CropAggression = (typeof CROP_AGGRESSIONS)[number]
export type CaptionStyle = (typeof CAPTION_STYLES)[number]
export type BreakingStyle = (typeof BREAKING_STYLES)[number]
export type HomeLead = (typeof HOME_LEADS)[number]
export type ClutterModule = (typeof CLUTTER_MODULES)[number]
export type SkinExtNamespace = (typeof SKIN_EXT_NAMESPACES)[number]

/** A flat `ext.<ns>` value (F03: scalar or string array, no nesting). */
export type SkinExtValue = string | number | boolean | readonly string[]

/** One `ext.<ns>` bag. */
export type SkinExtBag = Readonly<Record<string, SkinExtValue>>

/** `#rgb` or `#rrggbb`: the only colour forms the contrast check can read. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * The generic families a font stack must end with, so a missing or blocked
 * self-hosted face always falls back to a declared generic (story 13 AC).
 */
export const GENERIC_FONT_FAMILIES = [
  'serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy',
  'ui-serif', 'ui-sans-serif', 'ui-monospace',
] as const

/** One family in a stack: a plain name, or a name in matching single or double quotes. */
const FAMILY = /[A-Za-z0-9][A-Za-z0-9 -]*/.source
const FAMILY_NAME = new RegExp(`^(?:${FAMILY}|'${FAMILY}'|"${FAMILY}")$`)

/**
 * A CSS font stack: comma-separated family names, no declarations, no
 * `url(...)`, ending in a generic family. Token files name stacks only; the
 * faces themselves come from `registerSkinFonts`.
 */
export function isFontStack(value: string): boolean {
  if (value.length === 0 || value.length > 200) return false
  if (/[;{}<>()\\]/.test(value)) return false
  const parts = value.split(',').map(p => p.trim())
  if (!parts.every(p => FAMILY_NAME.test(p))) return false
  const last = parts[parts.length - 1]?.toLowerCase() ?? ''
  return (GENERIC_FONT_FAMILIES as readonly string[]).includes(last)
}

const colorSchema = z.string().regex(HEX_COLOR, 'expected #rgb or #rrggbb')
const fontStackSchema = z.string().refine(isFontStack, 'expected a font stack ending in a generic family')

const typeSchema = z.strictObject({
  mastheadFamily: fontStackSchema,
  hedFamily: fontStackSchema,
  dekFamily: fontStackSchema,
  bodyFamily: fontStackSchema,
  kickerFamily: fontStackSchema,
  hedCase: z.enum(HED_CASES),
})

const paletteSchema = z.strictObject({
  accent: colorSchema,
  link: colorSchema,
  bg: colorSchema,
  surface: colorSchema,
  text: colorSchema,
  rule: colorSchema,
  breaking: colorSchema,
})

const densitySchema = z.strictObject({
  /** Multiplier on the 8px spacing unit. */
  spacingScale: z.number().min(0.5).max(2),
  /** Rule thickness in px. */
  ruleWeight: z.number().min(0).max(6),
  /** Corner radius in px. */
  radius: z.number().min(0).max(24),
})

const mediaSchema = z.strictObject({
  cropAggression: z.enum(CROP_AGGRESSIONS),
  captionStyle: z.enum(CAPTION_STYLES),
  playerTint: colorSchema,
})

const breakingSchema = z.strictObject({
  style: z.enum(BREAKING_STYLES),
  /** The outlet's own label ("BREAKING NEWS", "News Alert"); may be empty. */
  vocabulary: z.string().max(40),
})

const bylineSchema = z.strictObject({
  /** A template; `{name}` is the persona's display name ("By {name}, Staff Writer"). */
  format: z.string().min(1).max(80),
})

const datelineSchema = z.strictObject({
  /** A dateline format id registered with F14's `registerDatelineFormat`. */
  format: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'expected a dateline format id'),
})

const layoutSchema = z.strictObject({
  rail: z.boolean(),
  homeLead: z.enum(HOME_LEADS),
})

const extValueSchema = z.union([
  z.string().max(500),
  z.number().refine(Number.isFinite),
  z.boolean(),
  z.array(z.string().max(200)).max(20),
])

const extKeySchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/)

/**
 * `ext` is structurally loose here (any namespace, flat values); each
 * namespace is then checked against its registered schema at resolve time
 * (`registerSkinExtension`), and an unregistered namespace is dropped.
 */
const extSchema = z.record(z.string(), z.record(extKeySchema, extValueSchema))

/** The full token file schema (FC-3b). */
export const outletSkinTokensSchema = z.strictObject({
  schemaVersion: z.literal(SKIN_SCHEMA_VERSION),
  type: typeSchema,
  palette: paletteSchema,
  density: densitySchema,
  media: mediaSchema,
  breaking: breakingSchema,
  byline: bylineSchema,
  dateline: datelineSchema,
  layout: layoutSchema,
  clutter: z.array(z.enum(CLUTTER_MODULES)).max(CLUTTER_MODULES.length).optional(),
  ext: extSchema.optional(),
})

/**
 * The partial override schema for `OutletDto.skinOverrides`: every section is
 * optional and every key inside a section is optional, but unknown keys are
 * still rejected. `schemaVersion` may be omitted (it is the base file's).
 */
export const skinOverridesSchema = z.strictObject({
  schemaVersion: z.literal(SKIN_SCHEMA_VERSION).optional(),
  type: typeSchema.partial().optional(),
  palette: paletteSchema.partial().optional(),
  density: densitySchema.partial().optional(),
  media: mediaSchema.partial().optional(),
  breaking: breakingSchema.partial().optional(),
  byline: bylineSchema.partial().optional(),
  dateline: datelineSchema.partial().optional(),
  layout: layoutSchema.partial().optional(),
  clutter: z.array(z.enum(CLUTTER_MODULES)).max(CLUTTER_MODULES.length).optional(),
  ext: extSchema.optional(),
})

/** Recursively readonly, so a resolved token object cannot be mutated by a consumer. */
type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T

/** One skin token file (FC-3b, the D3-P2 CAN list). */
export type OutletSkinTokens = DeepReadonly<Omit<z.infer<typeof outletSkinTokensSchema>, 'ext'>> & {
  readonly ext?: Readonly<Record<string, SkinExtBag>>
}

/** A partial token set (`OutletDto.skinOverrides`). */
export type OutletSkinOverrides = DeepReadonly<Omit<z.infer<typeof skinOverridesSchema>, 'ext'>> & {
  readonly ext?: Readonly<Record<string, SkinExtBag>>
}

export type OutletSkinPalette = OutletSkinTokens['palette']
export type PaletteKey = keyof OutletSkinPalette

/** The top-level keys of a token file: the CAN list, exactly. */
export const SKIN_TOKEN_KEYS =
  Object.keys(outletSkinTokensSchema.shape) as readonly (keyof OutletSkinTokens)[]

/** Joins zod issues into one readable line for a dev report. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map(issue => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ')
}

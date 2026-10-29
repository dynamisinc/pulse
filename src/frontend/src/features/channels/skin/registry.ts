/**
 * features/channels/skin/registry.ts
 * ---------------------------------------------------------------------------
 * The skin registry and its three external registration calls (FC-8a, story
 * 13; news FU-3/FU-4, press FU-1, weather FU-4, portal FU-4a).
 *
 * A channel registers FROM ITS OWN FOLDER, as a side effect of importing its
 * channel module, and never edits `features/channels/skin/**`:
 *
 *   registerSkinTokens('newsline7', newsline7Tokens, { fonts: newsline7Fonts })
 *   registerSkinExtension('news', newsExtensionSchema)
 *
 * This file ships only the neutral fallback and two REPLACEABLE stubs
 * (`wire-room`, `weather-desk`). A channel registration replaces a stub once;
 * a second, different registration of any other key is a dev-time error (an
 * identical one, e.g. a module evaluated twice, is a no-op). `neutral` can
 * never be registered over.
 *
 * Registration validates eagerly so a bad token file fails at import time in
 * dev: the FC-3b schema, the clutter guard (only the tabloid key may use
 * clutter) and the font contract (`./fonts.ts`). The a11y floor is applied
 * later, when a scope mounts, because it must also cover overrides and
 * token objects that never pass through here.
 *
 * Consumers re-render on registration through `subscribeSkinRegistry` /
 * `getSkinRegistryVersion` (a `useSyncExternalStore` source), so a channel
 * chunk that registers after a scope mounted still re-skins it.
 */

import {
  NEUTRAL_SKIN_KEY,
  SKIN_EXT_NAMESPACES,
  TABLOID_SKIN_KEY,
  describeIssues,
  outletSkinTokensSchema,
  type OutletSkinTokens,
  type SkinExtNamespace,
} from './schema'
import { fontFaceProblem, type SkinFontFace } from './fonts'
import { skinDevError } from './report'
import { NEUTRAL_SKIN_TOKENS } from './tokens/neutral'
import { WIRE_ROOM_STUB_TOKENS } from './tokens/wire-room'
import { WEATHER_DESK_STUB_TOKENS } from './tokens/weather-desk'

/** How one `ext.<ns>` key is declared. */
export type SkinExtKeySpec =
  | { readonly type: 'string'; readonly maxLength?: number }
  | { readonly type: 'number'; readonly min?: number; readonly max?: number }
  | { readonly type: 'boolean' }
  | { readonly type: 'string[]' }
  | { readonly type: 'enum'; readonly values: readonly string[] }
  /**
   * A colour; it enters the AA contrast check against `against` (default
   * `bg`): 4.5:1, or 3:1 when `large` (large text, fills, icons).
   */
  | { readonly type: 'color'; readonly against?: 'bg' | 'surface'; readonly large?: boolean }

/** An `ext.<ns>` schema: the allowed keys and how each is checked. */
export interface SkinExtensionSchema {
  readonly keys: Readonly<Record<string, SkinExtKeySpec>>
}

/** Options for `registerSkinTokens`. */
export interface RegisterSkinTokensOptions {
  /** The skin's self-hosted faces; same as calling `registerSkinFonts`. */
  readonly fonts?: readonly SkinFontFace[]
}

interface TokenEntry {
  readonly tokens: OutletSkinTokens
  /** A shipped stub a channel may replace once. */
  readonly stub: boolean
}

const SKIN_KEY = /^[a-z][a-z0-9-]{0,39}$/

const tokens = new Map<string, TokenEntry>()
const fonts = new Map<string, readonly SkinFontFace[]>()
const extensions = new Map<SkinExtNamespace, SkinExtensionSchema>()
const listeners = new Set<() => void>()
let version = 0

function seed(): void {
  tokens.clear()
  fonts.clear()
  extensions.clear()
  tokens.set(NEUTRAL_SKIN_KEY, { tokens: NEUTRAL_SKIN_TOKENS, stub: false })
  tokens.set('wire-room', { tokens: WIRE_ROOM_STUB_TOKENS, stub: true })
  tokens.set('weather-desk', { tokens: WEATHER_DESK_STUB_TOKENS, stub: true })
}
seed()

function changed(): void {
  version += 1
  for (const listener of listeners) listener()
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Registers a skin token file under `skinKey` (FC-8a). Call it at module top
 * level in the channel's own folder. Invalid tokens, a clutter-bearing file
 * under a non-tabloid key, a second different registration, or an attempt to
 * replace `neutral` are dev-time errors.
 */
export function registerSkinTokens(
  skinKey: string,
  skinTokens: OutletSkinTokens,
  options: RegisterSkinTokensOptions = {},
): void {
  if (!SKIN_KEY.test(skinKey)) {
    skinDevError(`"${skinKey}" is not a valid skin key (lowercase letters, digits, hyphens)`)
    return
  }
  if (skinKey === NEUTRAL_SKIN_KEY) {
    skinDevError('the neutral skin is the fallback and cannot be registered over')
    return
  }
  const parsed = outletSkinTokensSchema.safeParse(skinTokens)
  if (!parsed.success) {
    skinDevError(`skin "${skinKey}" does not match OutletSkinTokens: ${describeIssues(parsed.error)}`)
    return
  }
  if (skinKey !== TABLOID_SKIN_KEY &&
    (skinTokens.clutter !== undefined || skinTokens.layout.homeLead === 'clutter')) {
    skinDevError(`skin "${skinKey}" uses clutter, which only the "${TABLOID_SKIN_KEY}" skin may use`)
    return
  }
  const existing = tokens.get(skinKey)
  if (existing && !existing.stub) {
    if (!sameJson(existing.tokens, skinTokens)) {
      skinDevError(`skin "${skinKey}" is already registered`)
    }
    return
  }
  tokens.set(skinKey, { tokens: skinTokens, stub: false })
  if (options.fonts) registerSkinFonts(skinKey, options.fonts)
  changed()
}

/**
 * Registers the self-hosted faces a skin's stacks name (news FU-4). Nothing
 * loads here: the faces load when a `SkinScope` for `skinKey` mounts. Every
 * face must be a same-origin `.woff2` file (see `./fonts.ts`).
 */
export function registerSkinFonts(skinKey: string, faces: readonly SkinFontFace[]): void {
  const problems = faces.map(face => fontFaceProblem(face)).filter(p => p !== null)
  if (problems.length > 0) {
    skinDevError(`skin "${skinKey}" fonts rejected: ${problems.join('; ')}`)
    return
  }
  const existing = fonts.get(skinKey)
  if (existing) {
    if (!sameJson(existing, faces)) skinDevError(`fonts for skin "${skinKey}" are already registered`)
    return
  }
  fonts.set(skinKey, [...faces])
  changed()
}

/**
 * Declares the `ext.<ns>` schema for one channel namespace (`news`, `press`,
 * `weather`, `portal`). Keys outside the schema are dropped at resolve time;
 * keys declared `color` enter the AA contrast check. It mirrors F03's server
 * allowlist (`ISkinOverridesValidator`).
 */
export function registerSkinExtension(ns: SkinExtNamespace, schema: SkinExtensionSchema): void {
  if (!(SKIN_EXT_NAMESPACES as readonly string[]).includes(ns)) {
    skinDevError(`"${ns}" is not a skin extension namespace (${SKIN_EXT_NAMESPACES.join(', ')})`)
    return
  }
  const existing = extensions.get(ns)
  if (existing) {
    if (!sameJson(existing, schema)) skinDevError(`ext.${ns} is already registered`)
    return
  }
  extensions.set(ns, schema)
  changed()
}

/** The registered token file for `skinKey`, or `undefined`. */
export function getSkinTokens(skinKey: string): OutletSkinTokens | undefined {
  return tokens.get(skinKey)?.tokens
}

/** Whether `skinKey` still holds its shipped stub. */
export function isStubSkin(skinKey: string): boolean {
  return tokens.get(skinKey)?.stub === true
}

/** The faces registered for `skinKey` (empty when none). */
export function getSkinFonts(skinKey: string): readonly SkinFontFace[] {
  return fonts.get(skinKey) ?? []
}

/** The registered `ext.<ns>` schema, or `undefined`. */
export function getSkinExtension(ns: string): SkinExtensionSchema | undefined {
  return extensions.get(ns as SkinExtNamespace)
}

/** `useSyncExternalStore` subscribe. */
export function subscribeSkinRegistry(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** `useSyncExternalStore` snapshot: bumps on every successful registration. */
export function getSkinRegistryVersion(): number {
  return version
}

/** Test-only: back to neutral + the two stubs, no fonts, no extensions. */
export function resetSkinRegistryForTests(): void {
  seed()
  changed()
}

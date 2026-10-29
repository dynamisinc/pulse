/**
 * features/channels/skin/resolve.ts
 * ---------------------------------------------------------------------------
 * Turning a skin key, overrides or a raw token object into the tokens that
 * actually render (story 13):
 *
 *  1. `mergeSkinTokens(skinKey, overrides)`: the registry token file ⊕ the
 *     validated overrides. An unknown key falls back to neutral (logged
 *     once); invalid overrides are ignored (reported in dev; the server
 *     rejects them first, story 03).
 *  2. `finalizeSkinTokens(tokens, skinKey)`: the guards no token can bypass,
 *     run by `SkinScope` on whatever it mounts: schema check, the clutter
 *     guard (tabloid key only), the AA contrast floor, and the `ext.<ns>`
 *     schemas (unregistered namespaces dropped, colour keys AA-checked).
 *
 * World: participant. Pure functions over the registry.
 */

import {
  NEUTRAL_SKIN_KEY,
  TABLOID_SKIN_KEY,
  describeIssues,
  outletSkinTokensSchema,
  skinOverridesSchema,
  type OutletSkinOverrides,
  type OutletSkinPalette,
  type OutletSkinTokens,
  type SkinExtBag,
  type SkinExtValue,
} from './schema'
import { AA_BODY, AA_LARGE, applyContrastFloor, contrastRatio, parseHex } from './contrast'
import { getSkinExtension, getSkinTokens, type SkinExtKeySpec } from './registry'
import { reportSkinIssue } from './report'
import { NEUTRAL_SKIN_TOKENS } from './tokens/neutral'

/** The `ext` size cap (bytes of JSON), mirroring F03's 4 KB server cap. */
export const SKIN_EXT_MAX_BYTES = 4096

/** The base tokens plus the key they actually came from. */
export interface MergedSkin {
  /** The registered key used: the requested one, or `neutral` when unknown. */
  readonly skinKey: string
  readonly tokens: OutletSkinTokens
}

/**
 * The registry token file for `skinKey` merged with `overrides`
 * (`OutletDto.skinOverrides`). Section-wise shallow merge; `clutter` is
 * replaced; `ext` merges per namespace.
 */
export function mergeSkinTokens(skinKey: string, overrides?: unknown): MergedSkin {
  let key = skinKey
  let base = getSkinTokens(skinKey)
  if (!base) {
    reportSkinIssue(`unknown-key:${skinKey}`, `unknown skinKey "${skinKey}"; using the neutral skin`, {
      always: true,
    })
    key = NEUTRAL_SKIN_KEY
    base = NEUTRAL_SKIN_TOKENS
  }
  if (overrides === null || overrides === undefined) return { skinKey: key, tokens: base }

  const parsed = skinOverridesSchema.safeParse(overrides)
  if (!parsed.success) {
    reportSkinIssue(
      `bad-overrides:${skinKey}:${JSON.stringify(overrides)}`,
      `skinOverrides for "${skinKey}" ignored: ${describeIssues(parsed.error)}`,
    )
    return { skinKey: key, tokens: base }
  }
  const over: OutletSkinOverrides = parsed.data
  const ext: Record<string, SkinExtBag> = { ...base.ext }
  for (const [ns, bag] of Object.entries(over.ext ?? {})) ext[ns] = { ...ext[ns], ...bag }

  const merged: OutletSkinTokens = {
    schemaVersion: base.schemaVersion,
    type: { ...base.type, ...over.type },
    palette: { ...base.palette, ...over.palette },
    density: { ...base.density, ...over.density },
    media: { ...base.media, ...over.media },
    breaking: { ...base.breaking, ...over.breaking },
    byline: { ...base.byline, ...over.byline },
    dateline: { ...base.dateline, ...over.dateline },
    layout: { ...base.layout, ...over.layout },
    ...(over.clutter ?? base.clutter ? { clutter: over.clutter ?? base.clutter } : {}),
    ...(Object.keys(ext).length > 0 ? { ext } : {}),
  }
  return { skinKey: key, tokens: merged }
}

function extValueMatches(spec: SkinExtKeySpec, value: SkinExtValue): boolean {
  switch (spec.type) {
    case 'string':
      return typeof value === 'string' && value.length <= (spec.maxLength ?? 500)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) &&
        value >= (spec.min ?? -Infinity) && value <= (spec.max ?? Infinity)
    case 'boolean':
      return typeof value === 'boolean'
    case 'string[]':
      return Array.isArray(value) && value.every(v => typeof v === 'string')
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value)
    case 'color':
      return typeof value === 'string' && parseHex(value) !== null
  }
}

/**
 * Validates `ext` against the registered namespace schemas, after the
 * palette floor: unregistered namespaces and undeclared or mistyped keys are
 * dropped; a colour key below AA against its declared background is clamped
 * to the (already AA) `text` colour. All reported in dev.
 */
function finalizeExt(
  ext: Readonly<Record<string, SkinExtBag>> | undefined,
  palette: OutletSkinPalette,
  label: string,
): Record<string, SkinExtBag> | undefined {
  if (!ext) return undefined
  if (JSON.stringify(ext).length > SKIN_EXT_MAX_BYTES) {
    reportSkinIssue(`ext-size:${label}`, `${label}: ext is over ${SKIN_EXT_MAX_BYTES} bytes; ignored`)
    return undefined
  }
  const out: Record<string, SkinExtBag> = {}
  for (const [ns, bag] of Object.entries(ext)) {
    const schema = getSkinExtension(ns)
    if (!schema) {
      reportSkinIssue(`ext-ns:${label}:${ns}`, `${label}: ext.${ns} is not a registered namespace; ignored`)
      continue
    }
    const kept: Record<string, SkinExtValue> = {}
    for (const [key, value] of Object.entries(bag)) {
      const spec = Object.hasOwn(schema.keys, key) ? schema.keys[key] : undefined
      if (!spec || !extValueMatches(spec, value)) {
        reportSkinIssue(`ext-key:${label}:${ns}.${key}`, `${label}: ext.${ns}.${key} is not allowed; ignored`)
        continue
      }
      if (spec.type === 'color' && typeof value === 'string') {
        const against = palette[spec.against ?? 'bg']
        const min = spec.large ? AA_LARGE : AA_BODY
        const ratio = contrastRatio(value, against)
        if (ratio < min) {
          reportSkinIssue(
            `ext-contrast:${label}:${ns}.${key}`,
            `${label}: ext.${ns}.${key} ${value} on ${against} is ${ratio.toFixed(2)}:1, below ${min}:1; ` +
            'clamped to the text colour',
          )
          kept[key] = palette.text
          continue
        }
      }
      kept[key] = value
    }
    out[ns] = kept
  }
  return out
}

/**
 * The guards every mounted token set passes through (see module header).
 * `skinKey` decides the clutter guard; a token object with no key (a
 * non-outlet scope) never gets clutter. Returns a NEW object; the input is
 * never mutated.
 */
export function finalizeSkinTokens(
  tokens: OutletSkinTokens,
  skinKey: string | undefined,
): OutletSkinTokens {
  const label = skinKey ? `skin "${skinKey}"` : 'skin'
  const parsed = outletSkinTokensSchema.safeParse(tokens)
  const valid: OutletSkinTokens = parsed.success ? tokens : NEUTRAL_SKIN_TOKENS
  if (!parsed.success) {
    reportSkinIssue(`bad-tokens:${label}:${JSON.stringify(tokens)}`,
      `${label} does not match OutletSkinTokens (${describeIssues(parsed.error)}); using the neutral skin`)
  }

  const tabloid = skinKey === TABLOID_SKIN_KEY
  let layout = valid.layout
  if (!tabloid && layout.homeLead === 'clutter') {
    reportSkinIssue(`clutter-lead:${label}`, `${label}: homeLead "clutter" is tabloid-only; ignored`)
    layout = { ...layout, homeLead: NEUTRAL_SKIN_TOKENS.layout.homeLead }
  }
  if (!tabloid && valid.clutter !== undefined) {
    reportSkinIssue(`clutter:${label}`, `${label}: clutter is tabloid-only; ignored`)
  }

  const floor = applyContrastFloor(valid.palette, NEUTRAL_SKIN_TOKENS.palette)
  if (floor.violations.length > 0) {
    reportSkinIssue(`contrast:${label}:${JSON.stringify(valid.palette)}`,
      `${label} palette clamped to the AA floor: ${floor.violations.join('; ')}`)
  }

  const ext = finalizeExt(valid.ext, floor.palette, label)
  return {
    schemaVersion: valid.schemaVersion,
    type: valid.type,
    palette: floor.palette,
    density: valid.density,
    media: valid.media,
    breaking: valid.breaking,
    byline: valid.byline,
    dateline: valid.dateline,
    layout,
    ...(tabloid && valid.clutter !== undefined ? { clutter: valid.clutter } : {}),
    ...(ext ? { ext } : {}),
  }
}

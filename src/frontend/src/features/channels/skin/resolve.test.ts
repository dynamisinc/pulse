/**
 * Story 13 ACs "Merge", "Clutter guard", "A11y floor" and "Extension
 * namespaces": the registry file ⊕ validated overrides, then the guards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeSkinTokens, mergeSkinTokens } from './resolve'
import { registerSkinExtension, registerSkinTokens, resetSkinRegistryForTests } from './registry'
import { resetSkinReportsForTests } from './report'
import type { OutletSkinTokens } from './schema'
import { NEUTRAL_SKIN_TOKENS } from './tokens/neutral'
import { WIRE_ROOM_STUB_TOKENS } from './tokens/wire-room'

const BASE: OutletSkinTokens = {
  ...NEUTRAL_SKIN_TOKENS,
  palette: { ...NEUTRAL_SKIN_TOKENS.palette, accent: '#0f2749' },
  breaking: { style: 'bar', vocabulary: 'BREAKING NEWS' },
  ext: { news: { masthead: 'tv-bar', liveChip: true } },
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warn.mockRestore()
  resetSkinRegistryForTests()
  resetSkinReportsForTests()
})

describe('mergeSkinTokens', () => {
  it('returns the registry token file when there are no overrides', () => {
    registerSkinTokens('newsline7', BASE)
    expect(mergeSkinTokens('newsline7', null)).toEqual({ skinKey: 'newsline7', tokens: BASE })
  })

  it('merges validated overrides section by section, and ext per namespace', () => {
    registerSkinTokens('newsline7', BASE)
    const { tokens } = mergeSkinTokens('newsline7', {
      palette: { accent: '#c8102e' },
      layout: { rail: true },
      ext: { news: { liveChip: false } },
    })
    expect(tokens.palette).toEqual({ ...BASE.palette, accent: '#c8102e' })
    expect(tokens.layout).toEqual({ ...BASE.layout, rail: true })
    expect(tokens.type).toEqual(BASE.type)
    expect(tokens.ext).toEqual({ news: { masthead: 'tv-bar', liveChip: false } })
  })

  it('ignores invalid overrides (reported in dev) and keeps the token file', () => {
    registerSkinTokens('newsline7', BASE)
    expect(mergeSkinTokens('newsline7', { watermark: false }).tokens).toBe(BASE)
    expect(mergeSkinTokens('newsline7', { palette: { accent: 'red' } }).tokens).toBe(BASE)
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/skinOverrides for "newsline7" ignored/),
    )
  })

  it('falls back to the neutral skin for an unknown key and logs once', () => {
    expect(mergeSkinTokens('no-such-skin', null)).toEqual({ skinKey: 'neutral', tokens: NEUTRAL_SKIN_TOKENS })
    mergeSkinTokens('no-such-skin', null)
    mergeSkinTokens('no-such-skin', { palette: { accent: '#000000' } })
    const unknown = warn.mock.calls.filter(
      (call: unknown[]) => String(call[0]).includes('unknown skinKey "no-such-skin"'),
    )
    expect(unknown).toHaveLength(1)
  })

  it('resolves a stub until its channel registers the final tokens', () => {
    expect(mergeSkinTokens('wire-room', null).tokens).toBe(WIRE_ROOM_STUB_TOKENS)
    registerSkinTokens('wire-room', BASE)
    expect(mergeSkinTokens('wire-room', null).tokens).toBe(BASE)
  })
})

describe('finalizeSkinTokens', () => {
  it('drops clutter and the clutter lead off the tabloid key', () => {
    const tokens: OutletSkinTokens = {
      ...NEUTRAL_SKIN_TOKENS, layout: { rail: true, homeLead: 'clutter' }, clutter: ['chip-row'],
    }
    const plain = finalizeSkinTokens(tokens, 'newsline7')
    expect(plain.clutter).toBeUndefined()
    expect(plain.layout).toEqual({ rail: true, homeLead: 'text-lead' })
    const keyless = finalizeSkinTokens(tokens, undefined)
    expect(keyless.clutter).toBeUndefined()

    const scoop = finalizeSkinTokens(tokens, 'the-scoop')
    expect(scoop.clutter).toEqual(['chip-row'])
    expect(scoop.layout.homeLead).toBe('clutter')
  })

  it('clamps a violating palette pair and reports it in dev; the floor cannot be overridden', () => {
    const loud = { ...NEUTRAL_SKIN_TOKENS, palette: { ...NEUTRAL_SKIN_TOKENS.palette, text: '#ffd400' } }
    const result = finalizeSkinTokens(loud, 'newsline7')
    expect(result.palette.text).toBe(NEUTRAL_SKIN_TOKENS.palette.text)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/palette clamped to the AA floor/))
  })

  it('uses the neutral skin for a token object that fails the schema', () => {
    const bad = { ...NEUTRAL_SKIN_TOKENS, palette: { ...NEUTRAL_SKIN_TOKENS.palette, bg: 'white' } }
    expect(finalizeSkinTokens(bad, 'portal').palette).toEqual(NEUTRAL_SKIN_TOKENS.palette)
  })

  it('ignores and reports an unregistered ext namespace', () => {
    const result = finalizeSkinTokens(BASE, 'newsline7')
    expect(result.ext).toEqual({})
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/ext\.news is not a registered namespace/),
    )
  })

  it('validates ext keys against the registered schema and AA-checks colour keys', () => {
    registerSkinExtension('news', {
      keys: {
        masthead: { type: 'enum', values: ['tv-bar', 'centered-nameplate'] },
        liveChip: { type: 'boolean' },
        chipColor: { type: 'color', large: true },
        labelColor: { type: 'color', against: 'surface' },
      },
    })
    const tokens: OutletSkinTokens = {
      ...BASE,
      ext: {
        news: {
          masthead: 'tv-bar',
          liveChip: 'yes',
          rogue: 1,
          chipColor: '#c8102e',
          labelColor: '#ffd400',
        },
      },
    }
    const result = finalizeSkinTokens(tokens, 'newsline7')
    expect(result.ext).toEqual({
      news: { masthead: 'tv-bar', chipColor: '#c8102e', labelColor: NEUTRAL_SKIN_TOKENS.palette.text },
    })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ext\.news\.rogue is not allowed/))
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ext\.news\.liveChip is not allowed/))
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ext\.news\.labelColor .* clamped/))
  })

  it('measures the ext cap in UTF-8 bytes, not characters', () => {
    const keys = Object.fromEntries('abcdefgh'.split('').map(k => [k, { type: 'string' as const }]))
    registerSkinExtension('portal', { keys })
    // 8 x 450 'é' = 3,600 characters (under 4,096) but 7,200 bytes (over).
    const bag = Object.fromEntries('abcdefgh'.split('').map(k => [k, 'é'.repeat(450)]))
    expect(JSON.stringify(bag).length).toBeLessThan(4096)
    expect(finalizeSkinTokens({ ...NEUTRAL_SKIN_TOKENS, ext: { portal: bag } }, 'portal').ext).toBeUndefined()
  })

  it('drops an ext object over the 4 KB cap', () => {
    registerSkinExtension('press', { keys: { letterhead: { type: 'string[]' }, contacts: { type: 'string[]' } } })
    const long = Array.from({ length: 20 }, () => 'x'.repeat(200))
    const ext = { press: { letterhead: long, contacts: long } }
    const result = finalizeSkinTokens({ ...NEUTRAL_SKIN_TOKENS, ext }, 'wire-room')
    expect(result.ext).toBeUndefined()
  })

  it('never mutates its input', () => {
    const tokens = structuredClone(BASE)
    finalizeSkinTokens(tokens, 'newsline7')
    expect(tokens).toEqual(BASE)
  })
})

/**
 * The dateline format registry (channels-foundation 14, news FU-3c; COR-053).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createScenarioTimeFormatter,
  hasDatelineFormat,
  registerDatelineFormat,
  resetDatelineFormatsForTests,
  resolveDatelineFormat,
  type ScenarioTimeFormatter,
} from './datelineFormats'

// 2026-10-29 18:32 UTC = 2:32 PM EDT in New York, 11:32 AM PDT in Los Angeles.
const INSTANT = '2026-10-29T18:32:00Z'
const fmt = (zone: string, relative = '2h ago') => createScenarioTimeFormatter(INSTANT, zone, () => relative)

afterEach(() => {
  resetDatelineFormatsForTests()
  vi.restoreAllMocks()
})

describe('built-in formats', () => {
  it('standard renders the absolute time in the EXERCISE zone, not the browser zone', () => {
    expect(resolveDatelineFormat('standard')(fmt('America/New_York'))).toBe('Oct 29, 2026, 2:32 PM')
    expect(resolveDatelineFormat('standard')(fmt('America/Los_Angeles'))).toBe('Oct 29, 2026, 11:32 AM')
  })

  it('relative renders the supplied scenario-time relative string', () => {
    expect(resolveDatelineFormat('relative')(fmt('UTC', '3m ago'))).toBe('3m ago')
  })

  it('compact renders "Oct 29 · 2:32 PM"', () => {
    expect(resolveDatelineFormat('compact')(fmt('America/New_York'))).toBe('Oct 29 · 2:32 PM')
  })

  it('a missing or unknown name falls back to standard (and warns once in dev)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const standard = resolveDatelineFormat('standard')
    expect(resolveDatelineFormat(undefined)).toBe(standard)
    expect(resolveDatelineFormat(null)).toBe(standard)
    expect(resolveDatelineFormat('')).toBe(standard)
    expect(resolveDatelineFormat('nope')).toBe(standard)
    resolveDatelineFormat('nope')
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('registerDatelineFormat', () => {
  it('a channel registers its own format (news "wire") without forking the primitive', () => {
    registerDatelineFormat('wire', t => `${t.dateline()} ${t.time()} ${t.zoneName()} (Pulse Wire)`)
    expect(hasDatelineFormat('wire')).toBe(true)
    expect(resolveDatelineFormat('wire')(fmt('America/New_York')))
      .toBe('OCT 29, 2026 2:32 PM EDT (Pulse Wire)')
  })

  it('a format function receives ONLY the scenario-time formatter, never a Date', () => {
    const received: unknown[][] = []
    registerDatelineFormat('spy', (...args: unknown[]) => {
      received.push(args)
      return ''
    })
    resolveDatelineFormat('spy')(fmt('UTC'))
    expect(received).toHaveLength(1)
    const [args] = received
    expect(args).toHaveLength(1)
    const formatter = args?.[0] as ScenarioTimeFormatter
    expect(formatter).not.toBeInstanceOf(Date)
    for (const value of Object.values(formatter)) {
      expect(typeof value).toBe('function')
      expect(value).not.toBeInstanceOf(Date)
    }
    expect(Object.keys(formatter).sort())
      .toEqual(['absolute', 'dateline', 'relative', 'shortDate', 'time', 'zoneName'])
  })

  it('cannot replace a built-in', () => {
    expect(() => registerDatelineFormat('standard', () => 'x')).toThrow(/built-in/)
  })

  it('a second, different registration of one name throws in dev; the same function is a no-op', () => {
    const wire = () => 'wire'
    registerDatelineFormat('wire', wire)
    expect(() => registerDatelineFormat('wire', wire)).not.toThrow()
    expect(() => registerDatelineFormat('wire', () => 'other')).toThrow(/already registered/)
  })

  it('rejects an empty name', () => {
    expect(() => registerDatelineFormat(' ', () => 'x')).toThrow()
  })
})

describe('createScenarioTimeFormatter', () => {
  it('renders nothing for an unparseable instant (never throws into the tree)', () => {
    const t = createScenarioTimeFormatter('not-a-date', 'UTC', () => '2h ago')
    expect([t.absolute(), t.dateline(), t.relative(), t.time(), t.shortDate(), t.zoneName()])
      .toEqual(['', '', '', '', '', ''])
  })

  it('an invalid time zone renders empty pinned parts instead of throwing', () => {
    const t = createScenarioTimeFormatter(INSTANT, 'Not/AZone', () => '')
    expect(() => [t.time(), t.shortDate(), t.zoneName()]).not.toThrow()
    expect([t.time(), t.shortDate(), t.zoneName()]).toEqual(['', '', ''])
  })

  it('pins every rendering to the given zone', () => {
    const t = fmt('Asia/Tokyo')
    // 18:32 UTC = 03:32 next day in Tokyo.
    expect(t.shortDate()).toBe('Oct 30')
    expect(t.time()).toBe('3:32 AM')
    expect(t.dateline()).toBe('OCT 30, 2026')
  })
})

/**
 * Pure display rules of the roster table (easy-login story 10): link-state
 * naming, filter, sort, summary line, and instants in the exercise time zone.
 */
import { describe, expect, it } from 'vitest'
import { makeEntry, makeLink } from '../../test/fixtures'
import {
  describeSessionsEnded,
  filterRoster,
  formatInstant,
  formatSummary,
  linkDisplayState,
  sortRoster,
  summarizeRoster,
} from './rosterDisplay'

describe('linkDisplayState', () => {
  it('names the four states; needsReissue only applies to an ACTIVE link', () => {
    expect(linkDisplayState(makeEntry())).toBe('active')
    expect(linkDisplayState(makeEntry({ link: makeLink({ status: 'active', needsReissue: true }) })))
      .toBe('needsReissue')
    expect(linkDisplayState(makeEntry({ link: makeLink({ status: 'revoked' }) }))).toBe('revoked')
    expect(linkDisplayState(makeEntry({ link: makeLink({ status: 'none' }) }))).toBe('none')
    // A revoked link with a stray needsReissue flag is still just revoked.
    expect(linkDisplayState(makeEntry({ link: makeLink({ status: 'revoked', needsReissue: true }) })))
      .toBe('revoked')
  })
})

describe('filterRoster', () => {
  const people = [
    makeEntry({ id: 'a', name: 'Dana Whitfield', agency: 'Fulco County EM', signInName: 'dwhitfield' }),
    makeEntry({ id: 'b', name: 'Marcus Oyelaran', agency: 'County Health', signInName: 'moyelaran' }),
    makeEntry({ id: 'c', name: 'Aiko Tanaka', agency: undefined, signInName: 'atanaka' }),
  ]

  it('returns everyone for a blank query', () => {
    expect(filterRoster(people, '')).toHaveLength(3)
    expect(filterRoster(people, '   ')).toHaveLength(3)
  })

  it('matches name, agency and sign-in name, case-insensitively', () => {
    expect(filterRoster(people, 'DANA').map(p => p.id)).toEqual(['a'])
    expect(filterRoster(people, 'county').map(p => p.id)).toEqual(['a', 'b'])
    expect(filterRoster(people, 'atanaka').map(p => p.id)).toEqual(['c'])
  })

  it('does not match on role, email or persona (not in the filter contract)', () => {
    const withExtras = [makeEntry({ id: 'x', name: 'Zed', role: 'Dispatcher', email: 'zed@x.test' })]
    expect(filterRoster(withExtras, 'dispatcher')).toEqual([])
    expect(filterRoster(withExtras, 'zed@x.test')).toEqual([])
    expect(filterRoster(withExtras, 'jane_smith')).toEqual([])
  })
})

describe('sortRoster', () => {
  const a = makeEntry({ id: 'a', name: 'Alice', agency: 'Zeta', liveSessions: 3 })
  const b = makeEntry({ id: 'b', name: 'Bob', agency: undefined, liveSessions: 1 })
  const c = makeEntry({ id: 'c', name: 'Cara', agency: 'Alpha', liveSessions: 2 })

  it('sorts by a text column in both directions', () => {
    expect(sortRoster([c, a, b], 'name', 'asc').map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(sortRoster([a, b, c], 'name', 'desc').map(e => e.id)).toEqual(['c', 'b', 'a'])
  })

  it('always sorts a row with no value LAST, in either direction', () => {
    expect(sortRoster([a, b, c], 'agency', 'asc').map(e => e.id)).toEqual(['c', 'a', 'b'])
    expect(sortRoster([a, b, c], 'agency', 'desc').map(e => e.id)).toEqual(['a', 'c', 'b'])
  })

  it('sorts numbers numerically', () => {
    expect(sortRoster([a, b, c], 'sessions', 'asc').map(e => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('sorts last sign-in by time, with never-signed-in last', () => {
    const early = makeEntry({ id: 'e', name: 'E', lastSignInAt: '2026-10-13T10:00:00.000Z' })
    const late = makeEntry({ id: 'l', name: 'L', lastSignInAt: '2026-10-13T12:00:00.000Z' })
    const never = makeEntry({ id: 'n', name: 'N' })
    expect(sortRoster([never, late, early], 'lastSignIn', 'asc').map(e => e.id)).toEqual(['e', 'l', 'n'])
    expect(sortRoster([never, early, late], 'lastSignIn', 'desc').map(e => e.id)).toEqual(['l', 'e', 'n'])
  })

  it('sorts the link column by its label (needs-reissue is its own label)', () => {
    const active = makeEntry({ id: '1', name: 'A1' })
    const needs = makeEntry({ id: '2', name: 'A2', link: makeLink({ needsReissue: true }) })
    const none = makeEntry({ id: '3', name: 'A3', link: makeLink({ status: 'none' }) })
    const revoked = makeEntry({ id: '4', name: 'A4', link: makeLink({ status: 'revoked' }) })
    expect(sortRoster([revoked, none, needs, active], 'link', 'asc').map(e => e.id))
      .toEqual(['1', '2', '3', '4'])
  })

  it('is stable: ties fall back to name and the input is never mutated', () => {
    const t1 = makeEntry({ id: 't1', name: 'Same', agency: 'X' })
    const t2 = makeEntry({ id: 't2', name: 'Same', agency: 'X' })
    const input = [t2, t1]
    expect(sortRoster(input, 'agency', 'asc').map(e => e.id)).toEqual(['t1', 't2'])
    expect(input.map(e => e.id)).toEqual(['t2', 't1'])
  })

  it('sorts persona by handle, with no persona last', () => {
    const noPersona = makeEntry({ id: 'np', name: 'NP', persona: undefined })
    const org = makeEntry({
      id: 'o',
      name: 'O',
      persona: { id: 'p', handle: 'FulcoEM', displayName: 'x', kind: 'org', autoCreated: false },
    })
    expect(sortRoster([noPersona, a, org], 'persona', 'asc').map(e => e.id)).toEqual(['o', 'a', 'np'])
  })
})

describe('summary line', () => {
  it('counts participants, those who have signed in, and those with no link', () => {
    const entries = [
      makeEntry({ id: '1', lastSignInAt: '2026-10-13T10:00:00.000Z' }),
      makeEntry({ id: '2', lastSignInAt: '2026-10-13T10:00:00.000Z' }),
      makeEntry({ id: '3', link: makeLink({ status: 'none' }) }),
      makeEntry({ id: '4', link: makeLink({ status: 'revoked' }) }),
    ]
    expect(summarizeRoster(entries)).toEqual({ total: 4, signedIn: 2, noLink: 1 })
    expect(formatSummary(summarizeRoster(entries)))
      .toBe('4 participants · 2 signed in · 1 with no link')
  })

  it('uses the singular for exactly one participant', () => {
    expect(formatSummary({ total: 1, signedIn: 0, noLink: 0 }))
      .toBe('1 participant · 0 signed in · 0 with no link')
  })

  it('reads like the story: "42 participants · 38 signed in · 3 with no link"', () => {
    expect(formatSummary({ total: 42, signedIn: 38, noLink: 3 }))
      .toBe('42 participants · 38 signed in · 3 with no link')
  })
})

describe('formatInstant (staff world: exercise time zone, zone named)', () => {
  const iso = '2026-10-13T13:05:00.000Z'

  it('renders in the exercise zone with the zone named', () => {
    expect(formatInstant(iso, 'America/New_York')).toBe('Oct 13, 9:05 AM EDT')
    expect(formatInstant(iso, 'America/Los_Angeles')).toBe('Oct 13, 6:05 AM PDT')
    expect(formatInstant(iso, 'UTC')).toBe('Oct 13, 1:05 PM UTC')
  })

  it('names the zone even where it is the same instant (the name is the point)', () => {
    expect(formatInstant('2026-01-15T17:00:00.000Z', 'America/New_York')).toBe('Jan 15, 12:00 PM EST')
  })

  it('falls back to UTC, honestly labelled, for an unknown zone', () => {
    expect(formatInstant(iso, 'Not/AZone')).toBe('Oct 13, 1:05 PM UTC')
  })

  it('returns undefined for an unparseable instant rather than a wrong date', () => {
    expect(formatInstant('not a date', 'UTC')).toBeUndefined()
  })
})

describe('describeSessionsEnded', () => {
  it('words zero, one and many', () => {
    expect(describeSessionsEnded(0)).toBe('No live sessions to end.')
    expect(describeSessionsEnded(1)).toBe('1 session ended.')
    expect(describeSessionsEnded(3)).toBe('3 sessions ended.')
  })
})

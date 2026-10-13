/**
 * features/participantAdmin/cards/cardFormat.test.ts
 * ---------------------------------------------------------------------------
 * The pure rules behind the printed card: the affiliation line, the `{site}` origin, the
 * button label, the page split and the skipped summary.
 */
import { describe, expect, it } from 'vitest'
import {
  CARDS_PER_PAGE,
  CARD_SHEET_PAGE_RULE,
  PERSONAL_LINKS_WARNING,
  affiliationLine,
  joinUrlOrigin,
  paginate,
  printCardsLabel,
  summarizeSkipped,
  usableIds,
} from './cardFormat'

describe('affiliationLine', () => {
  it('joins agency and role with a middle dot', () => {
    expect(affiliationLine('Fulco County EM', 'EOC Liaison')).toBe('Fulco County EM · EOC Liaison')
  })

  it('shows whichever of the two is present, with no stray separator', () => {
    expect(affiliationLine('Fulco County EM', undefined)).toBe('Fulco County EM')
    expect(affiliationLine(undefined, 'EOC Liaison')).toBe('EOC Liaison')
  })

  it('is undefined when neither is present (blank counts as absent)', () => {
    expect(affiliationLine()).toBeUndefined()
    expect(affiliationLine('  ', '')).toBeUndefined()
  })
})

describe('joinUrlOrigin', () => {
  it('returns the origin of an https join URL', () => {
    expect(joinUrlOrigin('https://pulse-uat.cobrasoftware.com/join/abc123')).toBe(
      'https://pulse-uat.cobrasoftware.com',
    )
  })

  it('keeps a non-default port and an http dev origin', () => {
    expect(joinUrlOrigin('http://localhost:5198/join/abc')).toBe('http://localhost:5198')
  })

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'not a url', '', '/join/abc'])(
    'is undefined for %j',
    value => {
      expect(joinUrlOrigin(value)).toBeUndefined()
    },
  )
})

describe('usableIds', () => {
  it('drops blank and whitespace-only ids and repeats, keeping first-seen order', () => {
    expect(usableIds(['b', '', 'a', '  ', 'b', '\t', 'c', 'a'])).toEqual(['b', 'a', 'c'])
  })

  it('returns the ids unaltered (no trimming of a usable id)', () => {
    expect(usableIds([' padded '])).toEqual([' padded '])
  })

  it('is empty for nothing and for only blanks', () => {
    expect(usableIds([])).toEqual([])
    expect(usableIds(['', ' '])).toEqual([])
  })
})

describe('printCardsLabel', () => {
  it('says "all" only for an EMPTY selection', () => {
    expect(printCardsLabel([])).toBe('Print all cards')
  })

  it('names how many people a selection holds', () => {
    expect(printCardsLabel(['a'])).toBe('Print cards (1)')
    expect(printCardsLabel(['a', 'b', 'c'])).toBe('Print cards (3)')
  })

  it('does not count blank or repeated ids', () => {
    expect(printCardsLabel(['a', '', ' ', 'a', 'b'])).toBe('Print cards (2)')
  })

  it('never reads "all" for a non-empty selection of only blank ids', () => {
    expect(printCardsLabel([''])).toBe('Print cards (0)')
    expect(printCardsLabel(['', '  '])).toBe('Print cards (0)')
  })
})

describe('CARD_SHEET_PAGE_RULE', () => {
  it('is US Letter portrait with 0.5in margins', () => {
    expect(CARD_SHEET_PAGE_RULE).toMatch(/^@page\s*\{/)
    expect(CARD_SHEET_PAGE_RULE).toMatch(/size:\s*letter portrait/)
    expect(CARD_SHEET_PAGE_RULE).toMatch(/margin:\s*0\.5in/)
  })
})

describe('paginate', () => {
  it('is eight cards a page by default', () => {
    expect(CARDS_PER_PAGE).toBe(8)
    const pages = paginate(Array.from({ length: 20 }, (_, i) => i))
    expect(pages.map(page => page.length)).toEqual([8, 8, 4])
  })

  it('keeps order and gives no pages for no cards', () => {
    expect(paginate([1, 2, 3], 2)).toEqual([[1, 2], [3]])
    expect(paginate([])).toEqual([])
  })
})

describe('summarizeSkipped', () => {
  it('counts by reason, in a fixed order, omitting reasons that did not occur', () => {
    const summary = summarizeSkipped([
      { reason: 'notFound' },
      { reason: 'disabled' },
      { reason: 'disabled' },
      { reason: 'tokenUnrecoverable' },
      { reason: 'noActiveLink' },
    ])
    expect(summary.total).toBe(5)
    expect(summary.lines).toEqual([
      '1 with no active link',
      '2 disabled',
      '1 whose link needs reissue',
      '1 not found',
    ])
  })

  it('is empty for nothing skipped', () => {
    expect(summarizeSkipped([])).toEqual({ total: 0, lines: [] })
  })
})

describe('PERSONAL_LINKS_WARNING', () => {
  it('is the exact sentence the story specifies', () => {
    expect(PERSONAL_LINKS_WARNING).toBe(
      'These cards contain personal sign-in links. Hand them out one by one and shred any left over.',
    )
  })
})

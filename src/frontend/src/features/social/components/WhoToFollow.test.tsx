/**
 * features/social/components/WhoToFollow.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story-04 ACs for the standalone "Who to follow" module (SOC-053,
 * D1-R1, D1-008):
 *   - the module is titled EXACTLY "Who to follow" and carries no authority/
 *     "official"/"recommended" chrome anywhere;
 *   - the SOC-052 impersonator can legitimately appear, rendered identically
 *     to any other row — no vouch, no counter-flag, no differential
 *     treatment — while a genuinely verified account DOES show the mark,
 *     proving presence/absence is the only difference;
 *   - rows render in the exact planner-seeded order the data seam returns.
 *
 * Runs through the REAL `SessionProvider` (a normal, writable participant —
 * mirrors `FollowButton.test.tsx`) against the shipped mock suggestion/
 * persona/follow-edge seams — no service mocking needed for these specs.
 * Observer/no-persona coverage (D1-011) lives in the sibling
 * `WhoToFollow.readonly.test.tsx` / `WhoToFollow.noPersona.test.tsx`.
 */
import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { resetMockFollowEdges } from '../services/followService'
import { WhoToFollow } from './WhoToFollow'

function withSession(children: ReactNode) {
  return render(<SessionProvider>{children}</SessionProvider>)
}

beforeEach(() => {
  resetMockFollowEdges()
})

describe('WhoToFollow — titled exactly "Who to follow", no authority chrome (D1-R1)', () => {
  it('renders the module heading with the exact required title', async () => {
    withSession(<WhoToFollow />)

    const heading = await screen.findByRole('heading', { name: 'Who to follow' })
    expect(heading).toBeInTheDocument()
  })

  it('never renders PLATFORM authority/endorsement language (an account\'s own words are its own)', async () => {
    withSession(<WhoToFollow />)
    await screen.findAllByTestId('who-to-follow-row')

    const module = screen.getByTestId('who-to-follow')

    // D1-R1 forbids the PLATFORM vouching for anyone — it does not forbid an account
    // from describing ITSELF. @FulcoEM's own bio legitimately reads "Official emergency
    // management for Fulton County."; filtering that would be the platform editorialising
    // an account's words, which is its own D1-R1 violation, and would break SOC-052 —
    // an impersonator must be able to claim exactly the same thing.
    // So: the words may appear ONLY inside persona-authored content, never in chrome.
    for (const authorityLanguage of [/official/i, /trusted/i, /recommended/i, /endorsed/i]) {
      for (const match of within(module).queryAllByText(authorityLanguage)) {
        expect(match.closest('[data-persona-authored="true"]')).not.toBeNull()
      }
    }
  })

  it('renders an account\'s own authority-claiming bio verbatim — the platform never edits it', async () => {
    withSession(<WhoToFollow />)
    const rows = await screen.findAllByTestId('who-to-follow-row')

    const agencyRow = rows.find(row => within(row).queryByText('@FulcoEM'))
    expect(agencyRow).toBeDefined()
    // Verbatim, unfiltered, unannotated — no platform gloss, no warning, no scare quotes.
    expect(
      within(agencyRow as HTMLElement).getByText(/Official emergency management for Fulton County/),
    ).toBeInTheDocument()
  })
})

describe('WhoToFollow — the impersonator can legitimately appear (D1-R1/D1-008)', () => {
  it('renders the unverified lookalike with no platform vouch and no differential treatment', async () => {
    withSession(<WhoToFollow />)
    const rows = await screen.findAllByTestId('who-to-follow-row')

    const impersonatorRow = rows.find(row => within(row).queryByText('@FairhavenWaterUpd'))
    expect(impersonatorRow).toBeDefined()
    const row = impersonatorRow as HTMLElement

    // Absence of the mark IS the only signal — no substitute badge either.
    expect(within(row).queryByTestId('verified-mark')).toBeNull()
    expect(within(row).queryByText(/unverified|impersonat|fake|bad.?actor|lookalike/i)).toBeNull()
    // Same action control as any other suggestion — the platform treats it identically.
    expect(within(row).getByTestId('follow-button')).toBeInTheDocument()
  })

  it('renders a genuinely verified suggestion WITH the mark — proving presence/absence is the only difference', async () => {
    withSession(<WhoToFollow />)
    const rows = await screen.findAllByTestId('who-to-follow-row')

    const verifiedRow = rows.find(row => within(row).queryByText('@FulcoEM'))
    expect(verifiedRow).toBeDefined()
    expect(within(verifiedRow as HTMLElement).getByTestId('verified-mark')).toBeInTheDocument()
  })
})

describe('WhoToFollow — planner-seeded order preserved, never re-ranked', () => {
  it('renders rows in the exact order the suggestion seam returned', async () => {
    withSession(<WhoToFollow />)
    const rows = await screen.findAllByTestId('who-to-follow-row')

    const handles = rows.map(row => {
      const handleEl = within(row).getByText(/^@/)
      return handleEl.textContent
    })

    expect(handles).toEqual([
      '@FulcoEM',
      '@FairhavenWaterUpd',
      '@Newsline7',
      '@TheScoopHQ',
      '@kwardFH',
      '@mvega_fh',
    ])
  })

  it('a limit prop caps the rendered rows WITHOUT changing their order', async () => {
    withSession(<WhoToFollow limit={2} />)
    const rows = await screen.findAllByTestId('who-to-follow-row')

    expect(rows).toHaveLength(2)
    expect(within(rows[0] as HTMLElement).getByText('@FulcoEM')).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).getByText('@FairhavenWaterUpd')).toBeInTheDocument()
  })
})

describe('WhoToFollow — follow action per row (SOC-051 reuse, not reimplemented)', () => {
  it('renders a real Follow control for each suggested row', async () => {
    withSession(<WhoToFollow />)
    const rows = await screen.findAllByTestId('who-to-follow-row')

    for (const row of rows) {
      expect(within(row).getByTestId('follow-button')).toBeInTheDocument()
    }
  })
})

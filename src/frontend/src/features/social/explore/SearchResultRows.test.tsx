/**
 * features/social/explore/SearchResultRows.test.tsx
 * ---------------------------------------------------------------------------
 * The result rows (demo-polish F6, SOC-052 / D1-008, NFR-001):
 *  - THE LOOKALIKE RULE. A verified agency's People row and its unverified
 *    lookalike's render IDENTICALLY except for the seal: the same elements, the
 *    same classes, the same attribute NAMES (so no `data-verified`, no extra
 *    `aria-*`, no title), the same copy shape, and no "official"/"unverified"
 *    text. The seal's absence is the only signal.
 *  - Persona/post text renders as plain text (no HTML injection).
 *  - Each row is one real link; with a callback a plain click is intercepted, a
 *    modified click is left to the browser.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SEEDED_PERSONAS, toParticipantPersona, type Persona } from '@/features/personas'
import type { PostView } from '../components/post/types'
import { attributeNames, structureSignature } from './exploreTestUtils'
import { PersonResultRow, PostResultRow } from './SearchResultRows'

const REAL: Persona = {
  id: 'persona-fairhavenwater',
  exerciseId: 'ex-test',
  templateId: 'tmpl-fairhavenwater',
  displayName: 'Fairhaven Water Utility',
  handle: 'FairhavenWater',
  kind: 'org',
  verified: true,
  avatarColor: '#1f6f8b',
  initials: 'FW',
  bio: 'Official updates from the utility.',
  audienceBand: 'large',
  followerCount: 52_000,
  joinedAt: '2033-01-01T00:00:00Z',
}

const FAKE: Persona = {
  ...REAL,
  id: 'persona-fairhavenwaterupd',
  templateId: 'tmpl-fairhavenwaterupd',
  displayName: 'Fairhaven Water Update',
  handle: 'FairhavenWaterUpd',
  verified: false,
  avatarColor: '#2f6f7e',
  bio: 'Real-time Fairhaven water updates. Stay informed.',
  audienceBand: 'nano',
  followerCount: 900,
}

function renderPair(real: Persona, fake: Persona) {
  render(
    <ul>
      <PersonResultRow persona={real} />
      <PersonResultRow persona={fake} />
    </ul>,
  )
  const [realRow, fakeRow] = screen.getAllByTestId('search-person')
  if (realRow === undefined || fakeRow === undefined) throw new Error('rows not rendered')
  return { realRow, fakeRow }
}

describe('PersonResultRow — the lookalike pair renders identically except the seal', () => {
  it('shows the seal on the verified row only', () => {
    const { realRow, fakeRow } = renderPair(REAL, FAKE)
    expect(within(realRow).getByRole('img', { name: 'Verified account' })).toBeInTheDocument()
    expect(within(fakeRow).queryByRole('img')).not.toBeInTheDocument()
    expect(fakeRow.querySelector('[data-testid="verified-mark"]')).toBeNull()
  })

  it('has the same structure once the seal is set aside (elements, classes, attribute names)', () => {
    const { realRow, fakeRow } = renderPair(REAL, FAKE)
    const sealWrapper = realRow.querySelector('[data-testid="verified-mark"]')?.parentElement
    expect(sealWrapper).toBeInstanceOf(HTMLElement)
    // The seal is a wrapper span holding ONLY the mark.
    expect(sealWrapper?.children).toHaveLength(1)

    expect(structureSignature(realRow, sealWrapper ?? undefined)).toBe(structureSignature(fakeRow))
  })

  it('uses exactly the same attribute names, and none that hint at trust', () => {
    const { realRow, fakeRow } = renderPair(REAL, FAKE)
    const sealWrapper = realRow.querySelector('[data-testid="verified-mark"]')?.parentElement
    const realNames = attributeNames(realRow, sealWrapper ?? undefined)
    const fakeNames = attributeNames(fakeRow)
    expect([...realNames].sort()).toEqual([...fakeNames].sort())
    for (const name of fakeNames) {
      expect(name).not.toMatch(/verif|official|trust|fake|imperson|warn|flag|suspect/i)
    }
  })

  it('carries no "official" / "unverified" / warning copy on either row', () => {
    const { realRow, fakeRow } = renderPair(REAL, FAKE)
    const sealWrapper = realRow.querySelector('[data-testid="verified-mark"]')?.parentElement
    // Everything outside the seal is the account's own words and nothing else.
    const strip = (row: HTMLElement) =>
      Array.from(row.querySelectorAll('a, span'))
        .filter(
          el =>
            !sealWrapper?.contains(el) &&
            !el.closest('[data-testid="post-avatar"]') && // the decorative monogram
            el.children.length === 0,
        )
        .map(el => el.textContent)
    expect(strip(fakeRow)).toEqual([FAKE.displayName, `@${FAKE.handle}`, FAKE.bio])
    expect(strip(realRow)).toEqual([REAL.displayName, `@${REAL.handle}`, REAL.bio])
    expect(fakeRow.textContent).not.toMatch(
      /unverified|not verified|fake|imperson|warning|caution/i,
    )
    expect(fakeRow).not.toHaveTextContent(/Verified account/)
  })

  it('also holds for the real seeded pair from the persona cast', () => {
    const seeded = SEEDED_PERSONAS.map(toParticipantPersona)
    const real = seeded.find(p => p.handle === 'FairhavenWater')
    const fake = seeded.find(p => p.handle === 'FairhavenWaterUpd')
    if (real === undefined || fake === undefined) throw new Error('seeded pair missing')
    expect(real.verified).toBe(true)
    expect(fake.verified).toBe(false)

    const { realRow, fakeRow } = renderPair(real, fake)
    const sealWrapper = realRow.querySelector('[data-testid="verified-mark"]')?.parentElement
    expect(structureSignature(realRow, sealWrapper ?? undefined)).toBe(structureSignature(fakeRow))
  })

  it('is unaffected by kind or audience: only `verified` changes what renders', () => {
    // Same persona, verified flipped: the ONLY change is the seal.
    const { realRow, fakeRow } = renderPair(REAL, { ...REAL, id: 'x', verified: false })
    const sealWrapper = realRow.querySelector('[data-testid="verified-mark"]')?.parentElement
    expect(structureSignature(realRow, sealWrapper ?? undefined)).toBe(structureSignature(fakeRow))
    expect(realRow.textContent?.replace('Verified account', '')).toBe(fakeRow.textContent)
  })
})

describe('PersonResultRow — link behaviour and safety', () => {
  it('is one real link to the profile, named for the account', () => {
    render(<PersonResultRow persona={REAL} />)
    const link = screen.getByRole('link', { name: "View Fairhaven Water Utility's profile" })
    expect(link).toHaveAttribute('href', '/FairhavenWater')
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('intercepts a plain click with the callback, but not a modified click', () => {
    const onOpenProfile = vi.fn()
    render(<PersonResultRow persona={REAL} onOpenProfile={onOpenProfile} />)
    const link = screen.getByRole('link')

    // A modified click is the browser's (new tab); stop jsdom "navigating" after React ran.
    document.addEventListener('click', event => event.preventDefault(), { once: true })
    fireEvent.click(link, { ctrlKey: true })
    expect(onOpenProfile).not.toHaveBeenCalled()

    fireEvent.click(link)
    expect(onOpenProfile).toHaveBeenCalledWith('persona-fairhavenwater')
  })

  it('renders persona text as plain text, never HTML', () => {
    const hostile: Persona = {
      ...FAKE,
      displayName: '<img src=x onerror=alert(1)>',
      bio: '<script>alert(2)</script>',
    }
    const { container } = render(<PersonResultRow persona={hostile} />)
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container).toHaveTextContent('<script>alert(2)</script>')
  })
})

const VIEW: PostView = {
  id: 'post-1',
  author: REAL,
  text: 'Boil water advisory remains in effect #WaterIssues',
  counts: { reply: 1, repost: 2, like: 3 },
  scenarioTime: '2033-09-04T13:15:00Z',
}

function renderPost(onOpenPost?: (id: string) => void) {
  return render(
    <ul>
      <PostResultRow
        post={VIEW}
        relativeTime="2h ago"
        absoluteTime="Sep 4, 2033, 9:15 AM"
        onOpenPost={onOpenPost}
      />
    </ul>,
  )
}

describe('PostResultRow', () => {
  it('shows the author, handle, scenario time and the post text', () => {
    renderPost()
    const row = screen.getByTestId('search-post')
    expect(within(row).getByText('Fairhaven Water Utility')).toBeInTheDocument()
    expect(within(row).getByText('@FairhavenWater')).toBeInTheDocument()
    const time = within(row).getByText('2h ago')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('dateTime', '2033-09-04T13:15:00Z')
    expect(time).toHaveAttribute('title', 'Sep 4, 2033, 9:15 AM')
    expect(within(row).getByRole('link')).toHaveTextContent(VIEW.text)
  })

  it('links to the thread and hands the post id to the callback', () => {
    const onOpenPost = vi.fn()
    renderPost(onOpenPost)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/FairhavenWater/status/post-1')
    fireEvent.click(link)
    expect(onOpenPost).toHaveBeenCalledWith('post-1')
  })

  it('keeps the verified seal outside the link (not swallowed into its name)', () => {
    renderPost()
    expect(screen.getByRole('img', { name: 'Verified account' })).toBeInTheDocument()
    expect(screen.getByRole('link').querySelector('[data-testid="verified-mark"]')).toBeNull()
  })
})

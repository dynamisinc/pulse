/**
 * features/participantAdmin/cards/Card.test.tsx
 * ---------------------------------------------------------------------------
 * ONE printed card (story 12 AC3): every field, the QR `alt`, the `{site}` in the help
 * line, and the safety rails (unsafe QR, hostile text, no link element).
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card } from './Card'
import type { RosterCardDto } from './types'

const QR = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg"/>')}`

const CARD: RosterCardDto = {
  participantId: 'p-1',
  name: 'Jane Smith',
  agency: 'Fulco County EM',
  role: 'EOC Liaison',
  signInName: 'jsmith',
  joinUrl: 'https://pulse-uat.cobrasoftware.com/join/AbCdEfGhIjKlMnOpQrStUv',
  qrSvgDataUri: QR,
}

function renderCard(card: RosterCardDto = CARD, exerciseName = 'Coastal Surge') {
  return render(<Card card={card} exerciseName={exerciseName} />)
}

describe('Card - every field', () => {
  it('shows the exercise name and a "Training exercise" line', () => {
    renderCard()
    const card = screen.getByTestId('roster-card')
    expect(within(card).getByText('Coastal Surge')).toBeInTheDocument()
    expect(within(card).getByText('Training exercise')).toBeInTheDocument()
  })

  it('shows the name as a heading', () => {
    renderCard()
    expect(screen.getByRole('heading', { level: 3, name: 'Jane Smith' })).toBeInTheDocument()
  })

  it('shows "agency · role" when both are present', () => {
    renderCard()
    expect(screen.getByText('Fulco County EM · EOC Liaison')).toBeInTheDocument()
  })

  it('shows only the one that exists, and nothing at all when neither does', () => {
    const { rerender, container } = renderCard({ ...CARD, role: undefined })
    expect(screen.getByText('Fulco County EM')).toBeInTheDocument()
    rerender(<Card card={{ ...CARD, agency: undefined, role: undefined }} exerciseName="X" />)
    expect(container.querySelector('p[class*="affiliation"]')).toBeNull()
    expect(screen.queryByText(/·/)).not.toBeInTheDocument()
  })

  it('renders the QR as an <img> of qrSvgDataUri with the specified alt', () => {
    renderCard()
    const img = screen.getByRole('img', { name: 'QR code: sign in as Jane Smith' })
    expect(img.tagName).toBe('IMG')
    expect(img).toHaveAttribute('src', QR)
  })

  it('never lazy-loads the QR (a below-the-fold image might not be loaded when Print is pressed)', () => {
    renderCard()
    expect(screen.getByRole('img')).not.toHaveAttribute('loading', 'lazy')
  })

  it('shows "Sign-in name:" with the value in a monospace element', () => {
    renderCard()
    expect(screen.getByText('Sign-in name:')).toBeInTheDocument()
    const value = screen.getByText('jsmith')
    expect(value.tagName).toBe('CODE')
  })

  it('shows "Today\'s word:" with a blank writing line', () => {
    renderCard()
    expect(screen.getByText("Today's word:")).toBeInTheDocument()
    const line = screen.getByTestId('roster-card-word-line')
    expect(line).toBeEmptyDOMElement()
    // A screen-reader user is told the blank is intentional.
    expect(screen.getByText(/blank: write today's word here/)).toBeInTheDocument()
  })

  it('shows the full link as plain text, not a clickable link', () => {
    renderCard()
    const link = screen.getByTestId('roster-card-link')
    expect(link).toHaveTextContent(CARD.joinUrl)
    expect(link.closest('a')).toBeNull()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it("shows the help line with {site} taken from the card's own joinUrl origin", () => {
    renderCard()
    expect(screen.getByTestId('roster-card-help')).toHaveTextContent(
      "Scan with your phone's camera. No QR? Open https://pulse-uat.cobrasoftware.com/login " +
      "and enter your sign-in name and today's word.",
    )
  })

  it('uses each card\'s own origin (a different host gives a different help line)', () => {
    renderCard({ ...CARD, joinUrl: 'https://other.example.org:8443/join/zzz' })
    expect(screen.getByTestId('roster-card-help')).toHaveTextContent(
      'Open https://other.example.org:8443/login and',
    )
  })

  it('falls back to a generic sentence when the join URL has no usable origin', () => {
    renderCard({ ...CARD, joinUrl: 'not a url' })
    const help = screen.getByTestId('roster-card-help')
    expect(help).toHaveTextContent(
      "Scan with your phone's camera. No QR? Open the sign-in page and enter your sign-in name " +
      "and today's word.",
    )
    expect(help.textContent).not.toContain('not a url')
  })
})

describe('Card - long names step down in size instead of overflowing', () => {
  function nameClass(name: string): string {
    const { unmount } = renderCard({ ...CARD, name })
    const className = screen.getByRole('heading', { level: 3 }).className
    unmount()
    return className
  }

  it('keeps the large face for a short name', () => {
    const className = nameClass('Jane Smith')
    expect(className).not.toMatch(/nameLong|nameXLong/)
  })

  it('uses the smaller face past 24 characters and the smallest past 48', () => {
    expect(nameClass('Alexandria Montgomery Featherstone')).toMatch(/nameLong/)
    expect(nameClass('Alexandria Montgomery Featherstone')).not.toMatch(/nameXLong/)
    expect(nameClass('B'.repeat(49))).toMatch(/nameXLong/)
  })

  it('still puts the whole name in the DOM (the clamp is visual only)', () => {
    const name = 'Bartholomew Maximilian Featherstonehaugh-Montgomery the Third of Westchester'
    renderCard({ ...CARD, name })
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(name)
  })
})

describe('Card - safety rails', () => {
  it.each([
    ['a javascript: URI', 'javascript:alert(1)'],
    ['an https URL', 'https://evil.example/qr.svg'],
    ['an HTML data URI', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['an unencoded SVG data URI', 'data:image/svg+xml;utf8,<svg onload="alert(1)"/>'],
  ])('drops the image for %s and says so in text, keeping the rest of the card', (_label, uri) => {
    renderCard({ ...CARD, qrSvgDataUri: uri })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('roster-card-qr-missing')).toHaveTextContent(/QR code unavailable/)
    // The link and sign-in name still work, so the card is still usable.
    expect(screen.getByTestId('roster-card-link')).toHaveTextContent(CARD.joinUrl)
    expect(screen.getByText('jsmith')).toBeInTheDocument()
  })

  it('renders names and affiliations as text, never as markup', () => {
    const { container } = renderCard({
      ...CARD,
      name: '<img src=x onerror=alert(1)>',
      agency: '<script>alert(2)</script>',
    })
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.querySelectorAll('img')).toHaveLength(1) // the QR only
    expect(container.querySelector('script')).toBeNull()
  })

  it('does not name a person in the QR alt text from anything but the card name', () => {
    renderCard({ ...CARD, name: "Mary-Ann O'Neil" })
    expect(screen.getByRole('img', { name: "QR code: sign in as Mary-Ann O'Neil" })).toBeInTheDocument()
  })
})

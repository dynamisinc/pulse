/**
 * features/channels/routing/ChannelNotFound.tsx
 * ---------------------------------------------------------------------------
 * The participant-world not-found for a channel route (FC-8 `routing/`):
 * what a disabled channel, an unknown item, a draft or another exercise's item
 * all render, indistinguishably (XC-001/002).
 *
 * Channels-foundation 08 ships this baseline so `<ChannelRoute>` never renders
 * a COBRA 404 or a blank page; story 12 (participant channel router) owns the
 * brand-skinned final look and may restyle it in place without changing the
 * export.
 *
 * Fiction-safe copy: no exercise, admin, "disabled" or "not enabled" wording,
 * so a participant cannot tell a switched-off channel from a mistyped URL.
 * World: participant. Plain CSS on the exercise brand tokens
 * (`--pulse-brand-*`, set by `BrandThemeProvider`) with neutral fallbacks; no
 * COBRA, no MUI component, no default MUI look.
 */

import { Link } from 'react-router-dom'

const wrapperStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '12px',
  padding: '48px 16px',
  textAlign: 'center',
  color: 'var(--pulse-brand-on-surface, #1c1c1c)',
} as const

const linkStyle = {
  color: 'var(--pulse-brand-primary, #2b5f75)',
  fontWeight: 600,
  textDecoration: 'underline',
  minHeight: '44px',
  display: 'inline-flex',
  alignItems: 'center',
} as const

/** The participant-world "page not found" for a channel route. */
export function ChannelNotFound() {
  return (
    <section style={wrapperStyle} aria-labelledby="channel-not-found-heading" data-testid="channel-not-found">
      <h1 id="channel-not-found-heading" style={{ margin: 0, fontSize: '1.5rem' }}>
        Page not found
      </h1>
      <p style={{ margin: 0 }}>The page you are looking for isn&apos;t available.</p>
      <Link to="/" style={linkStyle}>
        Go to the home page
      </Link>
    </section>
  )
}

/**
 * features/participantAdmin/email/EmailLinksButton.test.tsx
 * ---------------------------------------------------------------------------
 * Story 13's roster control: hidden unless the roster reports the email capability;
 * the label; the alertdialog confirm (the story's sentence, focus on Cancel, Cancel
 * sends nothing and returns focus); the one request it makes; the result summary
 * (counts by status as text + icon, the reasons, in an aria-live region); errors;
 * and the 100-person cap.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { makeEntry } from '../test/fixtures'
import { EmailLinksButton } from './EmailLinksButton'
import { EmailLinksButton as FromBarrel } from './index'
import { EMAIL_LINKS_WARNING } from './emailLinksFormat'
import { EMAIL_LINKS_ENDPOINT } from './emailLinksService'
import { okResponse, renderWithRoster, rosterWith, sampleEntries } from './emailTestUtils'
import type { RosterEmailResultDto } from './types'

afterEach(() => {
  vi.restoreAllMocks()
})

function spyOnEmail(result: RosterEmailResultDto) {
  return vi.spyOn(api, 'post').mockResolvedValue(okResponse(result))
}

function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, null, {
    data: { detail: 'jane@example.org https://x/join/SECRET' },
    status,
    statusText: '',
    headers: {},
    config,
  })
}

describe('EmailLinksButton - dark until configured', () => {
  it('is exported from the folder barrel as the same component', () => {
    expect(FromBarrel).toBe(EmailLinksButton)
  })

  it('renders nothing when the roster reports emailLinks: false', async () => {
    await renderWithRoster(<EmailLinksButton selection={['p-ann']} />, rosterWith(sampleEntries(), false))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing when no roster is loaded (and never fetches one)', async () => {
    const get = vi.spyOn(api, 'get')
    await renderWithRoster(<EmailLinksButton selection={[]} />, undefined)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    // The exercise context resolves itself; the roster (which carries join URLs) is never fetched.
    expect(get.mock.calls.map(call => call[0])).not.toContain('/staff/roster')
  })

  it('renders the button when the capability is on', async () => {
    await renderWithRoster(<EmailLinksButton selection={['p-ann']} />, rosterWith(sampleEntries()))
    expect(screen.getByRole('button', { name: 'Email links (1)' })).toBeInTheDocument()
  })

  it('is disabled while the roster has no join links (no site address: nothing to email)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    const post = vi.spyOn(api, 'post')
    const roster = { ...rosterWith(sampleEntries()), joinLinksAvailable: false }
    await renderWithRoster(<EmailLinksButton selection={[]} />, roster)

    const button = screen.getByRole('button', { name: 'Email all links' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('EmailLinksButton - label', () => {
  it.each([
    [['p-ann'], 'Email links (1)'],
    [['p-ann', 'p-ben', 'p-cal'], 'Email links (3)'],
    [['p-ann', 'p-ann'], 'Email links (1)'],
    [[], 'Email all links'],
  ])('selection %j reads "%s"', async (selection, label) => {
    await renderWithRoster(<EmailLinksButton selection={selection} />, rosterWith(sampleEntries()))
    const button = screen.getByRole('button', { name: label })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
  })

  it('a selection of only blank ids is "(0)", disabled, and never means everyone', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    const post = vi.spyOn(api, 'post')
    await renderWithRoster(<EmailLinksButton selection={['', '  ']} />, rosterWith(sampleEntries()))
    const button = screen.getByRole('button', { name: 'Email links (0)' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('EmailLinksButton - confirm', () => {
  it('asks first, in an alertdialog with the story sentence, focus on Cancel', async () => {
    const user = userEvent.setup()
    await renderWithRoster(
      <EmailLinksButton selection={['p-ann', 'p-cal']} />,
      rosterWith(sampleEntries()),
    )

    await user.click(screen.getByRole('button', { name: 'Email links (2)' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Email personal sign-in links?' })
    expect(dialog).toHaveAccessibleDescription(expect.stringContaining(EMAIL_LINKS_WARNING))
    expect(within(dialog).getByText(EMAIL_LINKS_WARNING)).toBeInTheDocument()
    expect(within(dialog).getByTestId('email-links-scope')).toHaveTextContent(
      '2 people selected; 1 of them has an email address and an active link.',
    )
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('Cancel sends nothing, closes, and returns focus to the button', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(api, 'post')
    await renderWithRoster(<EmailLinksButton selection={['p-ann']} />, rosterWith(sampleEntries()))
    const trigger = screen.getByRole('button', { name: 'Email links (1)' })

    await user.click(trigger)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(post).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('Escape cancels too, and sends nothing', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(api, 'post')
    await renderWithRoster(<EmailLinksButton selection={['p-ann']} />, rosterWith(sampleEntries()))

    await user.click(screen.getByRole('button', { name: 'Email links (1)' }))
    await screen.findByRole('alertdialog')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(post).not.toHaveBeenCalled()
  })

  it('with nothing selected, says how many people the roster can email', async () => {
    const user = userEvent.setup()
    await renderWithRoster(<EmailLinksButton selection={[]} />, rosterWith(sampleEntries()))

    await user.click(screen.getByRole('button', { name: 'Email all links' }))

    expect(await screen.findByTestId('email-links-scope')).toHaveTextContent(
      'Everyone on the roster who can be emailed: 2 people with an email address and an active link.',
    )
  })

  it('over 100 people it explains the cap and offers no send', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(api, 'post')
    const many = Array.from({ length: 101 }, (_, i) => makeEntry({
      id: `p-${i}`,
      name: `Person ${i}`,
      email: `p${i}@example.org`,
    }))
    await renderWithRoster(<EmailLinksButton selection={[]} />, rosterWith(many))

    await user.click(screen.getByRole('button', { name: 'Email all links' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByTestId('email-links-over-cap')).toHaveTextContent('at most 100 people')
    expect(within(dialog).queryByRole('button', { name: 'Send emails' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('EmailLinksButton - sending and the summary', () => {
  it('posts the snapshotted ids once, with no exercise id, and summarises the result', async () => {
    const user = userEvent.setup()
    const post = spyOnEmail({
      results: [
        { participantId: 'p-ann', status: 'sent' },
        { participantId: 'p-ben', status: 'failed', reason: 'rateLimited' },
        { participantId: 'p-cal', status: 'skipped', reason: 'noEmail' },
        { participantId: 'p-dee', status: 'skipped', reason: 'disabled' },
      ],
    })
    await renderWithRoster(
      <EmailLinksButton selection={['p-ann', 'p-ben', 'p-cal', 'p-dee']} />,
      rosterWith(sampleEntries()),
    )

    await user.click(screen.getByRole('button', { name: 'Email links (4)' }))
    await user.click(await screen.findByRole('button', { name: 'Send emails' }))

    const summary = await screen.findByTestId('email-links-summary')
    expect(post).toHaveBeenCalledTimes(1)
    const [url, body] = post.mock.calls[0] ?? []
    expect(url).toBe(EMAIL_LINKS_ENDPOINT)
    expect(body).toEqual({ participantIds: ['p-ann', 'p-ben', 'p-cal', 'p-dee'] })
    expect(JSON.stringify(post.mock.calls[0])).not.toMatch(/exercise/i)

    // Counts by status: text (and an icon), never colour alone.
    expect(summary).toHaveTextContent('Sent: 1 person')
    expect(summary).toHaveTextContent('Skipped: 2 people')
    expect(summary).toHaveTextContent('Failed: 1 person')
    expect(summary.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3)

    // The reasons, with the people's names from the roster.
    const reasons = within(summary).getByRole('list', { name: 'Not emailed' })
    expect(reasons).toHaveTextContent(
      'Failed, email limit reached; send again to just these people later: Ben Baker',
    )
    expect(reasons).toHaveTextContent('Skipped, no email address: Cal Cole')
    expect(reasons).toHaveTextContent('Skipped, disabled: Dee Dunn')

    // In the live region, and Close takes focus.
    expect(screen.getByTestId('email-links-status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByTestId('email-links-status')).toContainElement(summary)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('"Send again" re-posts ONLY the failed ids, then shows the new result', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(api, 'post')
      .mockResolvedValueOnce(okResponse({
        results: [
          { participantId: 'p-ann', status: 'sent' },
          { participantId: 'p-ben', status: 'failed', reason: 'rateLimited' },
          { participantId: 'p-cal', status: 'skipped', reason: 'noEmail' },
          { participantId: 'p-dee', status: 'failed', reason: 'notAttempted' },
        ],
      }))
      .mockResolvedValueOnce(okResponse({
        results: [
          { participantId: 'p-ben', status: 'sent' },
          { participantId: 'p-dee', status: 'sent' },
        ],
      }))
    await renderWithRoster(
      <EmailLinksButton selection={['p-ann', 'p-ben', 'p-cal', 'p-dee']} />,
      rosterWith(sampleEntries()),
    )

    await user.click(screen.getByRole('button', { name: 'Email links (4)' }))
    await user.click(await screen.findByRole('button', { name: 'Send emails' }))
    await user.click(await screen.findByRole('button', { name: 'Send again to the 2 not sent' }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(post.mock.calls[1]?.[1]).toEqual({ participantIds: ['p-ben', 'p-dee'] })
    await waitFor(() => expect(screen.getByTestId('email-links-summary')).toHaveTextContent('Sent: 2 people'))
    expect(screen.getByTestId('email-links-summary')).toHaveTextContent('Failed: 0 people')
    expect(screen.queryByRole('button', { name: /Send again/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('offers no "Send again" when nobody failed (skips cannot be fixed by resending)', async () => {
    const user = userEvent.setup()
    spyOnEmail({
      results: [
        { participantId: 'p-ann', status: 'sent' },
        { participantId: 'p-cal', status: 'skipped', reason: 'noEmail' },
      ],
    })
    await renderWithRoster(<EmailLinksButton selection={['p-ann', 'p-cal']} />, rosterWith(sampleEntries()))

    await user.click(screen.getByRole('button', { name: 'Email links (2)' }))
    await user.click(await screen.findByRole('button', { name: 'Send emails' }))

    await screen.findByTestId('email-links-summary')
    expect(screen.queryByRole('button', { name: /Send again/ })).not.toBeInTheDocument()
  })

  it('with nothing selected, posts {} (the explicit "everyone eligible")', async () => {
    const user = userEvent.setup()
    const post = spyOnEmail({ results: [{ participantId: 'p-ann', status: 'sent' }] })
    await renderWithRoster(<EmailLinksButton selection={[]} />, rosterWith(sampleEntries()))

    await user.click(screen.getByRole('button', { name: 'Email all links' }))
    await user.click(await screen.findByRole('button', { name: 'Send emails' }))

    await screen.findByTestId('email-links-summary')
    expect(post.mock.calls[0]?.[1]).toEqual({})
  })

  it('an id the roster does not know is named generically', async () => {
    const user = userEvent.setup()
    spyOnEmail({ results: [{ participantId: 'p-zzz', status: 'skipped', reason: 'notFound' }] })
    await renderWithRoster(<EmailLinksButton selection={['p-zzz']} />, rosterWith(sampleEntries()))

    await user.click(screen.getByRole('button', { name: 'Email links (1)' }))
    await user.click(await screen.findByRole('button', { name: 'Send emails' }))

    expect(await screen.findByTestId('email-links-summary')).toHaveTextContent(
      'Skipped, not on this roster: A participant not on this roster',
    )
  })

  it('closing the result returns focus to the button', async () => {
    const user = userEvent.setup()
    spyOnEmail({ results: [{ participantId: 'p-ann', status: 'sent' }] })
    await renderWithRoster(<EmailLinksButton selection={['p-ann']} />, rosterWith(sampleEntries()))
    const trigger = screen.getByRole('button', { name: 'Email links (1)' })

    await user.click(trigger)
    await user.click(await screen.findByRole('button', { name: 'Send emails' }))
    await user.click(await screen.findByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it.each([
    [503, 'Email delivery or personal links are not configured on this server.'],
    [403, 'This account is not allowed to email sign-in links.'],
    [500, 'The emails could not be sent. Check the connection and try again.'],
  ])('a %i is a fixed, secret-free message in an alert, and the dialog stays open', async (status, message) => {
    const user = userEvent.setup()
    vi.spyOn(api, 'post').mockRejectedValue(httpError(status))
    await renderWithRoster(<EmailLinksButton selection={['p-ann']} />, rosterWith(sampleEntries()))

    await user.click(screen.getByRole('button', { name: 'Email links (1)' }))
    await user.click(await screen.findByRole('button', { name: 'Send emails' }))

    const alert = await screen.findByTestId('email-links-error')
    await waitFor(() => expect(alert).toHaveTextContent(message))
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert.textContent).not.toMatch(/example\.org|join|SECRET/)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send emails' })).toBeEnabled()
  })
})

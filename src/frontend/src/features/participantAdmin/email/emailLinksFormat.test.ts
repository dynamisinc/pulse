/**
 * features/participantAdmin/email/emailLinksFormat.test.ts
 * ---------------------------------------------------------------------------
 * The pure rules behind "Email links": the label, the emailable estimate, who a
 * request considers, and the result summary (counts and reason groups).
 */
import { describe, expect, it } from 'vitest'
import { makeEntry, makeLink } from '../test/fixtures'
import {
  EMAIL_LINKS_WARNING,
  consideredEntries,
  emailLinksLabel,
  looksEmailable,
  people,
  reasonText,
  summarizeResult,
  unsentIds,
  usableIds,
} from './emailLinksFormat'

describe('emailLinksFormat', () => {
  it('carries the story sentence verbatim', () => {
    expect(EMAIL_LINKS_WARNING).toBe(
      "This emails each person a personal sign-in link. An emailed link can't be recalled; reissue it to cancel it.",
    )
  })

  it('cleans ids and labels the button', () => {
    expect(usableIds(['a', '', 'b', 'a', ' '])).toEqual(['a', 'b'])
    expect(emailLinksLabel([])).toBe('Email all links')
    expect(emailLinksLabel(['a', 'a', 'b'])).toBe('Email links (2)')
    expect(emailLinksLabel(['', ' '])).toBe('Email links (0)')
  })

  it.each([
    ['emailable', {}, true],
    ['no email', { email: undefined }, false],
    ['blank email', { email: '  ' }, false],
    ['disabled', { access: 'disabled' as const }, false],
    ['revoked link', { link: makeLink({ status: 'revoked' }) }, false],
    ['no link', { link: makeLink({ status: 'none' }) }, false],
    ['needs reissue', { link: makeLink({ needsReissue: true }) }, false],
  ])('%s -> %s', (_label, overrides, expected) => {
    expect(looksEmailable(makeEntry({ email: 'a@example.org', ...overrides }))).toBe(expected)
  })

  it('considers the selected entries, or everyone for none', () => {
    const entries = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' }), makeEntry({ id: 'c' })]
    expect(consideredEntries(entries, []).map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(consideredEntries(entries, ['c', 'a', 'zz']).map(e => e.id)).toEqual(['a', 'c'])
  })

  it('summarises by status and groups the others by reason, first seen first', () => {
    const summary = summarizeResult({
      results: [
        { participantId: '1', status: 'sent' },
        { participantId: '2', status: 'skipped', reason: 'noEmail' },
        { participantId: '3', status: 'failed', reason: 'rateLimited' },
        { participantId: '4', status: 'skipped', reason: 'noEmail' },
        { participantId: '5', status: 'failed', reason: 'somethingNew' },
        { participantId: '6', status: 'sent' },
      ],
    })

    expect(summary).toMatchObject({ sent: 2, skipped: 2, failed: 2 })
    expect(summary.groups).toEqual([
      { status: 'skipped', reason: 'noEmail', text: 'no email address', participantIds: ['2', '4'] },
      {
        status: 'failed',
        reason: 'rateLimited',
        text: 'email limit reached; send again to just these people later',
        participantIds: ['3'],
      },
      { status: 'failed', reason: 'somethingNew', text: 'no reason given', participantIds: ['5'] },
    ])
  })

  it('the unsent are only rateLimited and notAttempted: never sendFailed, skipped or sent', () => {
    // Copilot review on #487: "Send again" re-posts ONLY the two reasons that never
    // reached the provider. A refusal (sendFailed) would likely be refused again.
    expect(unsentIds({
      results: [
        { participantId: 'sent', status: 'sent' },
        { participantId: 'limited', status: 'failed', reason: 'rateLimited' },
        { participantId: 'no-email', status: 'skipped', reason: 'noEmail' },
        { participantId: 'late', status: 'failed', reason: 'notAttempted' },
        { participantId: 'refused', status: 'failed', reason: 'sendFailed' },
      ],
    })).toEqual(['limited', 'late'])
    expect(unsentIds({ results: [{ participantId: 'a', status: 'sent' }] })).toEqual([])
  })

  it('never offers a timed-out or an unknown-reason failure for resending (it may have been sent)', () => {
    expect(unsentIds({
      results: [
        { participantId: 'slow', status: 'failed', reason: 'timedOut' },
        { participantId: 'odd', status: 'failed', reason: 'somethingNew' },
        { participantId: 'bare', status: 'failed' },
        { participantId: 'limited', status: 'failed', reason: 'rateLimited' },
      ],
    })).toEqual(['limited'])
    expect(reasonText('timedOut')).toBe(
      'not confirmed sent: it may have been sent, so check with them before sending again',
    )
  })

  it('words every known reason and counts people', () => {
    for (const reason of [
      'noEmail', 'noActiveLink', 'disabled', 'tokenUnrecoverable', 'notFound',
      'sendFailed', 'rateLimited', 'notAttempted', 'timedOut',
    ]) {
      expect(reasonText(reason)).not.toBe('no reason given')
    }
    expect(reasonText(undefined)).toBe('no reason given')
    expect(people(1)).toBe('1 person')
    expect(people(0)).toBe('0 people')
  })
})

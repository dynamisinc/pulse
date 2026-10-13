/**
 * Which action buttons a roster row offers, which are confirmed, and what is
 * announced (easy-login story 10). No message may contain a join URL.
 */
import { describe, expect, it } from 'vitest'
import { RosterError } from '../../services/rosterService'
import { makeEntry, makeLink } from '../../test/fixtures'
import {
  actionLabel,
  availableActions,
  confirmText,
  failureMessage,
  needsConfirmation,
  successMessage,
} from './rosterActions'

describe('availableActions', () => {
  it('an active link: Copy, Reissue, Revoke, Disable', () => {
    expect(availableActions(makeEntry())).toEqual(['copy', 'reissue', 'revoke', 'disable'])
  })

  it('an active link whose URL is not available offers no Copy (nothing to copy)', () => {
    const entry = makeEntry({ link: makeLink({ status: 'active' }) })
    expect(availableActions(entry)).toEqual(['reissue', 'revoke', 'disable'])
  })

  it('needsReissue offers Reissue INSTEAD of Copy, and still Revoke', () => {
    const entry = makeEntry({ link: makeLink({ status: 'active', needsReissue: true }) })
    expect(availableActions(entry)).toEqual(['reissue', 'revoke', 'disable'])
  })

  it('a revoked link offers Reissue (no Revoke, no Copy)', () => {
    const entry = makeEntry({ link: makeLink({ status: 'revoked' }) })
    expect(availableActions(entry)).toEqual(['reissue', 'disable'])
  })

  it('no link offers Issue link (the reissue action) and Disable', () => {
    const entry = makeEntry({ link: makeLink({ status: 'none' }) })
    expect(availableActions(entry)).toEqual(['reissue', 'disable'])
    expect(actionLabel('reissue', entry)).toBe('Issue link')
  })

  it('a disabled person offers only Enable', () => {
    expect(availableActions(makeEntry({ access: 'disabled' }))).toEqual(['enable'])
  })
})

describe('actionLabel', () => {
  it('words each button', () => {
    const entry = makeEntry()
    expect(actionLabel('copy', entry)).toBe('Copy link')
    expect(actionLabel('reissue', entry)).toBe('Reissue link')
    expect(actionLabel('revoke', entry)).toBe('Revoke link')
    expect(actionLabel('disable', entry)).toBe('Disable')
    expect(actionLabel('enable', entry)).toBe('Enable')
  })
})

describe('needsConfirmation', () => {
  it('reissue (with a link), revoke and disable are confirmed', () => {
    const entry = makeEntry()
    expect(needsConfirmation('reissue', entry)).toBe(true)
    expect(needsConfirmation('revoke', entry)).toBe(true)
    expect(needsConfirmation('disable', entry)).toBe(true)
  })

  it('copy and enable are never confirmed', () => {
    expect(needsConfirmation('copy', makeEntry())).toBe(false)
    expect(needsConfirmation('enable', makeEntry({ access: 'disabled' }))).toBe(false)
  })

  it('the FIRST link for someone with none and no live sessions has nothing to lose', () => {
    const none = makeEntry({ link: makeLink({ status: 'none' }), liveSessions: 0 })
    expect(needsConfirmation('reissue', none)).toBe(false)
  })

  it('but a no-link person with live sessions IS confirmed (it signs them out)', () => {
    const none = makeEntry({ link: makeLink({ status: 'none' }), liveSessions: 2 })
    expect(needsConfirmation('reissue', none)).toBe(true)
  })
})

describe('confirmText says plainly what will happen', () => {
  it('reissue: signs them out everywhere and the old link stops working', () => {
    const { body, confirmLabel } = confirmText('reissue', makeEntry())
    expect(body).toContain('This signs Jane Smith out everywhere and the old link stops working.')
    expect(confirmLabel).toBe('Reissue link')
  })

  it('revoke: signs out, the link stops, and the word still works unless disabled', () => {
    const { body } = confirmText('revoke', makeEntry())
    expect(body).toContain('signs Jane Smith out everywhere and the link stops working')
    expect(body).toContain('today\'s word unless you also disable them')
  })

  it('disable: link, word and password all stop until enabled', () => {
    const { title, body } = confirmText('disable', makeEntry())
    expect(title).toBe('Disable Jane Smith?')
    expect(body).toContain('signs Jane Smith out everywhere')
    expect(body).toContain('until you enable them again')
  })

  it('mentions how many live sessions will end, when there are any', () => {
    expect(confirmText('disable', makeEntry({ liveSessions: 2 })).body).toContain('2 live sessions')
    expect(confirmText('disable', makeEntry({ liveSessions: 1 })).body).toContain('1 live session ')
    expect(confirmText('disable', makeEntry({ liveSessions: 0 })).body).not.toContain('live session')
  })

  it('Issue link (no link yet) is worded as issuing, not reissuing', () => {
    const none = makeEntry({ link: makeLink({ status: 'none' }), liveSessions: 1 })
    const { title, confirmLabel } = confirmText('reissue', none)
    expect(title).toBe('Issue a link for Jane Smith?')
    expect(confirmLabel).toBe('Issue link')
  })

  it('never contains the join URL', () => {
    const entry = makeEntry()
    for (const kind of ['reissue', 'revoke', 'disable'] as const) {
      const { title, body } = confirmText(kind, entry)
      expect(`${title} ${body}`).not.toContain('pulse.example.test')
    }
  })
})

describe('successMessage reports sessionsEnded', () => {
  it('words each action with the count', () => {
    expect(successMessage('reissue', 'Jane Smith', 2)).toBe('New link issued for Jane Smith. 2 sessions ended.')
    expect(successMessage('revoke', 'Jane Smith', 1)).toBe('Link revoked for Jane Smith. 1 session ended.')
    expect(successMessage('disable', 'Jane Smith', 0)).toBe('Jane Smith disabled. No live sessions to end.')
    expect(successMessage('enable', 'Jane Smith', 0)).toBe('Jane Smith enabled.')
  })
})

describe('failureMessage', () => {
  it('maps the statuses to plain sentences', () => {
    expect(failureMessage(new RosterError('x', { status: 403 }), 'disable', 'Jane Smith'))
      .toBe('You don\'t have access to change this roster.')
    expect(failureMessage(new RosterError('x', { status: 404 }), 'revoke', 'Jane Smith'))
      .toContain('Jane Smith is no longer on this roster')
    expect(failureMessage(new RosterError('x'), 'revoke', 'Jane Smith')).toContain('Could not reach the server')
    expect(failureMessage(new RosterError('x', { status: 500, serverMessage: 'Boom' }), 'enable', 'Jane Smith'))
      .toBe('Could not enable Jane Smith: Boom')
  })
})

/**
 * core/auth/sessionResolver.default.test.ts
 * ---------------------------------------------------------------------------
 * Shipped-path coverage (Wave-0 precedent 19): unlike `sessionResolver.test.ts`
 * this does NOT mock the axios client — it exercises the ACTUAL wired path
 * (shared axios client + the dev mock adapter) so the default resolution used
 * by the app is really tested, not just the validation branches. Guards
 * against a regression where the mock flip point is broken or the canned
 * session drifts out of the valid shape.
 */
import { describe, it, expect } from 'vitest'
import { resolveSession, isSessionExpired } from './sessionResolver'

describe('resolveSession (shipped mock path)', () => {
  it('resolves the bound participant session for the mock exercise', async () => {
    const session = await resolveSession()

    expect(session.exerciseId).toBe('ex-mock-0001')
    expect(session.accountId).toBe('acct-dreyes')
    expect(session.role).toBe('participant')
    expect(session.personaId).toBe('persona-dreyes_fh')
    expect(session.actingHumanId).toBe('human-dreyes')
    expect(session.isReadOnly).toBe(false)
  })

  it('stamps a live, not-yet-expired expiry (short-lived session)', async () => {
    const session = await resolveSession()
    expect(isSessionExpired(session, new Date())).toBe(false)
  })
})

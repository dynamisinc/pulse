/**
 * features/controller/services/composeService.live.test.ts
 * ---------------------------------------------------------------------------
 * `composeAsPersona` in LIVE mode with a real uploaded asset (demo-polish F0, M-1).
 * The console's publish path is `composeAsPersona` (a pure local `Post`) followed
 * by the real `publishPost`; if the first step threw for a media id the MOCK
 * registry doesn't know, the live publish would never be sent. It must return the
 * local `Post` instead, so the caller proceeds to `publishPost`.
 */
import { describe, expect, it, vi } from 'vitest'
import { composeAsPersona } from './composeService'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

describe('composeAsPersona (live) — a real uploaded asset id does not block the publish', () => {
  it('returns the local controller-as-persona Post instead of throwing', () => {
    const post = composeAsPersona({
      exerciseId: 'ex-live-0001',
      timeZone: 'America/New_York',
      scenarioTime: '2033-09-04T14:00:00.000Z',
      authorPersonaId: 'persona-fairhavenwater',
      actingHumanId: 'human-ctl-7',
      text: 'Distribution opens at 3 PM.',
      media: [{ mediaId: '7f1c0c0e-0000-4000-8000-000000000001', alt: 'Distribution site' }],
    })

    expect(post.origin).toBe('controller-as-persona')
    expect(post.text).toBe('Distribution opens at 3 PM.')
  })
})

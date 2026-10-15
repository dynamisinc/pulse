/**
 * features/controller/noise/noiseOrigin.test.ts
 * ---------------------------------------------------------------------------
 * Story 09 AC4 (01 Gate-1 L1): the `noise` origin exists on the client. The telemetry origin enum
 * accepts it, and the console's origin line labels it `NOISE · AUTO` so Live world never shows the
 * raw string. Participant views carry no origin at all, so they show nothing new.
 */
import { describe, expect, it, vi } from 'vitest'
import { telemetryOriginSchema } from '@/core/telemetry'
import { originConsoleLabel, toParticipantView } from '@/features/social/services/postService'
import type { Post } from '@/features/social/types/post'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

const NOISE_POST: Post = {
  id: 'post-noise-1',
  exerciseId: 'ex-mock-0001',
  authorPersonaId: 'persona-1',
  actingHumanId: '',
  text: 'Anyone else hear the sirens on 5th?',
  counts: { like: 0, repost: 0, reply: 0 },
  createdWallClock: '2026-10-20T14:00:00.000Z',
  scenarioTime: '2026-10-20T09:00:00.000Z',
  origin: 'noise',
}

describe('the noise origin (client)', () => {
  it('is a telemetry origin', () => {
    expect(telemetryOriginSchema.safeParse('noise').success).toBe(true)
  })

  it('has a console label, never the raw string', () => {
    expect(originConsoleLabel(NOISE_POST)).toBe('NOISE · AUTO')
  })

  it('is not on the participant view', () => {
    expect(toParticipantView(NOISE_POST)).not.toHaveProperty('origin')
  })
})

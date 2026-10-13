/**
 * features/participantAdmin/dayWord/dayWordMocks.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 11: the mock adapter implements the three calls of the FROZEN
 * contract - generated vs typed, replaced, a 400 and a 403 - so the panel runs
 * with no backend. Driven through the SHIPPED service (real `api` client, the
 * adapter attached because `USE_MOCK_DATA` is on under Vitest), so a contract
 * drift in either half fails here.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { dayWordMockControls, MOCK_DAY_WORD_TIME_ZONE } from './dayWordMocks'
import { deleteDayWord, getDayWordStatus, putDayWord, type DayWordError } from './dayWordService'
import { isDateString } from './dayWordDates'
import type { DayWordPutBody, DayWordPutRequest } from './types'

// 12:00 EDT on Tuesday 2026-10-13 in the mock exercise zone.
const NOW = new Date('2026-10-13T16:00:00.000Z')
const TODAY = '2026-10-13'

/**
 * The mock models the SERVER, whose contract lets `date` be omitted ("today"). The shipped
 * client never omits it (Gate-2 W-1), so its types forbid that; these cases test the
 * ADAPTER's defaulting and so speak the wire contract directly through the same code path.
 */
const putOmittingDate = (body: DayWordPutBody) => putDayWord(body as DayWordPutRequest)
const deleteOmittingDate = () => deleteDayWord(undefined as unknown as string)

async function failure(promise: Promise<unknown>): Promise<DayWordError> {
  try {
    await promise
  } catch (error) {
    return error as DayWordError
  }
  throw new Error('expected the call to fail')
}

beforeEach(() => {
  dayWordMockControls.reset()
  dayWordMockControls.setNow(NOW)
})

describe('GET status', () => {
  it('starts with nothing set', async () => {
    const status = await getDayWordStatus()
    expect(status).toMatchObject({
      timeZone: MOCK_DAY_WORD_TIME_ZONE,
      today: TODAY,
      todaySet: false,
      replacedCount: 0,
      upcoming: [],
    })
    expect(isDateString(status.today)).toBe(true)
  })

  it('reports today as ending at the next local midnight (an instant)', async () => {
    const status = await getDayWordStatus()
    // Midnight 2026-10-14 in New York (EDT, UTC-4) is 04:00Z.
    expect(new Date(status.todayEndsAt).toISOString()).toBe('2026-10-14T04:00:00.000Z')
  })

  it('follows the wall clock in the exercise zone, not UTC', async () => {
    // 02:00Z on 10-14 is still 22:00 on 10-13 in New York.
    dayWordMockControls.setNow(new Date('2026-10-14T02:00:00.000Z'))
    expect((await getDayWordStatus()).today).toBe('2026-10-13')
  })

  it('handles a DST change when computing the end of the day', async () => {
    // US fall back is 2026-11-01: that local day is 25 hours long.
    dayWordMockControls.setNow(new Date('2026-11-01T12:00:00.000Z'))
    const status = await getDayWordStatus()
    expect(status.today).toBe('2026-11-01')
    // Midnight 2026-11-02 EST (UTC-5) is 05:00Z.
    expect(new Date(status.todayEndsAt).toISOString()).toBe('2026-11-02T05:00:00.000Z')
  })

  it('lists later dates (dates only) in order and never returns a word', async () => {
    await putDayWord({ date: '2026-10-16' })
    await putDayWord({ date: '2026-10-15' })

    const status = await getDayWordStatus()

    expect(status.upcoming.map(item => item.date)).toEqual(['2026-10-15', '2026-10-16'])
    expect(JSON.stringify(status)).not.toMatch(/word"/i)
  })
})

describe('PUT', () => {
  it('generates a word when none is supplied', async () => {
    const result = await putOmittingDate({})
    expect(result).toMatchObject({ date: TODAY, generated: true, replaced: false })
    expect(result.word.length).toBeGreaterThan(5)
    expect(new Date(result.validUntil).toISOString()).toBe('2026-10-14T04:00:00.000Z')
  })

  it('records a typed word as typed', async () => {
    const result = await putOmittingDate({ word: 'Pine Cone 42' })
    expect(result).toMatchObject({ generated: false, replaced: false, word: 'Pine Cone 42' })
  })

  it('flips todaySet and records who and when, without keeping the word', async () => {
    await putOmittingDate({ word: 'pinecone42' })

    const status = await getDayWordStatus()

    expect(status.todaySet).toBe(true)
    expect(status.setByName).toBeTruthy()
    expect(new Date(status.setAt ?? '').toISOString()).toBe(NOW.toISOString())
    expect(JSON.stringify(status)).not.toContain('pinecone42')
  })

  it('marks a second set for the same date as a rotation and counts it', async () => {
    await putOmittingDate({})
    const second = await putOmittingDate({})
    const third = await putOmittingDate({ word: 'another word 1' })

    expect(second.replaced).toBe(true)
    expect(third.replaced).toBe(true)
    expect((await getDayWordStatus()).replacedCount).toBe(2)
  })

  it('pre-sets a later date without touching today', async () => {
    const result = await putDayWord({ date: '2026-10-20' })

    expect(result.date).toBe('2026-10-20')
    expect(new Date(result.validUntil).toISOString()).toBe('2026-10-21T04:00:00.000Z')
    const status = await getDayWordStatus()
    expect(status.todaySet).toBe(false)
    expect(status.upcoming).toHaveLength(1)
  })

  it('accepts the last allowed day (14 days ahead)', async () => {
    await expect(putDayWord({ date: '2026-10-27' })).resolves.toMatchObject({ date: '2026-10-27' })
  })

  it('400s a word that is too short once normalised, with a readable reason', async () => {
    const error = await failure(putOmittingDate({ word: 'a b c d' }))
    expect(error.status).toBe(400)
    expect(error.serverMessage).toMatch(/6 to 64/)
  })

  it('400s a word that is too long once normalised', async () => {
    const error = await failure(putOmittingDate({ word: 'x'.repeat(65) }))
    expect(error.status).toBe(400)
  })

  it('accepts exactly the boundary lengths (6 and 64)', async () => {
    await expect(putOmittingDate({ word: 'abcdef' })).resolves.toBeDefined()
    await expect(putOmittingDate({ word: 'a'.repeat(64) })).resolves.toBeDefined()
  })

  it('400s a date in the past, a date too far ahead, and a malformed date', async () => {
    expect((await failure(putDayWord({ date: '2026-10-12' }))).status).toBe(400)
    expect((await failure(putDayWord({ date: '2026-10-28' }))).status).toBe(400)
    expect((await failure(putDayWord({ date: 'tomorrow' }))).status).toBe(400)
  })

  it('does not change anything on a 400', async () => {
    await failure(putOmittingDate({ word: 'ab' }))
    expect((await getDayWordStatus()).todaySet).toBe(false)
  })

  it('logs only whether a word was typed and the date - never the word', async () => {
    await putOmittingDate({})
    await putDayWord({ word: 'pinecone42', date: '2026-10-15' })

    const log = dayWordMockControls.putRequests()

    expect(log).toEqual([{ hasWord: false }, { hasWord: true, date: '2026-10-15' }])
    expect(JSON.stringify(log)).not.toContain('pinecone42')
  })
})

describe('DELETE', () => {
  it('turns off today', async () => {
    await putOmittingDate({})

    await expect(deleteOmittingDate()).resolves.toBeUndefined()

    expect((await getDayWordStatus()).todaySet).toBe(false)
  })

  it('clears a later date only', async () => {
    await putOmittingDate({})
    await putDayWord({ date: '2026-10-15' })

    await deleteDayWord('2026-10-15')

    const status = await getDayWordStatus()
    expect(status.todaySet).toBe(true)
    expect(status.upcoming).toEqual([])
  })

  it('is idempotent: clearing a day with no word still succeeds', async () => {
    await expect(deleteOmittingDate()).resolves.toBeUndefined()
    await expect(deleteOmittingDate()).resolves.toBeUndefined()
    await expect(deleteDayWord('2026-10-20')).resolves.toBeUndefined()
  })

  it('400s a malformed or out-of-window date', async () => {
    expect((await failure(deleteDayWord('nope'))).status).toBe(400)
    expect((await failure(deleteDayWord('2026-10-12'))).status).toBe(400)
    expect((await failure(deleteDayWord('2026-11-30'))).status).toBe(400)
  })
})

describe('error injection', () => {
  it('403s every call once forbidden (an evaluator, or a wrong role)', async () => {
    dayWordMockControls.forbid()

    for (const call of [
      () => getDayWordStatus(),
      () => putOmittingDate({}),
      () => deleteOmittingDate(),
    ]) {
      const error = await failure(call())
      expect(error.status).toBe(403)
      expect(error.serverMessage).toMatch(/controller or planner/)
    }
  })

  it('can limit a queued failure to one method, leaving the others untouched', async () => {
    dayWordMockControls.failNext(503, 'Down.', { method: 'get' })

    // A PUT is not the GET it was queued for, so it goes through.
    await expect(putOmittingDate({})).resolves.toBeDefined()
    expect((await failure(getDayWordStatus())).status).toBe(503)
    await expect(getDayWordStatus()).resolves.toBeDefined()
  })

  it('can queue several consecutive failures (one per retry attempt)', async () => {
    dayWordMockControls.failNext(503, 'Down.', { method: 'get', times: 3 })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await failure(getDayWordStatus())).status).toBe(503)
    }
    await expect(getDayWordStatus()).resolves.toBeDefined()
  })

  it('malformNext: the change COMMITS but the answer is not the contract shape', async () => {
    dayWordMockControls.malformNext()

    const error = await failure(putOmittingDate({ word: 'pinecone42' }))
    expect(error.kind).toBe('malformed')
    // The word really was set, even though the caller could not read the answer.
    expect((await getDayWordStatus()).todaySet).toBe(true)
    // One-shot: the next call is normal.
    await expect(putOmittingDate({})).resolves.toBeDefined()
  })

  it('fails only the NEXT request with the queued status and reason', async () => {
    dayWordMockControls.failNext(400, 'Pick a different word.')

    const error = await failure(putOmittingDate({ word: 'pinecone42' }))
    expect(error).toMatchObject({ status: 400, serverMessage: 'Pick a different word.' })
    await expect(putOmittingDate({ word: 'pinecone42' })).resolves.toBeDefined()
  })
})

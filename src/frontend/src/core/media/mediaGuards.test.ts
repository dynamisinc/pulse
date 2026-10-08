/**
 * core/media/mediaGuards.test.ts
 * ---------------------------------------------------------------------------
 * The runtime parsers for the media wire shapes, pinned at the frozen contract's
 * numeric bounds (implementation.md §1.5.1): `width` / `height` are integers
 * 1..16384, `durationSec` is a double with 0 < x <= 3600 (so fractional seconds
 * are valid — it is `video.duration`). A PRESENT value outside that range fails
 * closed (`undefined`); `null` / absent on an optional member is still just
 * "absent". The staff parser inherits the same bounds.
 */
import { describe, expect, it } from 'vitest'
import { parseMediaAssetView, parseStaffMediaAssetView } from './mediaGuards'

const BASE = { id: 'asset-1', kind: 'video', url: 'https://blob/v.mp4?sig' }

describe('parseMediaAssetView — width / height are integers 1..16384', () => {
  it.each([
    ['1 (lower bound)', 1, true],
    ['16384 (upper bound)', 16384, true],
    ['640', 640, true],
    ['0', 0, false],
    ['16385', 16385, false],
    ['1.5 (fractional)', 1.5, false],
    ['-1', -1, false],
    ['NaN', Number.NaN, false],
    ['Infinity', Number.POSITIVE_INFINITY, false],
  ])('width and height of %s', (_label, value, valid) => {
    for (const member of ['width', 'height'] as const) {
      const parsed = parseMediaAssetView({ ...BASE, [member]: value })
      if (valid) expect(parsed).toMatchObject({ [member]: value })
      else expect(parsed).toBeUndefined()
    }
  })
})

describe('parseMediaAssetView — durationSec is 0 < x <= 3600 (fractions allowed)', () => {
  it.each([
    ['0.1 (fractional, just above zero)', 0.1, true],
    ['12.5 (fractional)', 12.5, true],
    ['3600 (upper bound)', 3600, true],
    ['0', 0, false],
    ['3600.1', 3600.1, false],
    ['-1', -1, false],
    ['NaN', Number.NaN, false],
    ['Infinity', Number.POSITIVE_INFINITY, false],
  ])('durationSec of %s', (_label, value, valid) => {
    const parsed = parseMediaAssetView({ ...BASE, durationSec: value })
    if (valid) expect(parsed).toMatchObject({ durationSec: value })
    else expect(parsed).toBeUndefined()
  })
})

describe('parseMediaAssetView — null / absent optional members', () => {
  it('treats null width / height / durationSec as absent and drops the keys', () => {
    const parsed = parseMediaAssetView({
      ...BASE,
      posterUrl: null,
      width: null,
      height: null,
      durationSec: null,
    })

    expect(parsed).toEqual(BASE)
    expect(Object.keys(parsed ?? {}).sort()).toEqual(['id', 'kind', 'url'])
  })

  it('accepts a view with none of the optional members', () => {
    expect(parseMediaAssetView(BASE)).toEqual(BASE)
  })

  it('one out-of-range member fails the whole view even when the others are valid', () => {
    expect(
      parseMediaAssetView({ ...BASE, width: 640, height: 16385, durationSec: 4 }),
    ).toBeUndefined()
    expect(
      parseMediaAssetView({ ...BASE, width: 640, height: 360, durationSec: 3601 }),
    ).toBeUndefined()
  })

  it('still fails closed on a wrong-typed optional member', () => {
    expect(parseMediaAssetView({ ...BASE, width: '640' })).toBeUndefined()
  })
})

describe('parseStaffMediaAssetView — inherits the same bounds', () => {
  const STAFF = { ...BASE, fileName: 'clip.mp4', uploadedAtScenario: '2033-09-04T12:00:00.000Z' }

  it('accepts an in-range row', () => {
    expect(parseStaffMediaAssetView({ ...STAFF, width: 16384, durationSec: 3600 })).toMatchObject({
      width: 16384,
      durationSec: 3600,
    })
  })

  it.each([
    ['width 0', { width: 0 }],
    ['height 16385', { height: 16385 }],
    ['fractional width', { width: 1.5 }],
    ['durationSec 0', { durationSec: 0 }],
    ['durationSec 3600.1', { durationSec: 3600.1 }],
  ])('rejects a row with %s', (_label, patch) => {
    expect(parseStaffMediaAssetView({ ...STAFF, ...patch })).toBeUndefined()
  })
})

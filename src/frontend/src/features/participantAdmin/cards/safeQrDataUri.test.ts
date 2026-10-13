/**
 * features/participantAdmin/cards/safeQrDataUri.test.ts
 * ---------------------------------------------------------------------------
 * The QR allow-list (NFR-004, EL-12): exactly one shape reaches an `<img src>`.
 */
import { describe, expect, it } from 'vitest'
import { MAX_QR_DATA_URI_LENGTH, resolveSafeQrDataUri } from './safeQrDataUri'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'
const GOOD = `data:image/svg+xml;base64,${btoa(SVG)}`

describe('resolveSafeQrDataUri', () => {
  it('admits a base64 SVG data URI and returns it byte-for-byte', () => {
    expect(resolveSafeQrDataUri(GOOD)).toBe(GOOD)
  })

  it('admits base64 padding (= and ==)', () => {
    expect(resolveSafeQrDataUri('data:image/svg+xml;base64,QQ==')).toBeDefined()
    expect(resolveSafeQrDataUri('data:image/svg+xml;base64,QUI=')).toBeDefined()
  })

  it.each([
    ['javascript: URL', 'javascript:alert(1)'],
    ['an https URL', 'https://example.com/qr.svg'],
    ['a blob URL', 'blob:https://example.com/abc'],
    ['a file URL', 'file:///etc/passwd'],
    ['an HTML data URI', `data:text/html;base64,${btoa('<script>alert(1)</script>')}`],
    ['a PNG data URI', 'data:image/png;base64,QQ=='],
    ['an unencoded (utf8) SVG data URI', `data:image/svg+xml;utf8,${SVG}`],
    ['a percent-encoded SVG data URI', `data:image/svg+xml,${encodeURIComponent(SVG)}`],
    ['a base64 URI with a charset parameter', 'data:image/svg+xml;charset=utf-8;base64,QQ=='],
    ['an empty payload', 'data:image/svg+xml;base64,'],
    ['a payload with whitespace', 'data:image/svg+xml;base64,QUJD RA=='],
    ['a payload with a newline', 'data:image/svg+xml;base64,QUJD\nRA=='],
    ['a payload with a quote that could break out of an attribute', 'data:image/svg+xml;base64,QQ=="'],
    ['trailing junk after the payload', 'data:image/svg+xml;base64,QQ==;javascript:alert(1)'],
    ['an upper-cased scheme', 'DATA:image/svg+xml;base64,QQ=='],
    ['a leading space', ` ${GOOD}`],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(resolveSafeQrDataUri(value)).toBeUndefined()
  })

  it.each([undefined, null, 42, {}, [], true])('rejects a non-string (%s)', value => {
    expect(resolveSafeQrDataUri(value)).toBeUndefined()
  })

  it('rejects a payload over the size bound and admits one at it', () => {
    const prefix = 'data:image/svg+xml;base64,'
    const atLimit = prefix + 'A'.repeat(MAX_QR_DATA_URI_LENGTH - prefix.length)
    expect(resolveSafeQrDataUri(atLimit)).toBe(atLimit)
    expect(resolveSafeQrDataUri(atLimit + 'A')).toBeUndefined()
  })
})

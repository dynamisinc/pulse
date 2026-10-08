/**
 * features/social/components/media/safeMediaUrl.test.ts
 * ---------------------------------------------------------------------------
 * The NFR-004 / COR-002 unsafe-URL REJECTION MATRIX for media `src`s (demo-polish
 * F2): what may reach an `<img>` / `<video>` / `poster`, and — as important — what
 * must never. Pure function, deterministic: the page origin and the dev flag are
 * injected, so the matrix does not depend on the test runner's environment.
 */
import { describe, expect, it } from 'vitest'
import {
  isSafeMediaUrl,
  resolveSafeMediaUrl,
  withFirstFrameHint,
  withStartTime,
} from './safeMediaUrl'

const PAGE = 'https://pulse.example.org/social'
const prod = { baseUrl: PAGE, allowDevHttp: false } as const
const dev = { baseUrl: 'http://localhost:5198/', allowDevHttp: true } as const

describe('resolveSafeMediaUrl — allowed', () => {
  it.each([
    ['an https URL', 'https://pulsestore.blob.core.windows.net/media/abc.jpg?sv=2024&sig=a%2Bb%3D'],
    ['an https URL on any host', 'https://cdn.example.net/x.png'],
    ['a root-relative same-origin path', '/mock-media/photos/flood-main-street.svg'],
    ['a document-relative same-origin path', 'media/x.png'],
    ['a blob: object URL', 'blob:https://pulse.example.org/6f8b9d1c-aaaa-bbbb-cccc-0123456789ab'],
  ])('allows %s (and returns it byte-for-byte)', (_label, url) => {
    expect(resolveSafeMediaUrl(url, prod)).toBe(url)
  })

  it('trims surrounding whitespace but otherwise leaves the URL untouched', () => {
    expect(resolveSafeMediaUrl('  /mock-media/a.svg \n', prod)).toBe('/mock-media/a.svg')
  })

  it('allows http://localhost and http://127.0.0.1 in a dev build only', () => {
    expect(resolveSafeMediaUrl('http://localhost:10000/devstoreaccount1/m/a.jpg', dev))
      .toBe('http://localhost:10000/devstoreaccount1/m/a.jpg')
    expect(resolveSafeMediaUrl('http://127.0.0.1:10000/devstoreaccount1/m/a.mp4', dev))
      .toBe('http://127.0.0.1:10000/devstoreaccount1/m/a.mp4')
    expect(resolveSafeMediaUrl('http://localhost:10000/a.jpg', prod)).toBeUndefined()
    expect(resolveSafeMediaUrl('http://127.0.0.1:10000/a.jpg', prod)).toBeUndefined()
  })
})

describe('resolveSafeMediaUrl — rejected (the NFR-004 matrix)', () => {
  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['JAVASCRIPT: (case)', 'JaVaScRiPt:alert(1)'],
    ['javascript: with an embedded tab', 'java\tscript:alert(1)'],
    ['javascript: with an embedded newline', 'java\nscript:alert(1)'],
    ['javascript: with a leading control char', '\u0001javascript:alert(1)'],
    ['data: image', 'data:image/png;base64,iVBORw0KGgo='],
    ['data: html', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
    ['ftp:', 'ftp://example.org/a.png'],
    ['about:', 'about:blank'],
    ['chrome:', 'chrome://settings'],
    ['plain http to another host', 'http://example.org/a.png'],
    ['https with credentials', 'https://user:secret@example.org/a.png'],
    ['a protocol-relative URL (another origin)', '//evil.example.net/a.png'],
    ['a backslash protocol-relative URL', '/\\evil.example.net/a.png'],
    ['a double-backslash URL', '\\\\evil.example.net\\a.png'],
    ['a blob: URL for ANOTHER origin', 'blob:https://evil.example.net/6f8b9d1c-aaaa-bbbb-cccc-0123456789ab'],
    ['a blob: URL on another port', 'blob:https://pulse.example.org:8443/6f8b9d1c'],
    ['a malformed blob: URL', 'blob:not-a-url'],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('rejects %s', (_label, url) => {
    expect(resolveSafeMediaUrl(url, prod)).toBeUndefined()
    expect(isSafeMediaUrl(url, prod)).toBe(false)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { href: 'https://example.org/a.png' }],
  ])('rejects non-string input: %s', (_label, value) => {
    expect(resolveSafeMediaUrl(value, prod)).toBeUndefined()
  })

  it('still rejects dev-only hosts that merely LOOK like localhost, even in dev', () => {
    expect(resolveSafeMediaUrl('http://localhost.evil.example.net/a.png', dev)).toBeUndefined()
    expect(resolveSafeMediaUrl('http://127.0.0.1.evil.example.net/a.png', dev)).toBeUndefined()
    expect(resolveSafeMediaUrl('http://evil.example.net/a.png', dev)).toBeUndefined()
    expect(resolveSafeMediaUrl('http://user:pw@localhost:10000/a.png', dev)).toBeUndefined()
  })

  it('rejects data: and javascript: in dev too (dev only widens http on loopback)', () => {
    expect(resolveSafeMediaUrl('data:image/svg+xml,<svg/>', dev)).toBeUndefined()
    expect(resolveSafeMediaUrl('javascript:alert(1)', dev)).toBeUndefined()
  })
})

describe('withFirstFrameHint', () => {
  it('appends #t=0.1 so a poster-less video paints a frame', () => {
    expect(withFirstFrameHint('/mock-media/video/a.mp4')).toBe('/mock-media/video/a.mp4#t=0.1')
    expect(withFirstFrameHint('https://s/a.mp4?sig=x')).toBe('https://s/a.mp4?sig=x#t=0.1')
  })

  it('leaves a URL that already has a fragment alone', () => {
    expect(withFirstFrameHint('/a.mp4#t=5')).toBe('/a.mp4#t=5')
  })
})

describe('withStartTime', () => {
  it('appends #t=<seconds> to one decimal', () => {
    expect(withStartTime('/a.mp4', 12.5)).toBe('/a.mp4#t=12.5')
    expect(withStartTime('https://s/a.mp4?sig=x', 3)).toBe('https://s/a.mp4?sig=x#t=3.0')
  })

  it('REPLACES an existing t= fragment instead of silently dropping the resume (L-C)', () => {
    expect(withStartTime('/a.mp4#t=5', 9)).toBe('/a.mp4#t=9.0')
    expect(withStartTime('/a.mp4#t=5,10', 9)).toBe('/a.mp4#t=9.0')
    expect(withStartTime('/a.mp4#t=0.1', 2.25)).toBe('/a.mp4#t=2.3')
  })

  it('keeps other fragment components alongside the new t=', () => {
    expect(withStartTime('/a.mp4#track=audio&t=5', 9)).toBe('/a.mp4#track=audio&t=9.0')
    expect(withStartTime('/a.mp4#track=audio', 9)).toBe('/a.mp4#track=audio&t=9.0')
  })

  it('is a no-op for a zero / negative / non-finite time (an existing fragment is left alone)', () => {
    expect(withStartTime('/a.mp4', 0)).toBe('/a.mp4')
    expect(withStartTime('/a.mp4', -1)).toBe('/a.mp4')
    expect(withStartTime('/a.mp4', Number.NaN)).toBe('/a.mp4')
    expect(withStartTime('/a.mp4#t=5', 0)).toBe('/a.mp4#t=5')
  })
})

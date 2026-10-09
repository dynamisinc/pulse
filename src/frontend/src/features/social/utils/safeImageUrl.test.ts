/**
 * features/social/utils/safeImageUrl.test.ts
 * ---------------------------------------------------------------------------
 * The allow-list in front of every persona `<img src>` (avatars, banners) is F2's
 * `resolveSafeMediaUrl` (Gate-1 M-2: one list, not two): https, same-origin paths and
 * blob: object URLs, plus dev-only loopback http, pass; scripts, data URIs,
 * protocol-relative, credentials and blanks do not (XC-009, NFR-004). The full matrix
 * lives in `components/media/safeMediaUrl.test.ts`; this pins the DELEGATION and the
 * persona-image cases.
 */
import { describe, expect, it } from 'vitest'
import { resolveSafeMediaUrl } from '../components/media/safeMediaUrl'
import { safeImageUrl } from './safeImageUrl'

const PAGE = 'https://pulse.example.org/social'
const prod = { baseUrl: PAGE, allowDevHttp: false } as const
const dev = { baseUrl: 'http://localhost:5198/', allowDevHttp: true } as const

describe('safeImageUrl', () => {
  it('passes https, same-origin paths and same-origin blob urls through (trimmed)', () => {
    expect(safeImageUrl('https://cdn.example/a.png?sig=1', prod)).toBe('https://cdn.example/a.png?sig=1')
    expect(safeImageUrl('/mock-media/avatars/a.svg', prod)).toBe('/mock-media/avatars/a.svg')
    expect(safeImageUrl('media/a.png', prod)).toBe('media/a.png')
    expect(safeImageUrl('blob:https://pulse.example.org/1234', prod))
      .toBe('blob:https://pulse.example.org/1234')
    expect(safeImageUrl('  /a.svg  ', prod)).toBe('/a.svg')
  })

  it('allows loopback http in a dev build only (Azurite / the Vite dev server)', () => {
    expect(safeImageUrl('http://127.0.0.1:10000/a.png', dev)).toBe('http://127.0.0.1:10000/a.png')
    expect(safeImageUrl('http://localhost:10000/a.png', dev)).toBe('http://localhost:10000/a.png')
    expect(safeImageUrl('http://127.0.0.1:10000/a.png', prod)).toBeUndefined()
    expect(safeImageUrl('http://cdn.example/a.png', dev)).toBeUndefined()
  })

  it('rejects scripts, data uris, other origins, credentials, protocol-relative and blanks', () => {
    for (const bad of [
      undefined,
      '',
      '   ',
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      'data:image/png;base64,AAAA',
      'vbscript:msgbox(1)',
      '//evil.example/a.png',
      '/\\evil.example/a.png',
      'https://user:pw@cdn.example/a.png',
      'blob:https://evil.example/1234',
      'ftp://host/a.png',
      'file:///etc/passwd',
    ]) {
      expect(safeImageUrl(bad, prod), String(bad)).toBeUndefined()
    }
  })

  it('IS the shared media allow-list: it agrees with resolveSafeMediaUrl on every input', () => {
    for (const url of [
      'https://cdn.example/a.png',
      '/a.png',
      'a.png',
      'javascript:alert(1)',
      '//evil/a.png',
      'http://localhost:1/a.png',
      'blob:https://pulse.example.org/1',
      '',
    ]) {
      expect(safeImageUrl(url, prod), url).toBe(resolveSafeMediaUrl(url, prod))
      expect(safeImageUrl(url, dev), url).toBe(resolveSafeMediaUrl(url, dev))
    }
  })
})

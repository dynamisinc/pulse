/**
 * features/social/utils/safeImageUrl.test.ts
 * ---------------------------------------------------------------------------
 * The allow-list in front of every persona `<img src>` (avatars, banners): only
 * https/http/blob and root-relative paths pass; scripts, data URIs,
 * protocol-relative and bare-relative URLs, and blanks do not (XC-009).
 */
import { describe, expect, it } from 'vitest'
import { safeImageUrl } from './safeImageUrl'

describe('safeImageUrl', () => {
  it('passes https, http, blob and root-relative urls through (trimmed)', () => {
    expect(safeImageUrl('https://cdn.example/a.png?sig=1')).toBe('https://cdn.example/a.png?sig=1')
    expect(safeImageUrl('HTTP://127.0.0.1:10000/a.png')).toBe('HTTP://127.0.0.1:10000/a.png')
    expect(safeImageUrl('blob:http://localhost/1234')).toBe('blob:http://localhost/1234')
    expect(safeImageUrl('/mock-media/avatars/a.svg')).toBe('/mock-media/avatars/a.svg')
    expect(safeImageUrl('  /a.svg  ')).toBe('/a.svg')
  })

  it('rejects scripts, data uris, protocol-relative, bare-relative and blank values', () => {
    for (const bad of [
      undefined,
      '',
      '   ',
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:image/png;base64,AAAA',
      'vbscript:msgbox(1)',
      '//evil.example/a.png',
      '/\\evil.example/a.png',
      'a.png',
      './a.png',
      'ftp://host/a.png',
    ]) {
      expect(safeImageUrl(bad), String(bad)).toBeUndefined()
    }
  })
})

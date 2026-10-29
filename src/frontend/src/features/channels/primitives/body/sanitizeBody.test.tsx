/**
 * The body sanitizer against a payload corpus (NFR-004). Each payload is sanitized AND
 * mounted through `SanitizedBody`; nothing may execute, and no handler / script / unsafe
 * URL may survive in the DOM.
 */
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SanitizedBody } from './SanitizedBody'
import { BODY_ALLOWED_TAGS, INSIM_LINK_ATTR, sanitizeBodyHtml } from './sanitizeBody'

declare global {
  interface Window {
    __pwned?: number
  }
}

const PWN = 'window.__pwned=(window.__pwned||0)+1'

/** Stored-XSS payloads: classic, encoded, mutation (mXSS) and style-borne. */
const CORPUS: readonly string[] = [
  `<script>${PWN}</script>`,
  '<SCRIPT SRC=//evil.example/x.js></SCRIPT>',
  `<img src=x onerror="${PWN}">`,
  `<svg onload="${PWN}"><circle r=1></circle></svg>`,
  `<svg><script>${PWN}</script></svg>`,
  `<math><mtext><table><mglyph><style><img src=x onerror="${PWN}">`,
  `<a href="javascript:${PWN}">click</a>`,
  `<a href="JaVaScRiPt:${PWN}">click</a>`,
  `<a href="java&#x09;script:${PWN}">click</a>`,
  `<a href="&#106;avascript:${PWN}">click</a>`,
  '<a href="vbscript:msgbox(1)">click</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>',
  `<p onclick="${PWN}" onmouseover="${PWN}">hover</p>`,
  `<iframe src="javascript:${PWN}"></iframe>`,
  `<iframe srcdoc="<script>${PWN}</script>"></iframe>`,
  `<object data="javascript:${PWN}"></object>`,
  `<embed src="javascript:${PWN}">`,
  `<form action="javascript:${PWN}"><button>go</button></form>`,
  `<meta http-equiv="refresh" content="0;url=javascript:${PWN}">`,
  '<base href="javascript:/">',
  `<link rel="stylesheet" href="javascript:${PWN}">`,
  `<style>@import 'javascript:${PWN}';</style>`,
  `<p style="background:url(javascript:${PWN})">styled</p>`,
  `<div style="width:expression(${PWN})">ie</div>`,
  `<details open ontoggle="${PWN}">x</details>`,
  `<video><source onerror="${PWN}"></video>`,
  `<body onload="${PWN}">`,
  `<input autofocus onfocus="${PWN}">`,
  `<noscript><p title="</noscript><img src=x onerror=${PWN}>"></noscript>`,
  `<template><img src=x onerror="${PWN}"></template>`,
  `<pulse-post data-id="1" onclick="${PWN}"></pulse-post>`,
  `<a href="/news/x" onclick="${PWN}">in-sim</a>`,
]

beforeEach(() => {
  window.__pwned = 0
})

afterEach(() => {
  delete window.__pwned
})

describe('sanitizeBodyHtml: the payload corpus', () => {
  it.each(CORPUS)('%s is neutralised', async payload => {
    const clean = sanitizeBodyHtml(payload)
    expect(clean).not.toMatch(/<script/i)
    expect(clean).not.toMatch(/\son[a-z]+\s*=/i)
    expect(clean).not.toMatch(/javascript:|vbscript:|data:text/i)
    expect(clean).not.toMatch(
      /<(iframe|object|embed|form|meta|base|link|style|svg|math|img|video|input|template)\b/i,
    )
    expect(clean).not.toMatch(/\sstyle\s*=/i)

    const { container } = render(
      <MemoryRouter>
        <SanitizedBody bodyHtml={payload} />
      </MemoryRouter>,
    )
    // Let any queued handler (onerror / onload) have its chance to run.
    await new Promise(resolve => setTimeout(resolve, 20))
    for (const element of container.querySelectorAll('*')) {
      for (const attr of Array.from(element.attributes)) {
        expect(attr.name.startsWith('on')).toBe(false)
      }
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    }
    expect(window.__pwned).toBe(0)
  })
})

describe('sanitizeBodyHtml: what it keeps and adds', () => {
  it('keeps the rich-basic and rich-tables allowlist', () => {
    const html = '<h2>Head</h2><p><strong>b</strong> <em>i</em></p><ul><li>one</li></ul>'
      + '<blockquote>q</blockquote><table><caption>c</caption><thead><tr><th scope="col">h</th></tr></thead>'
      + '<tbody><tr><td colspan="2">d</td></tr></tbody></table>'
    expect(sanitizeBodyHtml(html)).toBe(html)
  })

  it('forces rel="noopener noreferrer" on every link, overriding an authored rel / target', () => {
    const clean = sanitizeBodyHtml('<a href="https://example.org" rel="opener" target="_self">x</a>')
    const link = new DOMParser().parseFromString(clean, 'text/html').querySelector('a')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link?.getAttribute('target')).toBe('_blank')
  })

  it('marks host-relative links as in-sim (client-routed, same tab)', () => {
    const doc = new DOMParser().parseFromString(
      sanitizeBodyHtml('<a href="/news/daily/flood" target="_blank">in</a><a href="//evil.example/x">out</a>'),
      'text/html',
    )
    const [inSim, protocolRelative] = Array.from(doc.querySelectorAll('a'))
    expect(inSim?.hasAttribute(INSIM_LINK_ATTR)).toBe(true)
    expect(inSim?.hasAttribute('target')).toBe(false)
    expect(protocolRelative?.hasAttribute(INSIM_LINK_ATTR)).toBe(false)
  })

  it('an author cannot forge the in-sim marker', () => {
    const forged = `<a href="https://evil.example" ${INSIM_LINK_ATTR}>x</a><p ${INSIM_LINK_ATTR}>p</p>`
    const clean = sanitizeBodyHtml(forged)
    expect(clean.match(new RegExp(INSIM_LINK_ATTR, 'g'))).toBeNull()
  })

  it('keeps <pulse-post data-id>, and data-id nowhere else', () => {
    const clean = sanitizeBodyHtml('<pulse-post data-id="post-7"></pulse-post><p data-id="x" data-other="y">p</p>')
    expect(clean).toBe('<pulse-post data-id="post-7"></pulse-post><p>p</p>')
  })

  it('drops body media (it must go through ContentMedia, which carries the bands)', () => {
    expect(BODY_ALLOWED_TAGS).not.toContain('img')
    expect(BODY_ALLOWED_TAGS).not.toContain('video')
    expect(sanitizeBodyHtml('<p>a<img src="/x.png" alt="x">b</p>')).toBe('<p>ab</p>')
  })
})

describe('sanitizeBodyHtml: link edge cases (cold review)', () => {
  const link = (html: string) =>
    new DOMParser().parseFromString(sanitizeBodyHtml(html), 'text/html').querySelector('a')

  it.each([
    '/\t/evil.example/x',
    '/\n/evil.example/x',
    '/\r\\evil.example/x',
  ])('%j is never classed in-sim (the browser would resolve it off-host)', href => {
    const a = link(`<a href="${href}">x</a>`)
    expect(a?.hasAttribute(INSIM_LINK_ATTR)).toBe(false)
    // Stored as the browser resolves it, so the classification matches what is followed.
    expect(a?.getAttribute('href')).not.toMatch(/[\t\n\r]/)
  })

  it('external http(s) links say they open in a new tab; mailto / tel do not open one', () => {
    const external = link('<a href="https://example.org">site</a>')
    expect(external?.getAttribute('target')).toBe('_blank')
    expect(external?.textContent).toBe('site (opens in new tab)')
    expect(external?.querySelector('[data-new-tab-note]')).not.toBeNull()
    for (const href of ['mailto:desk@example.org', 'tel:+15550100', '#section']) {
      const a = link(`<a href="${href}">x</a>`)
      expect(a?.hasAttribute('target')).toBe(false)
      expect(a?.textContent).toBe('x')
    }
  })

  it('an author cannot forge the new-tab note marker', () => {
    expect(sanitizeBodyHtml('<p><span data-new-tab-note>hidden</span></p>'))
      .toBe('<p><span>hidden</span></p>')
  })

  it('author text inside a <pulse-post> placeholder is dropped', () => {
    expect(sanitizeBodyHtml('<pulse-post data-id="p">spoof</pulse-post>'))
      .toBe('<pulse-post data-id="p"></pulse-post>')
  })
})

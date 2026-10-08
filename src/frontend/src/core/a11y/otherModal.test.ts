/**
 * core/a11y/otherModal.test.ts
 * ---------------------------------------------------------------------------
 * The "a focus trap yields to any other modal" predicate (demo-polish F2 H-1).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { isInsideOtherModal } from './otherModal'

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('isInsideOtherModal', () => {
  it('is false for a node inside the trap\'s own modal', () => {
    const host = mount('<div id="own" aria-modal="true"><button id="b">x</button></div>')
    const own = host.querySelector('#own') as Element
    expect(isInsideOtherModal(host.querySelector('#b'), own)).toBe(false)
    expect(isInsideOtherModal(own, own)).toBe(false)
  })

  it('is true for a node inside a DIFFERENT aria-modal element (however deep)', () => {
    const host = mount(`
      <div id="own" aria-modal="true"><button>a</button></div>
      <div id="other" aria-modal="true"><section><button id="deep">b</button></section></div>`)
    const own = host.querySelector('#own') as Element
    expect(isInsideOtherModal(host.querySelector('#other'), own)).toBe(true)
    expect(isInsideOtherModal(host.querySelector('#deep'), own)).toBe(true)
  })

  it('is false for a node outside every modal', () => {
    const host = mount('<div id="own" aria-modal="true"></div><button id="page">p</button>')
    expect(isInsideOtherModal(host.querySelector('#page'), host.querySelector('#own') as Element))
      .toBe(false)
  })

  it('ignores a non-modal dialog (aria-modal absent or "false")', () => {
    const host = mount(`
      <div id="own" aria-modal="true"></div>
      <div role="dialog"><button id="plain">p</button></div>
      <div role="dialog" aria-modal="false"><button id="no">n</button></div>`)
    const own = host.querySelector('#own') as Element
    expect(isInsideOtherModal(host.querySelector('#plain'), own)).toBe(false)
    expect(isInsideOtherModal(host.querySelector('#no'), own)).toBe(false)
  })

  it('handles null, the document and text nodes without throwing', () => {
    const host = mount('<div id="own" aria-modal="true"></div><div aria-modal="true">hello</div>')
    const own = host.querySelector('#own') as Element
    expect(isInsideOtherModal(null, own)).toBe(false)
    expect(isInsideOtherModal(document, own)).toBe(false)
    const text = host.lastElementChild?.firstChild ?? null
    expect(isInsideOtherModal(text, own)).toBe(true)
  })
})

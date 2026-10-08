/**
 * core/a11y/modalPriority.test.ts
 * ---------------------------------------------------------------------------
 * The one-way modal priority predicates (demo-polish F2 Gate-1 M-A): a channel trap
 * stands aside while another modal is mounted; the shell trap only backs off for
 * another SHELL layer.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { hasOtherModalMounted, isInsideOtherShellLayer } from './modalPriority'

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('hasOtherModalMounted', () => {
  it('is false when the trap\'s own modal is the only one', () => {
    const host = mount('<div id="own" aria-modal="true"><button>x</button></div><p>page</p>')
    expect(hasOtherModalMounted(host.querySelector('#own') as Element)).toBe(false)
  })

  it('is true when ANOTHER modal is mounted anywhere in the document', () => {
    const host = mount(`
      <div id="own" aria-modal="true"></div>
      <section><div aria-modal="true"></div></section>`)
    expect(hasOtherModalMounted(host.querySelector('#own') as Element)).toBe(true)
  })

  it('ignores a modal nested INSIDE the trap and a modal that HOSTS the trap', () => {
    const inner = mount('<div id="own" aria-modal="true"><div aria-modal="true"></div></div>')
    expect(hasOtherModalMounted(inner.querySelector('#own') as Element)).toBe(false)
    document.body.innerHTML = ''
    const outer = mount('<div aria-modal="true"><div id="own" aria-modal="true"></div></div>')
    expect(hasOtherModalMounted(outer.querySelector('#own') as Element)).toBe(false)
  })

  it('ignores non-modal dialogs (aria-modal absent or "false")', () => {
    const host = mount(`
      <div id="own" aria-modal="true"></div>
      <div role="dialog"></div>
      <div role="dialog" aria-modal="false"></div>`)
    expect(hasOtherModalMounted(host.querySelector('#own') as Element)).toBe(false)
  })
})

describe('isInsideOtherShellLayer', () => {
  it('is true for a node inside a DIFFERENT shell layer, however deep', () => {
    const host = mount(`
      <div id="own" data-shell-layer="overlay"></div>
      <div id="other" data-shell-layer="alert"><span><button id="deep">b</button></span></div>`)
    const own = host.querySelector('#own') as Element
    expect(isInsideOtherShellLayer(host.querySelector('#other'), own)).toBe(true)
    expect(isInsideOtherShellLayer(host.querySelector('#deep'), own)).toBe(true)
  })

  it('is false for a node inside the trap\'s own layer or in no shell layer at all', () => {
    const host = mount(`
      <div id="own" data-shell-layer="overlay"><button id="inside">i</button></div>
      <button id="page">p</button>`)
    const own = host.querySelector('#own') as Element
    expect(isInsideOtherShellLayer(host.querySelector('#inside'), own)).toBe(false)
    expect(isInsideOtherShellLayer(own, own)).toBe(false)
    expect(isInsideOtherShellLayer(host.querySelector('#page'), own)).toBe(false)
  })

  it('does NOT treat a channel aria-modal as a shell layer (the overlay always wins)', () => {
    const host = mount(`
      <div id="own" data-shell-layer="overlay"></div>
      <div role="dialog" aria-modal="true"><button id="viewer">v</button></div>`)
    const own = host.querySelector('#own') as Element
    expect(isInsideOtherShellLayer(host.querySelector('#viewer'), own)).toBe(false)
  })

  it('handles null, the document and text nodes without throwing', () => {
    const host = mount('<div id="own" data-shell-layer="overlay"></div><div data-shell-layer="x">hello</div>')
    const own = host.querySelector('#own') as Element
    expect(isInsideOtherShellLayer(null, own)).toBe(false)
    expect(isInsideOtherShellLayer(document, own)).toBe(false)
    expect(isInsideOtherShellLayer(host.lastElementChild?.firstChild ?? null, own)).toBe(true)
  })
})

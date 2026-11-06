/**
 * SanitizedBody: client-side in-sim routing and the embedded Pulse post render prop.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SanitizedBody } from './SanitizedBody'

function Where() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function renderBody(bodyHtml: string, renderEmbeddedPost?: (id: string) => React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/news/daily/start']}>
      <Routes>
        <Route
          path="*"
          element={(
            <>
              <SanitizedBody bodyHtml={bodyHtml} renderEmbeddedPost={renderEmbeddedPost} />
              <Where />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SanitizedBody: in-sim links', () => {
  it('a click on a host-relative link routes client-side', async () => {
    renderBody('<p>See <a href="/news/daily/flood-update">the update</a>.</p>')
    await userEvent.click(screen.getByRole('link', { name: 'the update' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/news/daily/flood-update')
  })

  it('Enter on a focused in-sim link routes too (keyboard-operable)', async () => {
    renderBody('<p><a href="/weather/desk/warning-1">warning</a></p>')
    const link = screen.getByRole('link', { name: 'warning' })
    link.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByTestId('location')).toHaveTextContent('/weather/desk/warning-1')
  })

  it('a modified click keeps the browser behaviour (not intercepted)', () => {
    renderBody('<p><a href="/news/daily/x">x</a></p>')
    const link = screen.getByRole('link', { name: 'x' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(screen.getByTestId('location')).toHaveTextContent('/news/daily/start')
  })

  it('an external link is not routed and opens in a new tab with noopener', () => {
    renderBody('<p><a href="https://example.org/a">ext</a></p>')
    const link = screen.getByRole('link', { name: /^ext.*opens in new tab/ })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(screen.getByTestId('location')).toHaveTextContent('/news/daily/start')
  })
})

describe('SanitizedBody: embedded Pulse posts', () => {
  it('fills each <pulse-post data-id> through the render prop, in place', () => {
    const renderPost = vi.fn((id: string) => <article data-testid={`embed-${id}`}>post {id}</article>)
    renderBody('<p>before</p><pulse-post data-id="p-1"></pulse-post><p>after</p><pulse-post data-id="p-2"></pulse-post>', renderPost)
    expect(renderPost).toHaveBeenCalledWith('p-1')
    expect(renderPost).toHaveBeenCalledWith('p-2')
    const first = screen.getByTestId('embed-p-1')
    expect(first.parentElement?.tagName.toLowerCase()).toBe('pulse-post')
    expect(first.parentElement?.previousElementSibling).toHaveTextContent('before')
    expect(screen.getByTestId('embed-p-2')).toBeInTheDocument()
  })

  it('without a render prop the placeholder stays empty', () => {
    const { container } = renderBody('<pulse-post data-id="p-1"></pulse-post>')
    expect(container.querySelector('pulse-post')).toBeEmptyDOMElement()
  })

  it('follows a body change to the new placeholders', () => {
    const renderPost = (id: string) => <span data-testid={`embed-${id}`}>{id}</span>
    const { rerender } = renderBody('<pulse-post data-id="a"></pulse-post>', renderPost)
    expect(screen.getByTestId('embed-a')).toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <SanitizedBody bodyHtml='<pulse-post data-id="b"></pulse-post>' renderEmbeddedPost={renderPost} />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('embed-a')).toBeNull()
    expect(screen.getByTestId('embed-b')).toBeInTheDocument()
  })
})

describe('SanitizedBody: tables', () => {
  it('wraps a table in a focusable, named scroll region and keeps it a table', () => {
    renderBody('<table><caption>Shelters</caption><tbody><tr><td>North High</td></tr></tbody></table>')
    const region = screen.getByRole('region', { name: 'Table: Shelters' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(region.contains(screen.getByRole('table'))).toBe(true)
  })
})

describe('SanitizedBody: nested table captions', () => {
  it('names the region from the table\'s OWN caption, not a nested table\'s', () => {
    renderBody('<table><tbody><tr><td><table><caption>Inner</caption><tbody><tr><td>x</td></tr></tbody></table></td></tr></tbody></table>')
    expect(screen.getByRole('region', { name: 'Table' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Table: Inner' })).toBeInTheDocument()
  })
})

describe('SanitizedBody: inline media placeholders (news 06)', () => {
  function renderMedia(
    bodyHtml: string,
    renderInlineMedia?: (id: string, caption: string | null) => React.ReactNode,
  ) {
    return render(
      <MemoryRouter>
        <SanitizedBody bodyHtml={bodyHtml} renderInlineMedia={renderInlineMedia} />
      </MemoryRouter>,
    )
  }

  it('swaps each figure[data-media-id] for a host filled by the render prop, with the author caption', () => {
    const renderMediaFn = vi.fn((id: string, caption: string | null) => (
      <figure data-testid={`media-${id}`}>{caption ?? 'no caption'}</figure>
    ))
    const { container } = renderMedia(
      '<p>a</p><figure data-media-id="m1"><figcaption> Crews at work </figcaption></figure>'
      + '<figure data-media-id="m2"></figure><p>b</p>',
      renderMediaFn,
    )
    expect(screen.getByTestId('media-m1')).toHaveTextContent('Crews at work')
    expect(screen.getByTestId('media-m2')).toHaveTextContent('no caption')
    // The placeholder figure is gone (no nested figure), and the hosts sit in body order.
    const body = screen.getByTestId('sanitized-body')
    expect(body.querySelectorAll(':scope > figure')).toHaveLength(0)
    const hosts = [...body.querySelectorAll('[data-media-host]')]
    expect(hosts.map(host => host.firstElementChild?.getAttribute('data-testid')))
      .toEqual(['media-m1', 'media-m2'])
    expect(hosts.every(host => host.parentElement === body)).toBe(true)
    expect(container.querySelector('figcaption')).toBeNull()
  })

  it('a render that returns nothing leaves an empty host (no broken image, no caption)', () => {
    renderMedia('<figure data-media-id="gone"><figcaption>orphan</figcaption></figure>', () => null)
    const host = screen.getByTestId('sanitized-body').querySelector('[data-media-host]')
    expect(host).not.toBeNull()
    expect(host?.childNodes).toHaveLength(0)
    expect(screen.queryByText('orphan')).toBeNull()
  })

  it('with no render prop the figure placeholder renders nothing', () => {
    renderMedia('<figure data-media-id="m1"><figcaption>cap</figcaption></figure>')
    expect(screen.queryByText('cap')).toBeNull()
  })

  it('a figure without data-media-id is left as authored', () => {
    renderMedia('<figure><figcaption>plain</figcaption></figure>', () => <span>x</span>)
    expect(screen.getByText('plain').closest('figure')).not.toBeNull()
  })

  it('a placeholder nested in another is never mounted into detached DOM', () => {
    const renderMediaFn = vi.fn((id: string) => <span data-testid={`media-${id}`}>{id}</span>)
    renderMedia(
      '<figure data-media-id="outer"><figure data-media-id="inner"></figure></figure>',
      renderMediaFn,
    )
    expect(renderMediaFn.mock.calls.map(([id]) => id)).toEqual(['outer'])
    expect(screen.getByTestId('media-outer').isConnected).toBe(true)
  })
})

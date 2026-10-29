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

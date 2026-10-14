/**
 * core/auth/ReconnectingState.test.tsx
 * ---------------------------------------------------------------------------
 * The "Reconnecting..." screen on its own (easy-login Gate-2 W-5): its copy per phase,
 * its controls, and the TWO-WORLDS rule that it stays neutral. `SessionProvider` mounts it
 * above both worlds, so it must import no MUI, no `@/theme/*` and no COBRA (a participant
 * route must never show COBRA), and no default MUI look. The provider-level behaviour is in
 * `session.reconnect.test.tsx`; the numbers (16 px, 44 px, contrast) in
 * `ReconnectingState.styles.test.ts`.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ReconnectingState } from './ReconnectingState'

function renderState(
  props: Partial<React.ComponentProps<typeof ReconnectingState>> = {},
) {
  const onRetry = vi.fn()
  const utils = render(
    <MemoryRouter>
      <ReconnectingState
        retrying={false}
        failedRetries={0}
        onRetry={onRetry}
        signInPath="/login"
        {...props}
      />
    </MemoryRouter>,
  )
  return { ...utils, onRetry }
}

describe('ReconnectingState — copy per phase', () => {
  it('first appearance: says the server could not be reached and the person is still signed in', () => {
    renderState()
    expect(screen.getByRole('heading', { level: 1, name: 'Reconnecting…' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      "Pulse couldn't be reached just now. You're still signed in, so there is no need to sign in again.",
    )
  })

  it('while a retry runs: says it is trying, with a spinner icon', () => {
    renderState({ retrying: true })
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Trying to reach Pulse…')
    expect(status.querySelector('svg[data-icon="circle-notch"]')).not.toBeNull()
  })

  it('after a failed retry: says it is still unreachable and still signed in', () => {
    renderState({ failedRetries: 2 })
    expect(screen.getByRole('status')).toHaveTextContent(/still can't reach pulse/i)
    expect(screen.getByRole('status')).toHaveTextContent(/still signed in/i)
  })

  it('pairs the idle state with an icon, never colour alone', () => {
    renderState()
    expect(screen.getByRole('status').querySelector('svg[data-icon="wifi"]')).not.toBeNull()
  })
})

describe('ReconnectingState — controls', () => {
  it('Try again calls onRetry', async () => {
    const user = userEvent.setup()
    const { onRetry } = renderState()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('Try again is inert (aria-disabled) while a retry runs, and stays focusable', async () => {
    const user = userEvent.setup()
    const { onRetry } = renderState({ retrying: true })
    const button = screen.getByRole('button', { name: 'Try again' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toBeEnabled()
    await user.click(button)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('Sign in again is a real link to the given path', () => {
    renderState({ signInPath: '/somewhere' })
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/somewhere')
  })

  it('focuses the status region when it first appears, so it is read out', () => {
    renderState()
    expect(screen.getByRole('status')).toHaveFocus()
  })
})

describe('ReconnectingState — two worlds (neutral: no MUI, no theme, no COBRA)', () => {
  const sources = import.meta.glob('./ReconnectingState.tsx', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
  const source = sources['./ReconnectingState.tsx'] ?? ''
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')

  function specifiers(text: string): string[] {
    return [
      ...text.matchAll(/import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g),
      ...text.matchAll(/import\s+['"]([^'"]+)['"]/g),
    ].map(match => match[1] ?? '')
  }

  it('scans the real file (cannot pass vacuously)', () => {
    expect(source).toContain('export function ReconnectingState')
    expect(specifiers(code)).toContain('react-router-dom')
  })

  it('imports no MUI, no @/theme, no COBRA', () => {
    for (const specifier of specifiers(code)) {
      expect(specifier).not.toMatch(/^@mui(\/|$)/)
      expect(specifier).not.toMatch(/^@\/theme(\/|$)/)
      expect(specifier).not.toMatch(/cobra/i)
      expect(specifier).not.toMatch(/styledComponents/)
    }
  })

  it('takes its icons from FontAwesome and its skin from its own CSS Module', () => {
    const imports = specifiers(code)
    expect(imports).toContain('@fortawesome/react-fontawesome')
    expect(imports).toContain('@fortawesome/free-solid-svg-icons')
    expect(imports).toContain('./ReconnectingState.module.css')
  })

  it('uses no sx prop and no raw HTML injection', () => {
    expect(code).not.toMatch(/\bsx=/)
    expect(code).not.toContain('dangerouslySetInnerHTML')
  })

  it('shows no time and logs nothing', () => {
    expect(code).not.toMatch(/\bconsole\s*\./)
    expect(code).not.toMatch(/\bDate\b|toLocale|Intl\./)
  })
})

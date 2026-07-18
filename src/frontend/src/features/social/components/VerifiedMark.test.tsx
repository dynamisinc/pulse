/**
 * features/social/components/VerifiedMark.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story 02's core trust-signal AC (SOC-002/SOC-052, D1-003, R-001):
 * the seal renders in the fixed seal-blue, independent of any ancestor's
 * `--pulse-ac` accent, and is announced accessibly as shape+color, not
 * color alone.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VerifiedMark } from './VerifiedMark'
import { SEAL_BLUE } from '../theme/tokens'

describe('VerifiedMark', () => {
  it('renders the seal in the fixed seal-blue color', () => {
    render(<VerifiedMark />)

    const mark = screen.getByTestId('verified-mark')
    const sealPath = mark.querySelector('path[fill]')

    expect(sealPath).toHaveAttribute('fill', SEAL_BLUE)
    expect(SEAL_BLUE).toBe('#2D9CDB')
  })

  it('is accessible as a shape+color seal, not a color-only signal (NFR-001)', () => {
    render(<VerifiedMark />)

    const mark = screen.getByRole('img', { name: 'Verified account' })
    expect(mark).toBeInTheDocument()
    expect(mark.querySelector('title')).toHaveTextContent('Verified account')
  })

  it('does NOT change color when an ancestor sets a different --pulse-ac accent', () => {
    render(
      <div style={{ ['--pulse-ac' as string]: '#DB3A54' }}>
        <VerifiedMark />
      </div>,
    )

    const mark = screen.getByTestId('verified-mark')
    const sealPath = mark.querySelector('path[fill]')

    // Fixed seal-blue, never the accent that just changed on the ancestor.
    expect(sealPath).toHaveAttribute('fill', SEAL_BLUE)
    expect(sealPath).not.toHaveAttribute('fill', '#DB3A54')
  })

  it('defaults to a 16px size and honors a custom size prop', () => {
    const { rerender } = render(<VerifiedMark />)
    let mark = screen.getByTestId('verified-mark')
    expect(mark).toHaveAttribute('width', '16')
    expect(mark).toHaveAttribute('height', '16')

    rerender(<VerifiedMark size={24} />)
    mark = screen.getByTestId('verified-mark')
    expect(mark).toHaveAttribute('width', '24')
    expect(mark).toHaveAttribute('height', '24')
  })
})

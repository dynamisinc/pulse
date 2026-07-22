/**
 * features/participant-shell/landingSelection.test.ts
 * ---------------------------------------------------------------------------
 * Story 04 (exercise-isolation) — coverage for the landing-selection
 * contract: `resolveLandingSelection` is a pure isReadOnly→selection mapping
 * (COR-015), and `useLandingSelection()` fails closed outside its provider
 * (mirrors `core/exerciseContext`'s / `mountContract`'s precedent).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import {
  LandingSelectionProvider,
  resolveLandingSelection,
  useLandingSelection,
} from './landingSelection'

function sessionWith(isReadOnly: boolean): Session {
  return {
    exerciseId: 'ex-mock-0001',
    accountId: 'acct-test',
    role: 'participant',
    personaId: 'persona-test',
    actingHumanId: 'human-test',
    isReadOnly,
    // A fixed far-future instant rather than `Date.now()`-derived — this file
    // lives under `features/participant-shell/**`, where COR-053's lint ban
    // forbids bare `new Date()`/`Date.now()` regardless of intent.
    expiresAt: '2999-01-01T00:00:00.000Z',
  }
}

describe('resolveLandingSelection (COR-015)', () => {
  it('resolves a read-only session to all-posts', () => {
    expect(resolveLandingSelection(sessionWith(true))).toBe('all-posts')
  })

  it('resolves an ordinary (non-read-only) session to following', () => {
    expect(resolveLandingSelection(sessionWith(false))).toBe('following')
  })
})

function Probe() {
  const selection = useLandingSelection()
  return <span data-testid="selection">{selection}</span>
}

describe('useLandingSelection outside a provider', () => {
  it('throws rather than returning a default selection', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/LandingSelectionProvider/)
    consoleSpy.mockRestore()
  })
})

describe('LandingSelectionProvider', () => {
  it('exposes the bound selection to descendants', () => {
    render(
      <LandingSelectionProvider value="all-posts">
        <Probe />
      </LandingSelectionProvider>,
    )
    expect(screen.getByTestId('selection')).toHaveTextContent('all-posts')
  })
})

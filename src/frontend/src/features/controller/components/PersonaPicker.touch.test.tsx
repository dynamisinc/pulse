/**
 * features/controller/components/PersonaPicker.touch.test.tsx
 * ---------------------------------------------------------------------------
 * Story 14 (D5-024): the persona picker (the palette's list) on a tablet. Rows are >= 44px under
 * `(pointer: coarse)`, a single tap selects (no hover, no key), the list is scrollable, and the
 * type chips and Pin buttons are 44px, chips 8px apart.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { PersonaPicker } from './PersonaPicker'
import { ActivePersonaProvider } from '../hooks/useActivePersona'
import type { StaffPersona } from '@/features/personas'
import { hasPseudoHitSlop, mediaRuleDeclarations } from '../consoleTouchTestUtils'

const FULTON: StaffPersona = {
  id: 'persona-fulton-em',
  exerciseId: 'ex-mock-0001',
  templateId: 'tmpl-fulton',
  kind: 'org',
  displayName: 'Fulton County EM',
  handle: 'FultonCountyEM',
  personaType: 'agency',
  verified: true,
  avatarColor: '#334455',
  initials: 'FC',
  audienceBand: 'micro',
  followerCount: 120,
  joinedAt: '2026-01-01T00:00:00.000Z',
}

function renderPicker(onSelect = vi.fn()) {
  render(
    <ThemeProvider theme={cobraTheme}>
      <ActivePersonaProvider>
        <PersonaPicker personas={[FULTON]} onSelect={onSelect} />
      </ActivePersonaProvider>
    </ThemeProvider>,
  )
  return onSelect
}

describe('PersonaPicker — touch (story 14)', () => {
  it('a row is >= 44px tall under a coarse pointer and ONE tap selects it', async () => {
    const onSelect = renderPicker()
    const row = screen.getByTestId('persona-picker-option-persona-fulton-em')
    expect(mediaRuleDeclarations(row, 'pointer: coarse')['min-height']).toBe('44px')
    await userEvent.setup().click(row)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('the list scrolls and is capped in height', () => {
    renderPicker()
    const list = screen.getByRole('listbox')
    expect(getComputedStyle(list).overflowY).toBe('auto')
    expect(getComputedStyle(list).maxHeight).toBe('360px')
  })

  it('Pin and the type chips are 44px with no hit-slop; chips are 8px apart', () => {
    renderPicker()
    for (const el of [
      screen.getByTestId('persona-picker-pin-persona-fulton-em'),
      screen.getByTestId('persona-picker-type-filter-all-types'),
    ]) {
      const coarse = mediaRuleDeclarations(el, 'pointer: coarse')
      expect(coarse['min-width']).toBe('44px')
      expect(coarse['min-height']).toBe('44px')
      expect(hasPseudoHitSlop(el)).toBe(false)
    }
    const chips = screen.getByTestId('persona-picker-type-filters')
    expect(mediaRuleDeclarations(chips, 'pointer: coarse').gap).toBe('8px')
  })
})

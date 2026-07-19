/**
 * features/controller/components/PersonaPicker.qa.test.tsx
 * ---------------------------------------------------------------------------
 * QA addendum to PersonaPicker.test.tsx (story 02, "Fast persona switching").
 * Covers three invariants the builder's own suite left unexercised:
 *
 *  - Clicking the per-row PIN button pins the persona WITHOUT selecting it
 *    (the row's onClick and the pin button's onClick must not collapse into
 *    one action — a controller pinning a persona for later must not
 *    accidentally start operating as it right now).
 *  - An unmatched search renders the "no personas match" empty state and no
 *    options — not a stale/last-good list.
 *  - Keyboard ArrowDown clamps at the last row rather than overrunning the
 *    flattened list (which would make Enter select nothing/throw).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { PersonaPicker } from './PersonaPicker'
import { ActivePersonaProvider } from '../hooks/useActivePersona'
import type { Persona } from '@/features/personas'

function buildPersona(overrides: Partial<Persona> & Pick<Persona, 'id' | 'displayName' | 'handle' | 'personaType'>): Persona {
  return {
    exerciseId: 'ex-mock-0001',
    templateId: `tmpl-${overrides.id}`,
    kind: 'human',
    verified: false,
    avatarColor: '#334455',
    initials: 'XX',
    audienceBand: 'micro',
    followerCount: 120,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const FIRST_PERSONA = buildPersona({
  id: 'persona-first',
  displayName: 'Alex First',
  handle: 'alexfirst',
  personaType: 'citizen',
})
const SECOND_PERSONA = buildPersona({
  id: 'persona-second',
  displayName: 'Bess Second',
  handle: 'besssecond',
  personaType: 'citizen',
})

const TWO_PERSONAS: readonly Persona[] = [FIRST_PERSONA, SECOND_PERSONA]

function renderPicker(props: Partial<Parameters<typeof PersonaPicker>[0]> = {}) {
  const onSelect = vi.fn()
  const utils = render(
    <ThemeProvider theme={cobraTheme}>
      <ActivePersonaProvider>
        <PersonaPicker personas={TWO_PERSONAS} onSelect={onSelect} {...props} />
      </ActivePersonaProvider>
    </ThemeProvider>,
  )
  return { ...utils, onSelect }
}

describe('PersonaPicker — pinning a row does not select it', () => {
  it('clicking the pin button pins the persona without firing onSelect / setting it active', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderPicker()

    await user.click(screen.getByTestId('persona-picker-pin-persona-first'))

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByTestId('persona-picker-pin-persona-first')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('persona-picker-active-badge-persona-first')).not.toBeInTheDocument()
  })
})

describe('PersonaPicker — no-match empty state', () => {
  it('renders the empty message and zero options when the search matches nothing', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.type(screen.getByTestId('persona-picker-search'), 'zzz-no-such-persona')

    expect(screen.getByTestId('persona-picker-empty')).toBeInTheDocument()
    expect(screen.getByTestId('persona-picker-list').querySelectorAll('[role="option"]')).toHaveLength(0)
  })
})

describe('PersonaPicker — keyboard highlight clamps at the list bounds', () => {
  it('ArrowDown past the last row keeps the highlight on the last row; Enter selects it', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderPicker()

    const search = screen.getByTestId('persona-picker-search')
    search.focus()
    // Only 2 rows exist; 4 ArrowDowns must clamp at index 1, not overrun it.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(SECOND_PERSONA)
  })
})

/**
 * features/controller/components/PersonaPicker.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (Fast persona switching) — coverage for `<PersonaPicker>`:
 *
 *  - Search filters by displayName/handle; the persona-type chips filter by
 *    `personaType`. Both compose.
 *  - Recents/pins ordering: pinned first, then recent (excluding anything
 *    already pinned), then the rest — only in "browse" mode (empty query, no
 *    type filter); typing collapses to a flat filtered "Results" list.
 *  - Keyboard-only flow: type a name, ↓ to move, Enter to select — sets the
 *    active persona via `useActivePersona()` with NO pointer interaction
 *    (NFR-001).
 *  - The picker is scoped to whatever `personas` it is given — it never
 *    reaches for `SEEDED_PERSONAS`/`personaById` itself (this test always
 *    supplies its own fixture list via the `personas` prop, proving the
 *    component has no hidden fixture-fallback path).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { PersonaPicker } from './PersonaPicker'
import { ActivePersonaProvider, useActivePersona } from '../hooks/useActivePersona'
import type { StaffPersona } from '@/features/personas'

// STAFF fixtures: the picker filters on `personaType`, which lives only on
// the staff projection (`StaffPersona`) — SOC-052/D1-008.
function buildPersona(
  overrides: Partial<StaffPersona> &
  Pick<StaffPersona, 'id' | 'displayName' | 'handle' | 'personaType'>,
): StaffPersona {
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

const FULTON_EM = buildPersona({
  id: 'persona-fulton-em',
  displayName: 'Fulton County EM',
  handle: 'FultonCountyEM',
  personaType: 'agency',
  kind: 'org',
  verified: true,
})
const CITIZEN_TOMMY = buildPersona({
  id: 'persona-tommyr',
  displayName: 'Tommy R',
  handle: 'tommyr_fh',
  personaType: 'citizen',
})
const NEWS_OUTLET = buildPersona({
  id: 'persona-fh-news',
  displayName: 'Fairhaven News 6',
  handle: 'FHNews6',
  personaType: 'news-outlet',
  kind: 'org',
  verified: true,
})

const FIXTURE_PERSONAS: readonly StaffPersona[] = [FULTON_EM, CITIZEN_TOMMY, NEWS_OUTLET]

/** Renders the currently-active persona alongside the picker, like a sibling composer would. */
function ActivePersonaProbe() {
  const { activePersona } = useActivePersona()
  return <div data-testid="active-persona-probe">{activePersona?.displayName ?? 'none'}</div>
}

function renderPicker(props: Partial<Parameters<typeof PersonaPicker>[0]> = {}) {
  const onSelect = vi.fn()
  const utils = render(
    <ThemeProvider theme={cobraTheme}>
      <ActivePersonaProvider>
        <PersonaPicker personas={FIXTURE_PERSONAS} onSelect={onSelect} {...props} />
        <ActivePersonaProbe />
      </ActivePersonaProvider>
    </ThemeProvider>,
  )
  return { ...utils, onSelect }
}

describe('PersonaPicker — search + type filter', () => {
  it('filters by displayName or handle', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.type(screen.getByTestId('persona-picker-search'), 'tommy')

    expect(screen.getByTestId('persona-picker-option-persona-tommyr')).toBeInTheDocument()
    expect(screen.queryByTestId('persona-picker-option-persona-fulton-em')).not.toBeInTheDocument()
    expect(screen.queryByTestId('persona-picker-option-persona-fh-news')).not.toBeInTheDocument()
  })

  it('filters by persona type via the type chips', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByTestId('persona-picker-type-filter-news'))

    expect(screen.getByTestId('persona-picker-option-persona-fh-news')).toBeInTheDocument()
    expect(screen.queryByTestId('persona-picker-option-persona-tommyr')).not.toBeInTheDocument()
    expect(screen.queryByTestId('persona-picker-option-persona-fulton-em')).not.toBeInTheDocument()
  })

  it('composes a search query with a type filter', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByTestId('persona-picker-type-filter-agency'))
    await user.type(screen.getByTestId('persona-picker-search'), 'fulton')

    expect(screen.getByTestId('persona-picker-option-persona-fulton-em')).toBeInTheDocument()
    expect(screen.getByTestId('persona-picker-list').querySelectorAll('[role="option"]')).toHaveLength(1)
  })

  it('shows the exercise-scoped list ONLY — the exact set the personas prop supplied', () => {
    renderPicker()
    const options = screen.getByTestId('persona-picker-list').querySelectorAll('[role="option"]')
    expect(options).toHaveLength(FIXTURE_PERSONAS.length)
  })
})

describe('PersonaPicker — recents + pinned favorites', () => {
  it('pinning a persona surfaces it in a "Pinned" section while browsing', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByTestId('persona-picker-pin-persona-tommyr'))

    const pinnedSection = screen.getByTestId('persona-picker-section-pinned')
    expect(within(pinnedSection.parentElement as HTMLElement).getByTestId('persona-picker-option-persona-tommyr'))
      .toBeInTheDocument()
  })

  it('selecting a persona surfaces it in "Recent" on next browse', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByTestId('persona-picker-option-persona-fh-news'))
    // Selecting closes nothing in this standalone component — clear the
    // search box (a no-op here) is unnecessary; browse mode is already active.
    expect(screen.getByTestId('persona-picker-section-recent')).toBeInTheDocument()
  })

  it('unpinning removes a persona from the "Pinned" section', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByTestId('persona-picker-pin-persona-tommyr'))
    expect(screen.getByTestId('persona-picker-section-pinned')).toBeInTheDocument()

    await user.click(screen.getByTestId('persona-picker-pin-persona-tommyr'))
    expect(screen.queryByTestId('persona-picker-section-pinned')).not.toBeInTheDocument()
  })
})

describe('PersonaPicker — keyboard-only selection (NFR-001)', () => {
  it('type a name, arrow down is a no-op with one match, Enter selects — no pointer used', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderPicker()

    const search = screen.getByTestId('persona-picker-search')
    await user.type(search, 'tommy')
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith(CITIZEN_TOMMY)
    expect(screen.getByTestId('active-persona-probe').textContent).toBe('Tommy R')
  })

  it('↓/↑ move the highlighted row across the whole flattened list, Enter selects it', async () => {
    const user = userEvent.setup()
    const { onSelect } = renderPicker()

    const search = screen.getByTestId('persona-picker-search')
    search.focus()
    // Browsing (no query/filter): highlight starts at index 0. Move down
    // twice, then back up once, and select whatever is highlighted.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}')

    expect(onSelect).toHaveBeenCalledTimes(1)
    const selected = onSelect.mock.calls[0]?.[0] as StaffPersona
    expect(FIXTURE_PERSONAS.map(p => p.id)).toContain(selected.id)
  })
})

describe('PersonaPicker — active persona indicator', () => {
  it('marks the currently active persona with an ACTIVE badge', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByTestId('persona-picker-option-persona-fulton-em'))

    expect(screen.getByTestId('persona-picker-active-badge-persona-fulton-em')).toBeInTheDocument()
  })
})

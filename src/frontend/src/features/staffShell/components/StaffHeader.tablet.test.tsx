/**
 * features/staffShell/components/StaffHeader.tablet.test.tsx
 * ---------------------------------------------------------------------------
 * Story 13 (mobile-tablet, staff shell at tablet sizes; D5-021, TABLET-AMENDMENT §3/§4/§6) — the
 * staff header at 768, 820, 1024 and 1180 wide, and its desktop twin at 1280.
 *
 * The header's bands are chosen by WIDTH ONLY (a `matchMedia` stub, see `tabletTestUtils`); the
 * 44px touch sizing is a separate CSS contract gated on `(pointer: coarse)`.
 *
 *  - Exercise identity, the scenario clock, the state pill (dot + text) and `UNCLASSIFIED // FOUO`
 *    are present at EVERY tablet width and never move into the menu.
 *  - Tablet: the wall clock, presence avatars and "Preview as participant" move into the header
 *    "more" popover (present there, absent from the row); the menu is keyboard-operable (Escape
 *    closes and returns focus to the trigger).
 *  - Portrait (768, 820): the pill and the tag stack in one status cell; sign-out is icon-only but
 *    keeps its accessible name. Landscape (1024, 1180): pill and tag stay in the row, sign-out
 *    keeps its text.
 *  - 1280 and up renders the unchanged desktop header (no "more" menu).
 *  - Preview state is never color-only when the toggle is in the menu: the trigger says PREVIEW.
 *  - Preview toggle hands focus to the "more" button before the menu unmounts, so exiting preview
 *    returns focus to a control that still exists.
 *  - Touch: header controls get min-height 44 under `(pointer: coarse)` only.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StaffHeader, STAFF_CLASSIFICATION } from './StaffHeader'
import type { StaffPresenceMember } from '../staffHeaderMocks'
import { mediaRuleDeclarations, setViewport } from '../tabletTestUtils'
import { STAFF_TOUCH_TARGET_PX } from '../staffShellTokens'
import type { StatePillConfig } from './statePillConfig'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-staff-header-tablet',
    exerciseName: 'Bay Shield 2026',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

vi.mock('@/core/auth', () => ({ endSession: vi.fn() }))

// The badge name is the INTERNAL name from the staff assignments (story 09), not the scope's.
vi.mock('@/features/staff/services/staffAssignmentsService', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/features/staff/services/staffAssignmentsService')>()
  return {
    ...actual,
    getStaffAssignments: () =>
      Promise.resolve([
        {
          exerciseId: 'ex-test-staff-header-tablet',
          exerciseName: 'Bay Shield 2026',
          role: 'controller',
          personId: 'p-1',
          isLead: false,
        },
      ]),
  }
})

const ROSTER: readonly StaffPresenceMember[] = [
  { id: 'a', initials: 'AB', label: 'Test member A', color: '#276749' },
  { id: 'b', initials: 'CD', label: 'Test member B', color: '#5b3f86' },
]

vi.mock('../staffHeaderMocks', async importOriginal => {
  const actual = await importOriginal<typeof import('../staffHeaderMocks')>()
  return { ...actual, useStaffPresence: () => ROSTER }
})

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

function renderHeader(
  width: number,
  props: Partial<React.ComponentProps<typeof StaffHeader>> = {},
  opts: { coarse?: boolean } = {},
) {
  restore = setViewport(width, opts)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StaffHeader surfaceName="Controller Console" onTogglePreview={() => undefined} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const PAUSED: StatePillConfig = {
  label: 'INJECTS PAUSED',
  background: '#222',
  accentColor: '#fff',
  borderColor: '#999',
}

describe.each([768, 820, 1024, 1180])('StaffHeader at %ipx (tablet)', width => {
  it('keeps identity, scenario clock, state pill (dot + text) and the classification tag in the row', async () => {
    renderHeader(width, { stateOverride: PAUSED })
    const header = screen.getByTestId('staff-header')
    expect(within(header).getByTestId('staff-header-identity-badge')).toBeInTheDocument()
    expect(await within(header).findByText('Bay Shield 2026')).toBeInTheDocument()
    expect(within(header).getByTestId('staff-header-scenario-clock')).toBeInTheDocument()
    const pill = within(header).getByTestId('staff-header-state-pill')
    expect(within(pill).getByTestId('staff-header-state-pill-dot')).toBeInTheDocument()
    expect(within(pill).getByTestId('staff-header-state-pill-label')).toHaveTextContent('INJECTS PAUSED')
    expect(within(header).getByTestId('staff-header-classification-tag')).toHaveTextContent(
      STAFF_CLASSIFICATION,
    )
  })

  it('moves the wall clock, presence avatars and preview toggle into the "more" menu', async () => {
    const user = userEvent.setup()
    renderHeader(width)
    // Not in the row...
    expect(screen.queryByTestId('staff-header-wall-clock')).not.toBeInTheDocument()
    expect(screen.queryByTestId('staff-header-presence')).not.toBeInTheDocument()
    expect(screen.queryByTestId('staff-header-preview-toggle')).not.toBeInTheDocument()

    // ...but one tap away, with text (not hover-only) naming each person.
    await user.click(screen.getByTestId('staff-header-more'))
    const menu = screen.getByTestId('staff-header-more-menu')
    expect(within(menu).getByTestId('staff-header-wall-clock')).toBeInTheDocument()
    expect(within(menu).getByRole('group', { name: 'Staff presence' })).toBeInTheDocument()
    expect(within(menu).getByText('Test member A', { selector: 'li' })).toBeInTheDocument()
    expect(within(menu).getByTestId('staff-header-preview-toggle')).toHaveTextContent(
      'Preview as participant',
    )
  })

  it('keeps sign-out reachable by name; the "more" menu closes on Escape and returns focus', async () => {
    const user = userEvent.setup()
    renderHeader(width)
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()

    const more = screen.getByTestId('staff-header-more')
    expect(more).toHaveAccessibleName('More header options')
    await user.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('staff-header-more-menu')).not.toBeInTheDocument()
    expect(more).toHaveFocus()
  })

  it('adds no extra controls on a surface with no preview capability (handler-gated)', async () => {
    const user = userEvent.setup()
    renderHeader(width, { onTogglePreview: undefined })
    await user.click(screen.getByTestId('staff-header-more'))
    expect(screen.queryByTestId('staff-header-preview-toggle')).not.toBeInTheDocument()
  })
})

describe('StaffHeader tablet bands', () => {
  it('portrait (768, 820) stacks the pill and tag in one cell and shows sign-out icon-only', () => {
    renderHeader(768)
    const header = screen.getByTestId('staff-header')
    expect(header).toHaveAttribute('data-header-band', 'tablet-portrait')
    const group = screen.getByTestId('staff-header-status-group')
    expect(within(group).getByTestId('staff-header-state-pill')).toBeInTheDocument()
    expect(within(group).getByTestId('staff-header-classification-tag')).toBeInTheDocument()
    const signOut = screen.getByTestId('staff-header-sign-out')
    expect(signOut).toHaveAccessibleName('Sign out')
    expect(signOut).not.toHaveTextContent('Sign out')
  })

  it('landscape (1024, 1180) keeps pill and tag in the row and sign-out with its text', () => {
    renderHeader(1024)
    expect(screen.getByTestId('staff-header')).toHaveAttribute('data-header-band', 'tablet-landscape')
    expect(screen.queryByTestId('staff-header-status-group')).not.toBeInTheDocument()
    expect(screen.getByTestId('staff-header-sign-out')).toHaveTextContent('Sign out')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('1280 and up is the unchanged desktop header (no "more" menu, everything inline)', () => {
    renderHeader(1280)
    expect(screen.queryByTestId('staff-header-more')).not.toBeInTheDocument()
    expect(screen.getByTestId('staff-header-wall-clock')).toBeInTheDocument()
    expect(screen.getByTestId('staff-header-presence')).toBeInTheDocument()
    expect(screen.getByTestId('staff-header-preview-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('staff-header-sign-out')).toHaveTextContent('Sign out')
  })
})

describe('StaffHeader tablet — preview state is never colour-only', () => {
  it('the trigger carries the word PREVIEW and a preview-aware accessible name while on', () => {
    renderHeader(768, { previewActive: true })
    const more = screen.getByTestId('staff-header-more')
    expect(more).toHaveTextContent('PREVIEW')
    expect(more).toHaveAccessibleName('More header options — preview is on')
  })

  it('toggling preview from the menu closes it and moves focus to the surviving "more" button', async () => {
    const user = userEvent.setup()
    const onTogglePreview = vi.fn()
    renderHeader(768, { onTogglePreview })
    await user.click(screen.getByTestId('staff-header-more'))
    await user.click(screen.getByTestId('staff-header-preview-toggle'))
    expect(onTogglePreview).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('staff-header-more')).toHaveFocus()
  })
})

describe('StaffHeader tablet — touch targets (CSS contract, pointer-gated)', () => {
  it('every interactive header control gets min-height 44 inside @media (pointer: coarse)', () => {
    renderHeader(1024, {}, { coarse: true })
    for (const id of [
      'staff-header-more',
      'staff-header-sign-out',
      'staff-header-lockup',
      'staff-header-identity-badge',
    ]) {
      const el = screen.queryByTestId(id)
      // The lockup and badge are static text (not controls) in a single-surface/-exercise
      // session; only their interactive forms (a <button>) carry the touch size.
      if (!el || el.tagName !== 'BUTTON') continue
      const coarse = mediaRuleDeclarations(el, 'pointer: coarse')
      expect(coarse['min-height'], id).toBe(`${STAFF_TOUCH_TARGET_PX}px`)
    }
  })

  it('the more and icon-only sign-out buttons are also 44 wide under a coarse pointer', () => {
    renderHeader(768, {}, { coarse: true })
    for (const id of ['staff-header-more', 'staff-header-sign-out']) {
      const coarse = mediaRuleDeclarations(screen.getByTestId(id), 'pointer: coarse')
      expect(coarse['min-width'], id).toBe(`${STAFF_TOUCH_TARGET_PX}px`)
    }
  })
})

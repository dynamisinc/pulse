/**
 * features/staffShell/components/PortalStub.test.tsx
 * ---------------------------------------------------------------------------
 * Story 04 (Preview as participant) — coverage for the participant-world
 * stub `PreviewAsParticipant` stages:
 *
 *  - Reads its mount props via the REAL `useShellContext()` (never a
 *    hand-rolled prop), so a `'preview'` variant is observable end-to-end
 *    through `data-shell-variant` (AC1/AC4).
 *  - Renders the moment's mock headline/dek/kicker as ordinary text.
 *  - The alert banner appears for every non-`'none'` severity (paired icon +
 *    text label, NFR-001) and is absent for `'none'`.
 *  - READ-ONLY (AC4, COR-015): no `<button>`, `<input>`, `<textarea>`, or
 *    `<a href>` renders anywhere in the stub — affordances are absent, not
 *    merely disabled.
 *  - Formats its dateline from the MOUNT-SUPPLIED `scenarioNow`, not the
 *    system clock (COR-053) — pinned via a distinct fixed instant.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShellContextProvider, type ShellMountProps } from '@/features/participant-shell/mountContract'
import { useExerciseContext } from '@/core/exerciseContext'
import { getPreviewMomentConfig } from '../previewContext'
import { PortalStub } from './PortalStub'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

function mockExerciseScope() {
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-test-preview-0001',
    exerciseName: 'Coastal Surge (Mock Exercise)',
    timeZone: 'UTC',
    status: 'active',
  })
}

function renderStub(variant: ShellMountProps['variant'] = 'preview', scenarioNow = new Date('2031-06-15T18:00:00.000Z')) {
  mockExerciseScope()
  return render(
    <ShellContextProvider value={{ variant, scenarioNow }}>
      <PortalStub momentConfig={getPreviewMomentConfig('advisory')} />
    </ShellContextProvider>,
  )
}

describe('PortalStub — mounts under the real participant-shell mount contract (AC1/AC4)', () => {
  it('exposes the "preview" variant it was mounted with via useShellContext(), not an invented prop', () => {
    renderStub('preview')
    expect(screen.getByTestId('portal-stub')).toHaveAttribute('data-shell-variant', 'preview')
  })

  it('a different mounted variant is reflected too — proves this reads the REAL context, not a hardcoded "preview" string', () => {
    renderStub('readOnly')
    expect(screen.getByTestId('portal-stub')).toHaveAttribute('data-shell-variant', 'readOnly')
  })
})

describe('PortalStub — renders the moment\'s mock content as plain text (never dangerouslySetInnerHTML)', () => {
  it('renders the headline and dek for the given moment config', () => {
    renderStub()
    const advisory = getPreviewMomentConfig('advisory')

    expect(screen.getByText(advisory.headline)).toBeInTheDocument()
    expect(screen.getByText(advisory.dek)).toBeInTheDocument()
  })
})

describe('PortalStub — mock alert banner (paired icon + text, NFR-001)', () => {
  it('renders the severity label + message for a non-"none" moment (advisory)', () => {
    mockExerciseScope()
    render(
      <ShellContextProvider value={{ variant: 'preview', scenarioNow: new Date('2031-06-15T18:00:00.000Z') }}>
        <PortalStub momentConfig={getPreviewMomentConfig('advisory')} />
      </ShellContextProvider>,
    )

    const banner = screen.getByTestId('portal-stub-alert')
    expect(banner).toHaveTextContent('ADVISORY')
    expect(banner).toHaveTextContent(getPreviewMomentConfig('advisory').alertMessage ?? '')
  })

  it('renders no alert banner at all for the "startex" (none) moment', () => {
    mockExerciseScope()
    render(
      <ShellContextProvider value={{ variant: 'preview', scenarioNow: new Date('2031-06-15T18:00:00.000Z') }}>
        <PortalStub momentConfig={getPreviewMomentConfig('startex')} />
      </ShellContextProvider>,
    )

    expect(screen.queryByTestId('portal-stub-alert')).not.toBeInTheDocument()
  })
})

describe('PortalStub — READ-ONLY: no post/act affordance anywhere (AC4, COR-015)', () => {
  it('renders no <button>, no <input>/<textarea>, and no <a href> — absent, not disabled', () => {
    renderStub()

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(document.querySelector('input')).toBeNull()
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.querySelector('a[href]')).toBeNull()
    // Also guard against a disabled-but-present affordance (COR-015 requires
    // ABSENT, not merely disabled) — there must be no disabled control either.
    expect(document.querySelector('[disabled]')).toBeNull()
  })
})

describe('PortalStub — scenario time, never wall-clock (COR-053)', () => {
  it('formats its dateline from the mount-supplied scenarioNow, not Date.now()', () => {
    mockExerciseScope()
    const farFutureInstant = new Date('2099-01-01T00:00:00.000Z')

    render(
      <ShellContextProvider value={{ variant: 'preview', scenarioNow: farFutureInstant }}>
        <PortalStub momentConfig={getPreviewMomentConfig('now')} />
      </ShellContextProvider>,
    )

    // The dateline is rendered in the masthead strip — assert the far-future
    // year appears, proving it was derived from the injected instant, not
    // the real system clock (which is nowhere near 2099).
    expect(screen.getByText(/2099/)).toBeInTheDocument()
  })
})

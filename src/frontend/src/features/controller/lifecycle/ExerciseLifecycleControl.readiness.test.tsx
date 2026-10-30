/**
 * features/controller/lifecycle/ExerciseLifecycleControl.readiness.test.tsx
 * ---------------------------------------------------------------------------
 * exercise-build-golive story 04: the INFORMATIONAL readiness summary beside Start. Mock-data
 * lifecycle (a staged scope) with the readiness service mocked. The summary is words + icon and
 * never gates Start.
 */
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getReadiness, type ExerciseReadiness } from '@/features/planner/services/readinessService'
import { renderControl, resetLifecycleMock, scopeResolved } from './lifecycle.testUtils'

vi.mock('@/core/auth/sessionResolver', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/sessionResolver')>()),
  resolveSession: (await import('./lifecycle.sessionKit.testUtils')).resolveSession,
}))
vi.mock('@/features/planner/services/readinessService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/planner/services/readinessService')>()),
  getReadiness: vi.fn(),
}))

const mockReadiness = vi.mocked(getReadiness)
const item = (id: string, status: 'ok' | 'open') => ({ id, label: id, status, detail: null })

const base = { lifecycleState: 'staged', warnings: [] }
const ALL_DONE: ExerciseReadiness = { ...base, ready: true, blocking: [item('a', 'ok')] }
const TWO_OPEN: ExerciseReadiness = {
  ...base,
  ready: false,
  blocking: [item('a', 'open'), item('b', 'open')],
}

beforeEach(() => mockReadiness.mockReset())
afterEach(() => resetLifecycleMock())

describe('ExerciseLifecycleControl readiness summary', () => {
  it('says all blocking items are done when ready', async () => {
    mockReadiness.mockResolvedValue(ALL_DONE)
    renderControl({ status: 'staged', withHeader: true })
    await scopeResolved()
    expect(await screen.findByTestId('lifecycle-readiness')).toHaveTextContent(
      'Readiness: all blocking items done',
    )
  })

  it('names open blocking items in words and keeps Start enabled', async () => {
    mockReadiness.mockResolvedValue(TWO_OPEN)
    renderControl({ status: 'staged', withHeader: true })
    await scopeResolved()
    expect(await screen.findByTestId('lifecycle-readiness')).toHaveTextContent(
      'Readiness: 2 blocking items open — starting is still allowed',
    )
    const start = screen.getByRole('button', { name: /start exercise/i })
    expect(start).not.toBeDisabled()
    expect(start).toHaveAttribute('aria-disabled', 'false')
  })

  it('is not shown, and readiness is not requested, when the exercise is live', async () => {
    renderControl({ status: 'live', withHeader: true })
    await scopeResolved()
    expect(screen.queryByTestId('lifecycle-readiness')).not.toBeInTheDocument()
    expect(mockReadiness).not.toHaveBeenCalled()
  })
})

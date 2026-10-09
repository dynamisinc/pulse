/**
 * features/controller/runSheet/RunSheetPanel.exerciseSwitch.test.tsx
 * ---------------------------------------------------------------------------
 * AC "Persisted per exercise": "switching exercise shows only that exercise's sheet (no
 * cross-exercise bleed)". The console does NOT remount when the exercise switches (the
 * scope is re-resolved in place), so this test changes the scope under a MOUNTED panel and
 * checks that the panel shows only the new exercise's beats - at no point a mix - and that
 * an edit made in one exercise never lands in the other.
 *
 * `@/core/exerciseContext` is mocked so the test controls the scope; the rest (personas,
 * media library, the store, `localStorage`) is real.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { postStore } from '@/features/social/services/postStore'

const world = vi.hoisted(() => ({
  scope: { exerciseId: 'ex-mock-0001', exerciseName: 'A', timeZone: 'America/New_York', status: 'live' },
}))
vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => world.scope,
}))

import { RunSheetPanel } from './RunSheetPanel'
import { readStoredSheet, runSheetStorageKey } from './runSheetStorage'
import { runtimeOf, type RunSheetData } from './runSheetModel'
import {
  beatFixture,
  resetRunSheetWorld,
  seedStoredSheet,
  sheetFixture,
  useFixedClock,
} from './runSheetTestKit'

function testQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function scopeFor(exerciseId: string) {
  return { exerciseId, exerciseName: exerciseId, timeZone: 'America/New_York', status: 'live' }
}

function tree() {
  return (
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={testQueryClient()}>
        <RunSheetPanel />
      </QueryClientProvider>
    </ThemeProvider>
  )
}

const sheetA = (): RunSheetData => sheetFixture([
  beatFixture({ id: 'a1', order: 1, title: 'A one' }),
  beatFixture({ id: 'a2', order: 2, title: 'A two' }),
], {}, 'Sheet A')
const sheetB = (): RunSheetData => sheetFixture([
  beatFixture({ id: 'b1', order: 1, title: 'B one' }),
], {
  b1: { status: 'fired', firedPostId: 'post-b', firedAtScenario: '2033-09-04T14:00:00.000Z' },
}, 'Sheet B')

function stored(exerciseId: string): RunSheetData {
  const read = readStoredSheet(exerciseId)
  if (read.kind !== 'ok') throw new Error(`expected a stored sheet for ${exerciseId}`)
  return read.data
}

// Full-panel renders (MUI + emotion + the exercise context) are slow on a loaded CI box:
// give each test a generous budget instead of the 10s default.
vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  resetRunSheetWorld()
  useFixedClock()
  postStore.resetForTests()
  world.scope = scopeFor('ex-mock-0001')
})
afterEach(() => {
  cleanup()
  resetRunSheetWorld()
  postStore.resetForTests()
})

describe('RunSheetPanel - switching exercise', () => {
  it('shows only the current exercise\'s sheet, with its own name and status, in both directions', async () => {
    seedStoredSheet('ex-mock-0001', sheetA())
    seedStoredSheet('ex-b', sheetB())
    const { rerender } = render(tree())
    await screen.findByTestId('beat-row-a1')
    expect(screen.getByLabelText('Sheet name')).toHaveValue('Sheet A')
    expect(screen.queryByTestId('beat-row-b1')).toBeNull()

    world.scope = scopeFor('ex-b')
    rerender(tree())
    await screen.findByTestId('beat-row-b1')
    expect(screen.getByLabelText('Sheet name')).toHaveValue('Sheet B')
    expect(screen.queryByTestId('beat-row-a1')).toBeNull()
    expect(screen.queryByTestId('beat-row-a2')).toBeNull()
    expect(within(screen.getByTestId('beat-row-b1')).getByTestId('beat-status')).toHaveTextContent('Fired')

    world.scope = scopeFor('ex-mock-0001')
    rerender(tree())
    await screen.findByTestId('beat-row-a1')
    expect(screen.queryByTestId('beat-row-b1')).toBeNull()
    expect(within(screen.getByTestId('beat-row-a1')).getByTestId('beat-status')).toHaveTextContent('Pending')
  })

  it('shows an empty sheet for an exercise that has none, never another exercise\'s', async () => {
    seedStoredSheet('ex-mock-0001', sheetA())
    const { rerender } = render(tree())
    await screen.findByTestId('beat-row-a1')
    world.scope = scopeFor('ex-c')
    rerender(tree())
    await screen.findByTestId('run-sheet-empty')
    expect(screen.queryByTestId('beat-row-a1')).toBeNull()
    expect(window.localStorage.getItem(runSheetStorageKey('ex-c'))).toBeNull()
  })

  it('writes an edit only to the exercise it was made in', async () => {
    seedStoredSheet('ex-mock-0001', sheetA())
    const user = userEvent.setup({ delay: null })
    const { rerender } = render(tree())
    await screen.findByTestId('beat-row-a1')
    await waitFor(() => expect(screen.getByTestId('run-sheet-panel')).toHaveAttribute('data-personas', 'ready'))

    await user.click(screen.getByTestId('beat-row-a1'))
    await user.keyboard('f')
    await waitFor(() => expect(runtimeOf(stored('ex-mock-0001'), 'a1').status).toBe('fired'))

    world.scope = scopeFor('ex-b')
    rerender(tree())
    await screen.findByTestId('run-sheet-empty')
    await user.click(screen.getByRole('button', { name: 'Add beat' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Title/), 'Only in B')
    await user.selectOptions(within(dialog).getByLabelText(/^Persona/), 'FulcoEM')
    await user.type(within(dialog).getByLabelText('Text'), 'B text')
    await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))
    await waitFor(() => expect(stored('ex-b').beats.map(b => b.title)).toEqual(['Only in B']))

    expect(stored('ex-mock-0001').beats.map(b => b.title)).toEqual(['A one', 'A two'])
    expect(runtimeOf(stored('ex-mock-0001'), 'a1').status).toBe('fired')
    expect(stored('ex-b').runtime).toEqual({})
  })

  it('closes an open editor when the exercise changes (no edit lands in the wrong sheet)', async () => {
    seedStoredSheet('ex-mock-0001', sheetA())
    const user = userEvent.setup({ delay: null })
    const { rerender } = render(tree())
    await screen.findByTestId('beat-row-a1')
    await user.click(screen.getByRole('button', { name: 'Add beat' }))
    await screen.findByRole('dialog', { name: 'New beat' })

    world.scope = scopeFor('ex-b')
    rerender(tree())
    await screen.findByTestId('run-sheet-empty')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

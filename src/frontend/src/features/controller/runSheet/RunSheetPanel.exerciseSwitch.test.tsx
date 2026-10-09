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
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { postStore } from '@/features/social/services/postStore'

// A REACTIVE stand-in for the exercise context. The real one is a React context, so a scope
// change re-renders every consumer - including the memoized, prop-less `RunSheetPanel` (a
// console re-render alone must not re-render it, Gate-2 A L-1). A plain function reading a
// variable would never wake that memo component, so changes go through `setScope` and a
// `useSyncExternalStore` subscription, exactly like the provider.
interface Scope {
  exerciseId: string
  exerciseName: string
  timeZone: string
  status: string
}
interface World {
  scope: Scope
  listeners: Set<() => void>
  setScope(next: Scope): void
}
const world = vi.hoisted((): World => {
  const state: World = {
    scope: { exerciseId: 'ex-mock-0001', exerciseName: 'A', timeZone: 'America/New_York', status: 'live' },
    listeners: new Set<() => void>(),
    setScope(next) {
      state.scope = next
      for (const listener of [...state.listeners]) listener()
    },
  }
  return state
})
vi.mock('@/core/exerciseContext', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (listener: () => void) => {
    world.listeners.add(listener)
    return () => {
      world.listeners.delete(listener)
    }
  }
  return { useExerciseContext: () => useSyncExternalStore(subscribe, () => world.scope) }
})

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
  world.setScope(scopeFor('ex-mock-0001'))
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
    render(tree())
    await screen.findByTestId('beat-row-a1')
    expect(screen.getByLabelText('Sheet name')).toHaveValue('Sheet A')
    expect(screen.queryByTestId('beat-row-b1')).toBeNull()

    act(() => world.setScope(scopeFor('ex-b')))
    await screen.findByTestId('beat-row-b1')
    expect(screen.getByLabelText('Sheet name')).toHaveValue('Sheet B')
    expect(screen.queryByTestId('beat-row-a1')).toBeNull()
    expect(screen.queryByTestId('beat-row-a2')).toBeNull()
    expect(within(screen.getByTestId('beat-row-b1')).getByTestId('beat-status')).toHaveTextContent('Fired')

    act(() => world.setScope(scopeFor('ex-mock-0001')))
    await screen.findByTestId('beat-row-a1')
    expect(screen.queryByTestId('beat-row-b1')).toBeNull()
    expect(within(screen.getByTestId('beat-row-a1')).getByTestId('beat-status')).toHaveTextContent('Pending')
  })

  it('shows an empty sheet for an exercise that has none, never another exercise\'s', async () => {
    seedStoredSheet('ex-mock-0001', sheetA())
    render(tree())
    await screen.findByTestId('beat-row-a1')
    act(() => world.setScope(scopeFor('ex-c')))
    await screen.findByTestId('run-sheet-empty')
    expect(screen.queryByTestId('beat-row-a1')).toBeNull()
    expect(window.localStorage.getItem(runSheetStorageKey('ex-c'))).toBeNull()
  })

  it('writes an edit only to the exercise it was made in', async () => {
    seedStoredSheet('ex-mock-0001', sheetA())
    const user = userEvent.setup({ delay: null })
    render(tree())
    await screen.findByTestId('beat-row-a1')
    await waitFor(() => expect(screen.getByTestId('run-sheet-panel')).toHaveAttribute('data-personas', 'ready'))

    await user.click(screen.getByTestId('beat-row-a1'))
    await user.keyboard('f')
    await waitFor(() => expect(runtimeOf(stored('ex-mock-0001'), 'a1').status).toBe('fired'))

    act(() => world.setScope(scopeFor('ex-b')))
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
    render(tree())
    await screen.findByTestId('beat-row-a1')
    await user.click(screen.getByRole('button', { name: 'Add beat' }))
    await screen.findByRole('dialog', { name: 'New beat' })

    act(() => world.setScope(scopeFor('ex-b')))
    await screen.findByTestId('run-sheet-empty')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

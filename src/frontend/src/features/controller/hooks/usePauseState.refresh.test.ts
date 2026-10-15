/**
 * features/controller/hooks/usePauseState.refresh.test.ts
 * ---------------------------------------------------------------------------
 * `refreshPauseTierFromServer` (demo-feedback story 11, Gate-1 L-B): the silent server adopt a
 * read-only console polls. Entering the server's `engine` tier stops the local engine; LEAVING it
 * (to a tier weaker than `freeze`) puts back the position the engine tier displaced, or `live`
 * when this runtime never saw one, and clears the remembered position. `freeze` keeps the engine
 * stopped. Live path only (the mock flag is off); the GET is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { engineControlStore } from '../engine/hooks/useEngineControl'
import { fetchPauseTier, type PauseTierServerState } from '../services/livePauseTierActions'
import { refreshPauseTierFromServer, resetPauseStateForTest } from './usePauseState'

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('../services/livePauseTierActions', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/livePauseTierActions')>()),
  fetchPauseTier: vi.fn(),
}))

const EXERCISE = 'ex-refresh-1'
const mockedFetch = vi.mocked(fetchPauseTier)

function serverSays(tier: PauseTierServerState['tier']): void {
  mockedFetch.mockResolvedValueOnce({ tier, clockFrozen: tier === 'freeze' })
}

const engineMode = () => engineControlStore.getSnapshot(EXERCISE).mode

beforeEach(() => {
  resetPauseStateForTest()
  engineControlStore.resetForTests()
  mockedFetch.mockReset()
})

afterEach(() => {
  resetPauseStateForTest()
  engineControlStore.resetForTests()
})

describe('refreshPauseTierFromServer: leaving the engine tier (story 11 L-B)', () => {
  it('stops the engine when the server enters the engine tier, and restores it when it leaves', async () => {
    engineControlStore.adoptServerMode(EXERCISE, 'suggest-only')

    serverSays('engine')
    await refreshPauseTierFromServer(EXERCISE)
    expect(engineMode()).toBe('stop')

    serverSays('running')
    await refreshPauseTierFromServer(EXERCISE)
    expect(engineMode()).toBe('suggest-only')
  })

  it('restores live when the console never saw the displaced position (opened mid-pause)', async () => {
    serverSays('engine')
    await refreshPauseTierFromServer(EXERCISE)
    expect(engineMode()).toBe('stop')

    serverSays('injects')
    await refreshPauseTierFromServer(EXERCISE)
    expect(engineMode()).toBe('live')
  })

  it('clears the remembered position, so a later engine tier remembers afresh', async () => {
    engineControlStore.adoptServerMode(EXERCISE, 'suggest-only')
    serverSays('engine')
    await refreshPauseTierFromServer(EXERCISE)
    serverSays('running')
    await refreshPauseTierFromServer(EXERCISE)
    expect(engineMode()).toBe('suggest-only')

    // The controllers move the engine to live, then pause it again and resume.
    engineControlStore.adoptServerMode(EXERCISE, 'live')
    serverSays('engine')
    await refreshPauseTierFromServer(EXERCISE)
    serverSays('running')
    await refreshPauseTierFromServer(EXERCISE)
    expect(engineMode()).toBe('live')
  })

  it('keeps the engine stopped when the server goes from engine to freeze', async () => {
    serverSays('engine')
    await refreshPauseTierFromServer(EXERCISE)
    serverSays('freeze')
    await refreshPauseTierFromServer(EXERCISE)
    expect(engineMode()).toBe('stop')

    // ...and the debt carries to the eventual resume.
    serverSays('running')
    await refreshPauseTierFromServer(EXERCISE)
    expect(engineMode()).toBe('live')
  })

  it('leaves the engine alone on a change that never involved the engine tier', async () => {
    engineControlStore.adoptServerMode(EXERCISE, 'suggest-only')
    serverSays('injects')
    await refreshPauseTierFromServer(EXERCISE)
    serverSays('running')
    await refreshPauseTierFromServer(EXERCISE)
    expect(engineMode()).toBe('suggest-only')
  })
})

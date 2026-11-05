/**
 * features/participant-shell/components/AlertBar/liveAlertsTestUtils.ts
 * ---------------------------------------------------------------------------
 * Test-only helpers for the LIVE alert path (channels-foundation story 11): a
 * fake shared `RealtimeConnection` that tests drive by hand, plus alert
 * builders. The `vi.mock` calls stay in each test file (they are hoisted per
 * file); this module only supplies what they return.
 */
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HubConnectionState } from '@microsoft/signalr'
import type {
  RealtimeConnection,
  RealtimeEventHandler,
  RealtimeStateListener,
  RealtimeStateReason,
} from '@/core/realtime/connection'
import type { Alert } from './alertTypes'

export interface FakeConnection extends RealtimeConnection {
  state: HubConnectionState
  readonly startCalls: () => number
  /** Delivers a hub frame to every handler subscribed to `eventName`. */
  emit(eventName: string, payload: unknown): void
  /** Moves the connection to `state` and tells every listener. */
  transition(state: HubConnectionState, reason?: RealtimeStateReason): void
  /** How many handlers are subscribed to `eventName`. */
  handlerCount(eventName: string): number
  reset(): void
}

export function createFakeConnection(): FakeConnection {
  const handlers = new Map<string, Set<RealtimeEventHandler>>()
  const listeners = new Set<RealtimeStateListener>()
  let starts = 0
  const fake: FakeConnection = {
    state: HubConnectionState.Disconnected,
    startCalls: () => starts,
    subscribe(eventName, handler) {
      const set = handlers.get(eventName) ?? new Set<RealtimeEventHandler>()
      set.add(handler)
      handlers.set(eventName, set)
      return () => {
        set.delete(handler)
      }
    },
    onStateChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start() {
      starts += 1
      return Promise.resolve()
    },
    stop() {
      return Promise.resolve()
    },
    emit(eventName, payload) {
      for (const handler of handlers.get(eventName) ?? []) handler(payload)
    },
    transition(state, reason) {
      fake.state = state
      for (const listener of listeners) listener(state, reason)
    },
    handlerCount(eventName) {
      return handlers.get(eventName)?.size ?? 0
    },
    reset() {
      handlers.clear()
      listeners.clear()
      starts = 0
      fake.state = HubConnectionState.Disconnected
    },
  }
  return fake
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

export function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

let sequence = 0

/** A wire-shaped alert (the FC-3 superset keys included). */
type WireAlertOverrides = Partial<Alert> & { expiresScenarioTime?: string | null }

export function wireAlert(overrides: WireAlertOverrides = {}) {
  sequence += 1
  return {
    id: `alert-${sequence}`,
    severity: 'info' as Alert['severity'],
    message: `Alert message ${sequence}.`,
    scenarioTime: '2026-12-02T14:00:00Z',
    href: null,
    sourceChannel: null,
    contentId: null,
    expiresScenarioTime: null,
    ...overrides,
  }
}

/** An axios-shaped resolved response for a mocked `api.get`. */
export function ok<T>(data: T) {
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} }
}

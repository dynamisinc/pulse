import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'
import axios, { type AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'

// ---------------------------------------------------------------------------
// Neutralize the telemetry mock-sink's fire-and-forget `/telemetry` POST in the
// jsdom test environment (TEST-ONLY — this file is never bundled into a real build).
//
// `core/telemetry/mockSink.ts` `emitTelemetryEvent()` does a best-effort
// `void api.post('/telemetry', event).catch(() => noteTelemetryDrop('send', …))`.
// Most tests don't mock `/telemetry`, so under jsdom that POST hits the real xhr
// adapter, network-errors, and REJECTS on a LATER tick — frequently after the
// emitting test has already finished. The `.catch` then `console.warn`s the drop
// (mockSink logs when `import.meta.env.DEV`, which is true under Vitest). When
// that async log lands as a Vitest worker is tearing down, the worker's
// `onUserConsoleLog` RPC is mid-close and throws
// `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`
// — an unhandled rejection that fails the job non-zero even when every test
// passed. It is suite-wide (any telemetry-emitting test can trigger it) and
// intermittent, so per-test `vi.mock('@/core/services/api')` is whack-a-mole.
//
// Fix it once, at the transport: give the shared axios instance a default adapter
// that RESOLVES `/telemetry` (204) so the fire-and-forget POST never rejects and
// nothing is logged during teardown. Every other request is delegated to the
// real adapter (behavior unchanged), and a per-request `adapter` (e.g. the
// feedService / personaService mock adapters) still overrides this default. Tests
// that mock `@/core/services/api` wholesale (e.g. `core/telemetry/mockSink.test.ts`)
// bypass this instance entirely and are unaffected. Production code is untouched.
const realAdapter: AxiosAdapter = axios.getAdapter(api.defaults.adapter)
api.defaults.adapter = config =>
  config.url === '/telemetry'
    ? Promise.resolve({
      data: undefined,
      status: 204,
      statusText: 'No Content',
      headers: new axios.AxiosHeaders(),
      config,
    })
    : realAdapter(config)

// ---------------------------------------------------------------------------
// Align RTL's async window with Vitest's test timeout (TEST-ONLY).
//
// `vite.config.ts` sets `testTimeout: 10000`, but that governs the TEST; React
// Testing Library's `waitFor`/`findBy*` window is `asyncUtilTimeout`, which is a
// SEPARATE knob defaulting to 1000ms. Nothing configured it, so the two were 10x
// apart: a test was allowed 10s overall while every `findBy*` inside it gave up
// after 1s.
//
// Under a full parallel run that 1s window is what gives. Symptom (issue #391):
// a rotating set of RTL files — each awaiting the full provider stack plus
// asynchronously-resolved mock data — fails one at a time, every one passing in
// isolation, sometimes alongside PARTIAL COLLECTION (176 of 197 files) as workers
// time out. Five distinct files were observed failing across consecutive runs
// while gating one branch, none of them touched by it.
//
// That is worse than flaky: when the suite reports failures AND silently collects
// fewer files, neither green nor red is trustworthy, and a real regression can be
// waved away as "the known flake". Vitest's `isolate: true`/forks defaults rule
// out singleton bleed, so this is contention, not shared state.
//
// Fixed centrally rather than per-file, and deliberately NOT with
// `--no-file-parallelism` — that hides the race instead of removing it, and this
// repo rejected it once already for that reason (PR #312, which fixed the same
// class with `findBy` + a raised timeout).
configure({ asyncUtilTimeout: 5000 })

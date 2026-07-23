import '@testing-library/jest-dom'
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

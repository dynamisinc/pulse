/**
 * core/config/zodConfig.test.ts
 * ---------------------------------------------------------------------------
 * Channels-foundation story 23: zod runs jitless, so its `new Function` probe never
 * trips the host CSP's `script-src` (no `'unsafe-eval'`). The telemetry schema, the app's
 * zod consumer, must pull the setting in itself.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

describe('zodConfig', () => {
  it('is in force once the telemetry schema module has loaded', async () => {
    await import('@/core/telemetry/schema')

    expect(z.config().jitless).toBe(true)
  })
})

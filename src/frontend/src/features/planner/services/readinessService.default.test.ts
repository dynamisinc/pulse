/**
 * features/planner/services/readinessService.default.test.ts
 * ---------------------------------------------------------------------------
 * The SHIPPED mock path of the readiness seam (real axios client + canned
 * adapter). Story 09: `participant-name` is now a REAL blocking check, so the
 * mock reports it ok/open rather than `notChecked`.
 */
import { describe, expect, it } from 'vitest'
import { getReadiness } from './readinessService'

describe('getReadiness (default mock adapter)', () => {
  it('reports participant-name as a real blocking item (open), not notChecked', async () => {
    const readiness = await getReadiness()

    const item = readiness.blocking.find(entry => entry.id === 'participant-name')
    expect(item).toBeDefined()
    expect(['ok', 'open']).toContain(item?.status)
  })
})

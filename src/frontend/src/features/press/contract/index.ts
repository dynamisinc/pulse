/**
 * features/press/contract — PC-5 `contract/` barrel (press-room story 01,
 * #738): PC-1 vocabulary, PC-1 / PC-2 wire types and their runtime guards, and
 * the telemetry shapes. The forbidden-key walk is the portal's
 * (`@/features/portal/contract`), re-exported so conformance tests import it here.
 */

export * from './vocabulary'
export * from './types'
export * from './guards'
export * from './telemetry'
export { isForbiddenKey } from '@/features/portal/contract'

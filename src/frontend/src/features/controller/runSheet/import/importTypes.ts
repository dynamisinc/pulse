/**
 * features/controller/runSheet/import/importTypes.ts
 * ---------------------------------------------------------------------------
 * The FROZEN wire contract of the MSEL import (demo-feedback story 03, backend
 * `Features/Injects/Import/InjectImportDtos.cs`), copied from
 * `docs/features/demo-feedback/implementation.md` § Frozen wire contract -> Types
 * ("03: MSEL import"). Do not add, rename or re-type a field here without the
 * orchestrator amending that section: the live service parses the wire against it.
 *
 *   POST /api/injects/import?dryRun=true|false   (multipart field `file`)
 *     200 InjectImportResultDto   (the same report for a dry run and a real import)
 *     400 ProblemDetails `detail` (a refused upload; nothing written; also a missing dryRun)
 *     409 ProblemDetails `detail` (the run sheet kept changing under the import)
 *
 * STAFF world only (XC-002): the report names personas and run-sheet titles.
 * `parseImportResult` is the fail-closed guard: a 2xx whose body is not this shape
 * is rejected rather than rendered.
 */

export type InjectImportRowStatus = 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed'

export interface InjectImportRowDto {
  rowNumber: number
  injectNumber?: string
  title?: string
  personaHandle?: string
  plannedMinute?: number
  status: InjectImportRowStatus
  /** Reason for skipped / failed; warnings or what changed for the rest. */
  message?: string
}

export interface InjectImportResultDto {
  dryRun: boolean
  totalRows: number
  socialRows: number
  createdCount: number
  updatedCount: number
  unchangedCount: number
  skippedCount: number
  failedCount: number
  rows: InjectImportRowDto[]
}

export const IMPORT_ROW_STATUSES: readonly InjectImportRowStatus[] = [
  'created',
  'updated',
  'unchanged',
  'skipped',
  'failed',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const optionalString = (value: unknown): boolean =>
  value === undefined || value === null || typeof value === 'string'

function parseRow(value: unknown): InjectImportRowDto | undefined {
  if (!isRecord(value)) return undefined
  const { rowNumber, injectNumber, title, personaHandle, plannedMinute, status, message } = value
  if (!isCount(rowNumber)) return undefined
  if (typeof status !== 'string' || !IMPORT_ROW_STATUSES.includes(status as InjectImportRowStatus)) {
    return undefined
  }
  if (![injectNumber, title, personaHandle, message].every(optionalString)) return undefined
  if (plannedMinute !== undefined && plannedMinute !== null && typeof plannedMinute !== 'number') return undefined

  const row: InjectImportRowDto = { rowNumber, status: status as InjectImportRowStatus }
  if (typeof injectNumber === 'string') row.injectNumber = injectNumber
  if (typeof title === 'string') row.title = title
  if (typeof personaHandle === 'string') row.personaHandle = personaHandle
  if (typeof plannedMinute === 'number') row.plannedMinute = plannedMinute
  if (typeof message === 'string') row.message = message
  return row
}

/** The body -> the report, or `undefined` when it is not the contract (fail closed). */
export function parseImportResult(data: unknown): InjectImportResultDto | undefined {
  if (!isRecord(data)) return undefined
  const counts = [
    data.totalRows,
    data.socialRows,
    data.createdCount,
    data.updatedCount,
    data.unchangedCount,
    data.skippedCount,
    data.failedCount,
  ]
  if (typeof data.dryRun !== 'boolean' || !counts.every(isCount) || !Array.isArray(data.rows)) {
    return undefined
  }
  const rows: InjectImportRowDto[] = []
  for (const raw of data.rows) {
    const row = parseRow(raw)
    if (!row) return undefined
    rows.push(row)
  }
  return {
    dryRun: data.dryRun,
    totalRows: data.totalRows as number,
    socialRows: data.socialRows as number,
    createdCount: data.createdCount as number,
    updatedCount: data.updatedCount as number,
    unchangedCount: data.unchangedCount as number,
    skippedCount: data.skippedCount as number,
    failedCount: data.failedCount as number,
    rows,
  }
}

/**
 * features/controller/runSheet/import/importReport.ts
 * ---------------------------------------------------------------------------
 * Pure helpers for the import dialog (demo-feedback story 10). No UI, no I/O, so the
 * rules the ACs pin are unit-tested on their own:
 *
 *   - `validateImportFile`  the fast client check BEFORE upload (the server re-checks):
 *                           `.xlsx` or `.csv`, not empty, at most 2 MiB (story 03's limit).
 *   - `splitReportRows`     failed rows FIRST, then the other non-skipped rows in file order;
 *                           skipped rows apart (the dialog collapses them).
 *   - `importableCount`     N in "Import N items" = rows that would create or update an item.
 *   - `countLines`          the five counts, worded for a preview ("To create") or a result
 *                           ("Created").
 *   - `statusLabel`         a row's status as words (never colour alone, NFR-001).
 */

import type { InjectImportResultDto, InjectImportRowDto, InjectImportRowStatus } from './importTypes'

/** Story 03's file limit (`MselLimits.MaxFileBytes`). */
export const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024

/** The picker's `accept`: Excel workbooks and CSV (by extension and MIME type). */
export const IMPORT_ACCEPT =
  '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'

/** The one-line hint under the picker (AC wording). */
export const IMPORT_HINT = 'A Cadence MSEL export works as-is; only social-media rows are imported.'

/** Why `file` cannot be sent, or `null` when it can. */
export function validateImportFile(file: Pick<File, 'name' | 'size'>): string | null {
  const name = file.name.toLowerCase()
  if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) {
    return 'Choose an Excel workbook (.xlsx) or a CSV file (.csv).'
  }
  if (file.size === 0) return 'The file is empty.'
  if (file.size > IMPORT_MAX_FILE_BYTES) return 'The file is larger than 2 MB. Split it, or remove rows that are not needed.'
  return null
}

/** "12 KB" / "1.4 MB" for the chosen-file line. */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export interface SplitRows {
  /** Failed rows first, then created / updated / unchanged, each group in file order. */
  readonly listed: readonly InjectImportRowDto[]
  /** Skipped (not social media) rows, in file order. */
  readonly skipped: readonly InjectImportRowDto[]
}

const byRow = (a: InjectImportRowDto, b: InjectImportRowDto): number => a.rowNumber - b.rowNumber

export function splitReportRows(rows: readonly InjectImportRowDto[]): SplitRows {
  const failed = rows.filter(row => row.status === 'failed').sort(byRow)
  const rest = rows.filter(row => row.status !== 'failed' && row.status !== 'skipped').sort(byRow)
  const skipped = rows.filter(row => row.status === 'skipped').sort(byRow)
  return { listed: [...failed, ...rest], skipped }
}

/** How many run-sheet items an import would write (create + update). */
export function importableCount(result: Pick<InjectImportResultDto, 'createdCount' | 'updatedCount'>): number {
  return result.createdCount + result.updatedCount
}

export interface CountLine {
  readonly key: InjectImportRowStatus
  readonly label: string
  readonly value: number
}

/** The five counts, in the AC's order: create, update, unchanged, skipped, failed. */
export function countLines(result: InjectImportResultDto): CountLine[] {
  const preview = result.dryRun
  return [
    { key: 'created', label: preview ? 'To create' : 'Created', value: result.createdCount },
    { key: 'updated', label: preview ? 'To update' : 'Updated', value: result.updatedCount },
    { key: 'unchanged', label: 'Unchanged', value: result.unchangedCount },
    { key: 'skipped', label: 'Skipped', value: result.skippedCount },
    { key: 'failed', label: 'Failed', value: result.failedCount },
  ]
}

/** A row's status in words; a preview says what WOULD happen. */
export function statusLabel(status: InjectImportRowStatus, dryRun: boolean): string {
  switch (status) {
    case 'created':
      return dryRun ? 'Will create' : 'Created'
    case 'updated':
      return dryRun ? 'Will update' : 'Updated'
    case 'unchanged':
      return 'Unchanged'
    case 'skipped':
      return 'Skipped'
    case 'failed':
      return dryRun ? 'Will fail' : 'Failed'
  }
}

/** "N items" / "1 item". */
export function itemsWord(count: number): string {
  return `${count} item${count === 1 ? '' : 's'}`
}

/** "N rows skipped (not social media)" — the collapsed group's summary (AC wording). */
export function skippedSummary(count: number): string {
  return `${count} row${count === 1 ? '' : 's'} skipped (not social media)`
}

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

/**
 * Secondary text inside the (light) COBRA dialog. NOT `text.secondary`: COBRA's #848482 is
 * ~3.7:1 on white, under the 4.5:1 AA floor (theme fix tracked in #461). `primary.dark`
 * (#696969, dim gray) is a COBRA token at ~5.5:1 on white and ~4.9:1 on the `grid.light`
 * table header.
 */
export const IMPORT_MUTED_TEXT = 'primary.dark'

/** The one-line hint under the picker (AC wording). */
export const IMPORT_HINT = 'A Cadence MSEL export works as-is; only social-media rows are imported.'

/** The `.xlsx` MIME type (Office Open XML workbook). */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * The content type an import file is SENT with, from its extension, never the browser's guess:
 * Windows with Office installed reports a `.csv` as `application/vnd.ms-excel`, which the
 * server reads as a claim to be a workbook and refuses (`MselFileFormat.ClaimsWorkbook`).
 * Anything else keeps what the browser said (the client check refuses it anyway).
 */
export function normalisedImportType(name: string, browserType: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.csv')) return 'text/csv'
  if (lower.endsWith('.xlsx')) return XLSX_MIME
  return browserType
}

/** Reads a Blob's bytes (`arrayBuffer`, with a `FileReader` fallback for older runtimes). */
function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result)
      else reject(new Error('Could not read the file'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Snapshots the picked file IN MEMORY at pick time, with the normalised content type. Preview
 * and Import then post exactly these bytes: a file the controller re-saves in Excel between the
 * two steps can neither change what is imported nor fail the upload (Chrome's
 * ERR_UPLOAD_FILE_CHANGED on a disk-backed File).
 */
export async function snapshotImportFile(picked: File): Promise<File> {
  const bytes = await readBytes(picked)
  return new File([bytes], picked.name, {
    type: normalisedImportType(picked.name, picked.type),
    lastModified: picked.lastModified,
  })
}

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

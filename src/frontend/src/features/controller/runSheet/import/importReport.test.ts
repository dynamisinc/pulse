/**
 * features/controller/runSheet/import/importReport.test.ts
 * ---------------------------------------------------------------------------
 * The import dialog's pure rules (demo-feedback story 10): the client file check, failed rows
 * first with skipped rows apart, N in "Import N items", and the count / status wording.
 */
import { describe, expect, it } from 'vitest'
import {
  countLines,
  IMPORT_MAX_FILE_BYTES,
  importableCount,
  itemsWord,
  normalisedImportType,
  skippedSummary,
  snapshotImportFile,
  splitReportRows,
  statusLabel,
  validateImportFile,
  XLSX_MIME,
} from './importReport'
import type { InjectImportResultDto, InjectImportRowDto } from './importTypes'

const row = (rowNumber: number, status: InjectImportRowDto['status']): InjectImportRowDto => ({ rowNumber, status })

describe('validateImportFile', () => {
  it('accepts .xlsx and .csv (any case) within 2 MiB', () => {
    expect(validateImportFile({ name: 'kestrel-msel.xlsx', size: 1000 })).toBeNull()
    expect(validateImportFile({ name: 'MSEL.CSV', size: IMPORT_MAX_FILE_BYTES })).toBeNull()
  })

  it('refuses other types, empty files and files over 2 MiB', () => {
    expect(validateImportFile({ name: 'msel.xls', size: 10 })).toMatch(/\.xlsx.*\.csv/)
    expect(validateImportFile({ name: 'notes.txt', size: 10 })).toMatch(/\.xlsx/)
    expect(validateImportFile({ name: 'msel.csv', size: 0 })).toBe('The file is empty.')
    expect(validateImportFile({ name: 'msel.xlsx', size: IMPORT_MAX_FILE_BYTES + 1 })).toMatch(/2 MB/)
  })
})

describe('splitReportRows', () => {
  it('lists failed rows first, then the rest in file order, and keeps skipped rows apart', () => {
    const { listed, skipped } = splitReportRows([
      row(2, 'skipped'),
      row(3, 'created'),
      row(4, 'failed'),
      row(5, 'unchanged'),
      row(6, 'skipped'),
      row(7, 'updated'),
      row(8, 'failed'),
    ])
    expect(listed.map(r => r.rowNumber)).toEqual([4, 8, 3, 5, 7])
    expect(skipped.map(r => r.rowNumber)).toEqual([2, 6])
  })
})

describe('counts and wording', () => {
  const result: InjectImportResultDto = {
    dryRun: true,
    totalRows: 8,
    socialRows: 5,
    createdCount: 3,
    updatedCount: 1,
    unchangedCount: 0,
    skippedCount: 3,
    failedCount: 1,
    rows: [],
  }

  it('N in "Import N items" is create + update', () => {
    expect(importableCount(result)).toBe(4)
    expect(itemsWord(4)).toBe('4 items')
    expect(itemsWord(1)).toBe('1 item')
  })

  it('shows the five counts in order, worded for a preview or a result', () => {
    expect(countLines(result).map(l => `${l.label} ${l.value}`)).toEqual([
      'To create 3',
      'To update 1',
      'Unchanged 0',
      'Skipped 3',
      'Failed 1',
    ])
    expect(countLines({ ...result, dryRun: false }).map(l => l.label)).toEqual([
      'Created',
      'Updated',
      'Unchanged',
      'Skipped',
      'Failed',
    ])
  })

  it('words statuses (a preview says what would happen) and the skipped summary', () => {
    expect(statusLabel('created', true)).toBe('Will create')
    expect(statusLabel('created', false)).toBe('Created')
    expect(statusLabel('failed', true)).toBe('Will fail')
    expect(statusLabel('skipped', false)).toBe('Skipped')
    expect(skippedSummary(3)).toBe('3 rows skipped (not social media)')
    expect(skippedSummary(1)).toBe('1 row skipped (not social media)')
  })
})

const NL = String.fromCharCode(10)

/** A Blob's text through `FileReader` (present in every jsdom). */
function textOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

describe('the pick-time snapshot (H-1 / M-1)', () => {
  it('types a file by its extension, never the browser guess', () => {
    // Windows + Office reports a .csv as application/vnd.ms-excel.
    expect(normalisedImportType('msel.csv', 'application/vnd.ms-excel')).toBe('text/csv')
    expect(normalisedImportType('MSEL.XLSX', '')).toBe(XLSX_MIME)
    expect(normalisedImportType('notes.txt', 'text/plain')).toBe('text/plain')
  })

  it('copies the bytes into memory with the normalised type and the same name', async () => {
    const content = 'Inject #,Title' + NL + '1,Hello'
    const picked = new File([content], 'msel.csv', { type: 'application/vnd.ms-excel' })
    const snapshot = await snapshotImportFile(picked)
    expect(snapshot).not.toBe(picked)
    expect(snapshot.name).toBe('msel.csv')
    expect(snapshot.type).toBe('text/csv')
    expect(snapshot.size).toBe(picked.size)
    expect(await textOf(snapshot)).toBe(content)
  })
})

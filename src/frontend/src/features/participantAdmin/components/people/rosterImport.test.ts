/** Import helpers (easy-login story 10): template, pre-upload file check, outcome sentence. */
import { describe, expect, it } from 'vitest'
import { MAX_ROSTER_IMPORT_BYTES } from '../../services/rosterService'
import type { RosterImportResultDto } from '../../types'
import { describeImportResult, ROSTER_TEMPLATE_HREF, validateRosterFile } from './rosterImport'

describe('ROSTER_TEMPLATE_HREF', () => {
  it('is a client-generated data URI holding exactly the frozen header row', () => {
    expect(ROSTER_TEMPLATE_HREF.startsWith('data:text/csv;charset=utf-8,')).toBe(true)
    const body = decodeURIComponent(ROSTER_TEMPLATE_HREF.split(',')[1] ?? '')
    expect(body).toBe('name,agency,role,email,personaHandle,signInName\r\n')
  })
})

describe('validateRosterFile (before upload, with the server wording)', () => {
  const csv = (content: string, name = 'roster.csv', type = 'text/csv') =>
    new File([content], name, { type })

  it('accepts a .csv', () => {
    expect(validateRosterFile(csv('name\nJane'))).toBeNull()
  })

  it('accepts text/csv with an odd extension and the Excel CSV MIME type', () => {
    expect(validateRosterFile(csv('name\nJane', 'roster.txt', 'text/csv'))).toBeNull()
    expect(validateRosterFile(csv('name\nJane', 'roster', 'application/vnd.ms-excel'))).toBeNull()
  })

  it('rejects a non-CSV with the server\'s wording', () => {
    expect(validateRosterFile(csv('x', 'roster.pdf', 'application/pdf')))
      .toBe('The uploaded file must be a CSV (text/csv or a .csv file).')
  })

  it('rejects an empty file', () => {
    expect(validateRosterFile(csv(''))).toBe('A non-empty CSV file is required.')
  })

  it('rejects a file over 1 MB with the server\'s wording, and accepts exactly 1 MB', () => {
    const over = csv('x'.repeat(MAX_ROSTER_IMPORT_BYTES + 1))
    expect(validateRosterFile(over))
      .toBe('The CSV file exceeds the maximum size of 1048576 bytes.')
    expect(validateRosterFile(csv('x'.repeat(MAX_ROSTER_IMPORT_BYTES)))).toBeNull()
  })
})

describe('describeImportResult', () => {
  const base: RosterImportResultDto = {
    dryRun: true,
    totalRows: 6,
    createdCount: 5,
    updatedCount: 0,
    unchangedCount: 0,
    failedCount: 1,
    rows: [],
  }

  it('a dry run says nothing was written and uses "would"', () => {
    const text = describeImportResult(base)
    expect(text).toBe(
      'Validated 6 rows: 5 would be created, 0 would be updated, 0 unchanged, 1 failed.'
      + ' Nothing was written.',
    )
  })

  it('a real import reports what happened', () => {
    const real = { ...base, dryRun: false, totalRows: 1, createdCount: 1, failedCount: 0 }
    expect(describeImportResult(real))
      .toBe('Imported 1 row: 1 created, 0 updated, 0 unchanged, 0 failed.')
  })
})

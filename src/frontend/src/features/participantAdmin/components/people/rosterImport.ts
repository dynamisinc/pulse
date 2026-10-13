/**
 * features/participantAdmin/components/people/rosterImport.ts
 * ---------------------------------------------------------------------------
 * Pure helpers of the roster CSV import panel (feature: easy-login, story 10):
 * the client-generated template, the pre-upload file check, and the one-sentence
 * outcome that goes in the live region. Kept out of the component so each is
 * unit-tested directly.
 *
 * NO CSV PARSING lives here (or anywhere in the screen): the template is a
 * string and the server parses uploads.
 *
 * World: STAFF. Pure functions — no UI.
 */

import { MAX_ROSTER_IMPORT_BYTES, ROSTER_CSV_TEMPLATE_HEADER } from '../../services/rosterService'
import type { RosterImportResultDto } from '../../types'

/** Client-generated template: the header row only, so it cannot be imported by accident. */
export const ROSTER_TEMPLATE_HREF =
  `data:text/csv;charset=utf-8,${encodeURIComponent(`${ROSTER_CSV_TEMPLATE_HEADER}\r\n`)}`

/** Checks the picked file with the server's wording. `null` = acceptable. */
export function validateRosterFile(file: File): string | null {
  const isCsv =
    file.name.toLowerCase().endsWith('.csv')
    || file.type === 'text/csv'
    || file.type === 'application/vnd.ms-excel'
  if (!isCsv) return 'The uploaded file must be a CSV (text/csv or a .csv file).'
  if (file.size === 0) return 'A non-empty CSV file is required.'
  if (file.size > MAX_ROSTER_IMPORT_BYTES) {
    return `The CSV file exceeds the maximum size of ${MAX_ROSTER_IMPORT_BYTES} bytes.`
  }
  return null
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** The one-sentence outcome that goes in the live region. */
export function describeImportResult(result: RosterImportResultDto): string {
  const rows = plural(result.totalRows, 'row', 'rows')
  if (result.dryRun) {
    return `Validated ${rows}: ${result.createdCount} would be created, ${result.updatedCount}`
      + ` would be updated, ${result.unchangedCount} unchanged, ${result.failedCount} failed.`
      + ' Nothing was written.'
  }
  return `Imported ${rows}: ${result.createdCount} created, ${result.updatedCount} updated,`
    + ` ${result.unchangedCount} unchanged, ${result.failedCount} failed.`
}

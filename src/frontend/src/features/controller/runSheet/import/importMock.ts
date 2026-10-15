/**
 * features/controller/runSheet/import/importMock.ts
 * ---------------------------------------------------------------------------
 * The MOCK adapter of the MSEL import (demo-feedback story 10 AC "Mock adapter for the
 * import behind the run sheet's mock switch"). STAFF world, no UI. `getInjectImportService()`
 * returns it under `USE_MOCK_DATA`, the same switch that serves the run sheet's in-memory
 * queue (`../injectMock.ts`), so `npm run dev` and the tests can walk the whole flow:
 * choose a file -> Preview -> Import N items -> the new items appear on the run sheet's
 * next 3 s poll.
 *
 * WHAT IT DOES NOT DO: read the file. Like the console itself (the server parses uploads),
 * the mock only looks at the file's name and size, with story 03's refusals and wording:
 * not `.xlsx` / `.csv`, empty, over 2 MiB -> a 400 `InjectImportError('refused')`. Any
 * accepted file is answered with ONE canned Fairhaven MSEL (`MOCK_MSEL_ROWS`): eight data
 * rows (header = row 1), three of them non-social (skipped), one social row whose persona is
 * unknown (failed), four social rows that import, one with an assignee warning.
 *
 * IDEMPOTENT LIKE THE SERVER (DF-10). An applied row remembers the run-sheet item it created
 * (by `Inject #`). Importing again reads the queue: the item still there -> `unchanged`
 * ("already fired; not changed" once fired, "skipped in the run sheet; not changed" when
 * skipped); deleted -> `created` again. A dry run never writes.
 *
 * TEST HOOKS (not re-exported by the barrel): `refuseNext(detail)` makes the next call a 400
 * with that reason, `conflictNext(detail)` a 409; `reset()` forgets what was applied; `calls`
 * records every request (`dryRun` + file name) so a test can assert the dialog re-posted the
 * SAME file with `dryRun=false`.
 *
 * NO telemetry (the server emits `injects.imported`), NO `exerciseId`.
 */

import { personaIdForHandle } from '@/features/personas/types'
import { MOCK_ME, injectMock } from '../injectMock'
import type { InjectService } from '../injectService'
import type { InjectItemWrite } from '../types'
import { InjectImportError } from './importErrors'
import type { InjectImportResultDto, InjectImportRowDto } from './importTypes'
import type { InjectImportService } from './importService'

/** Story 03's refusals, worded as the server words them (`MselTable.cs`, `InjectImportService`). */
export const MOCK_IMPORT_MESSAGES = {
  notXlsxOrCsv: 'the file must be an Excel workbook (.xlsx) or a UTF-8 CSV file.',
  empty: 'the file is empty.',
  tooLarge: 'the file exceeds the maximum size of 2097152 bytes (2 MiB).',
  alreadyFired: 'already fired; not changed',
  skippedInRunSheet: 'skipped in the run sheet; not changed',
} as const

const MAX_FILE_BYTES = 2 * 1024 * 1024

/** One canned MSEL row: what the "file" says, before it is planned against the queue. */
export interface MockMselRow {
  readonly rowNumber: number
  readonly injectNumber: string
  readonly title: string
  readonly deliveryMethod: string
  readonly source: string
  readonly plannedMinute?: number
  readonly text?: string
  readonly assigneeId?: string
  /** A planner refusal (unknown persona, ...): the row fails. */
  readonly failure?: string
  /** A planner warning carried on an importable row. */
  readonly warning?: string
}

/** The canned Fairhaven MSEL every accepted mock upload "contains". Header = row 1. */
export const MOCK_MSEL_ROWS: readonly MockMselRow[] = [
  { rowNumber: 2, injectNumber: 'INJ-001', title: 'StartEx briefing', deliveryMethod: 'Verbal', source: 'Exercise Director', plannedMinute: 0 },
  {
    rowNumber: 3,
    injectNumber: 'INJ-002',
    title: 'Water utility posts boil-water notice',
    deliveryMethod: 'Social Media',
    source: '@FairhavenWater',
    plannedMinute: 5,
    text: 'Boil-water notice for Fairhaven Eastside: boil tap water for 1 minute before drinking. Updates here. #WaterIssues',
    assigneeId: MOCK_ME,
  },
  { rowNumber: 4, injectNumber: 'INJ-003', title: 'Hospital calls the EOC', deliveryMethod: 'Phone', source: 'Fairhaven General', plannedMinute: 8 },
  {
    rowNumber: 5,
    injectNumber: 'INJ-004',
    title: 'Resident posts cloudy-water photo',
    deliveryMethod: 'Social Media',
    source: 'tbrandt41',
    plannedMinute: 12,
    text: 'This is what came out of my kitchen tap this morning. Is this safe?? #WaterIssues',
  },
  {
    rowNumber: 6,
    injectNumber: 'INJ-005',
    title: 'Rumour: plant contamination',
    deliveryMethod: 'Social',
    source: 'Plant Insider',
    plannedMinute: 15,
    text: 'Word from inside the plant: it was a chemical spill, not a main break.',
    failure: "unknown persona 'Plant Insider': no persona in this exercise has that handle or display name.",
  },
  { rowNumber: 7, injectNumber: 'INJ-006', title: 'State health department email', deliveryMethod: 'Email', source: 'State DOH', plannedMinute: 20 },
  {
    rowNumber: 8,
    injectNumber: 'INJ-007',
    title: 'County EM: bottled water points',
    deliveryMethod: 'Social Media',
    source: 'FulcoEM',
    plannedMinute: 25,
    text: 'Bottled water distribution opens at 2 PM at Eastside High School and the Fairhaven Library. #WaterIssues',
    warning: "Responsible Controller 'Pat Doe' is not assigned to this exercise; left unassigned.",
  },
  {
    rowNumber: 9,
    injectNumber: 'INJ-008',
    title: 'The Scoop: "cover-up" claim',
    deliveryMethod: 'Pulse',
    source: '@TheScoopHQ',
    plannedMinute: 30,
    text: 'Sources tell The Scoop the utility knew about the contamination for DAYS. Why the silence?',
    assigneeId: 'human-controller-02',
  },
]

const isSocial = (method: string): boolean => {
  const value = method.trim().toLowerCase()
  return value === 'social media' || value === 'social' || value === 'pulse' || value.includes('social')
}

const handleOf = (source: string): string => source.trim().replace(/^@/, '')

function writeFor(row: MockMselRow): InjectItemWrite {
  return {
    kind: 'post',
    title: row.title,
    plannedMinute: row.plannedMinute,
    assigneeId: row.assigneeId ?? null,
    posts: [{ personaId: personaIdForHandle(handleOf(row.source)), text: row.text ?? '' }],
  }
}

export interface InjectImportMockCall {
  readonly dryRun: boolean
  readonly fileName: string
  readonly file: File
}

export interface InjectImportMock extends InjectImportService {
  /** Every request, in order (for assertions). */
  readonly calls: readonly InjectImportMockCall[]
  /** The next call answers 400 with this reason. */
  refuseNext(detail: string): void
  /** The next call answers 409 with this reason. */
  conflictNext(detail: string): void
  /** Forgets applied rows, calls and queued failures. */
  reset(): void
}

export interface InjectImportMockOptions {
  /** The run-sheet store applied rows are written to. Default: the process-wide `injectMock`. */
  readonly queue?: InjectService
  readonly rows?: readonly MockMselRow[]
}

export function createInjectImportMock(options: InjectImportMockOptions = {}): InjectImportMock {
  const queue = options.queue ?? injectMock
  const rows = options.rows ?? MOCK_MSEL_ROWS
  /** Inject # -> the item id (and title) the mock created for it. */
  let applied = new Map<string, { id: string; title: string }>()
  let calls: InjectImportMockCall[] = []
  let nextFailure: InjectImportError | undefined

  const refuseFile = (file: File): string | undefined => {
    const name = file.name.toLowerCase()
    if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) return MOCK_IMPORT_MESSAGES.notXlsxOrCsv
    if (file.size === 0) return MOCK_IMPORT_MESSAGES.empty
    if (file.size > MAX_FILE_BYTES) return MOCK_IMPORT_MESSAGES.tooLarge
    return undefined
  }

  const importFile = async (
    file: File,
    { dryRun }: { readonly dryRun: boolean },
  ): Promise<InjectImportResultDto> => {
    calls = [...calls, { dryRun, fileName: file.name, file }]
    await Promise.resolve()
    if (nextFailure) {
      const failure = nextFailure
      nextFailure = undefined
      throw failure
    }
    const refusal = refuseFile(file)
    if (refusal) throw new InjectImportError('refused', refusal)

    const { items } = await queue.list()
    const report: InjectImportRowDto[] = []
    let social = 0

    for (const row of rows) {
      const base = {
        rowNumber: row.rowNumber,
        injectNumber: row.injectNumber,
        title: row.title,
        personaHandle: handleOf(row.source),
        ...(row.plannedMinute === undefined ? {} : { plannedMinute: row.plannedMinute }),
      }
      if (!isSocial(row.deliveryMethod)) {
        report.push({
          rowNumber: row.rowNumber,
          injectNumber: row.injectNumber,
          title: row.title,
          status: 'skipped',
          message: `not a social-media inject (Delivery Method: ${row.deliveryMethod})`,
        })
        continue
      }
      social += 1
      if (row.failure) {
        report.push({ ...base, status: 'failed', message: row.failure })
        continue
      }

      const known = applied.get(row.injectNumber)
      const existing = known
        ? items.find(item => item.id === known.id && item.title === known.title)
        : undefined
      if (existing) {
        const message =
          existing.status === 'fired' || existing.status === 'firing'
            ? MOCK_IMPORT_MESSAGES.alreadyFired
            : existing.status === 'skipped'
              ? MOCK_IMPORT_MESSAGES.skippedInRunSheet
              : undefined
        report.push({ ...base, status: 'unchanged', ...(message ? { message } : {}) })
        continue
      }

      if (!dryRun) {
        const created = await queue.create(writeFor(row))
        applied = new Map(applied).set(row.injectNumber, { id: created.id, title: created.title })
      }
      report.push({ ...base, status: 'created', ...(row.warning ? { message: row.warning } : {}) })
    }

    const count = (status: InjectImportRowDto['status']): number => report.filter(r => r.status === status).length
    return {
      dryRun,
      totalRows: report.length,
      socialRows: social,
      createdCount: count('created'),
      updatedCount: count('updated'),
      unchangedCount: count('unchanged'),
      skippedCount: count('skipped'),
      failedCount: count('failed'),
      rows: report,
    }
  }

  return {
    get calls() {
      return calls
    },
    importFile,
    refuseNext(detail) {
      nextFailure = new InjectImportError('refused', detail)
    },
    conflictNext(detail) {
      nextFailure = new InjectImportError('conflict', detail)
    },
    reset() {
      applied = new Map()
      calls = []
      nextFailure = undefined
    },
  }
}

/** The process-wide mock `getInjectImportService()` returns under `USE_MOCK_DATA`. */
export const injectImportMock: InjectImportMock = createInjectImportMock()

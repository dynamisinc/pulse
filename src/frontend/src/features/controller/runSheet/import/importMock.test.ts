/**
 * features/controller/runSheet/import/importMock.test.ts
 * ---------------------------------------------------------------------------
 * The import MOCK behaves like story 03's server where the console can tell:
 *  - story 03's refusals by file name / size, as 400 'refused' with the server's wording;
 *  - a dry run reports and writes NOTHING to the run sheet;
 *  - an import creates one single-post item per importable social row, in the run-sheet store
 *    the poll reads (so the items appear on the next poll);
 *  - re-importing never duplicates (DF-10): unchanged, "already fired; not changed" once fired,
 *    and created again only when the item was deleted;
 *  - the test hooks (`refuseNext`, `conflictNext`) raise the same typed error as the live service.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createInjectMock, type InjectMock } from '../injectMock'
import { createInjectImportMock, MOCK_IMPORT_MESSAGES, MOCK_MSEL_ROWS, type InjectImportMock } from './importMock'

const msel = (name = 'kestrel-msel.xlsx', size = 2048): File => {
  const file = new File(['x'], name)
  Object.defineProperty(file, 'size', { value: size })
  return file
}

let queue: InjectMock
let mock: InjectImportMock

beforeEach(() => {
  queue = createInjectMock({ seed: [] })
  mock = createInjectImportMock({ queue })
})

afterEach(() => {
  queue.dispose()
})

const SOCIAL_OK = MOCK_MSEL_ROWS.filter(r => /social|pulse/i.test(r.deliveryMethod) && !r.failure)

describe('injectImportMock', () => {
  it('refuses a wrong type, an empty file and an oversized file (400, server wording)', async () => {
    await expect(mock.importFile(msel('notes.txt'), { dryRun: true })).rejects.toMatchObject({
      kind: 'refused',
      detail: MOCK_IMPORT_MESSAGES.notXlsxOrCsv,
    })
    await expect(mock.importFile(msel('a.csv', 0), { dryRun: true })).rejects.toMatchObject({
      detail: MOCK_IMPORT_MESSAGES.empty,
    })
    await expect(mock.importFile(msel('a.xlsx', 3 * 1024 * 1024), { dryRun: true })).rejects.toMatchObject({
      detail: MOCK_IMPORT_MESSAGES.tooLarge,
    })
  })

  it('a dry run reports every row and writes nothing', async () => {
    const result = await mock.importFile(msel(), { dryRun: true })
    expect(result.dryRun).toBe(true)
    expect(result.totalRows).toBe(MOCK_MSEL_ROWS.length)
    expect(result.createdCount).toBe(SOCIAL_OK.length)
    expect(result.skippedCount).toBe(3)
    expect(result.failedCount).toBe(1)
    expect(result.socialRows).toBe(SOCIAL_OK.length + 1)
    expect(result.rows.find(r => r.status === 'failed')?.message).toMatch(/unknown persona/)
    expect(result.rows.filter(r => r.status === 'skipped').every(r => /not a social-media inject/.test(r.message ?? ''))).toBe(true)
    expect(queue.snapshot().items).toHaveLength(0)
  })

  it('an import creates one single-post item per importable row in the run-sheet store', async () => {
    const result = await mock.importFile(msel(), { dryRun: false })
    expect(result.dryRun).toBe(false)
    expect(result.createdCount).toBe(SOCIAL_OK.length)
    const items = queue.snapshot().items
    expect(items.map(i => i.title)).toEqual(SOCIAL_OK.map(r => r.title))
    expect(items.every(i => i.kind === 'post' && i.posts.length === 1)).toBe(true)
    expect(items[0]?.plannedMinute).toBe(SOCIAL_OK[0]?.plannedMinute)
    expect(items[0]?.posts[0]?.personaId).toBe('persona-fairhavenwater')
  })

  it('re-importing never duplicates: unchanged, already fired, created again only after a delete', async () => {
    await mock.importFile(msel(), { dryRun: false })
    const items = queue.snapshot().items
    const first = items[0]
    const second = items[1]
    if (!first || !second) throw new Error('nothing imported')
    await queue.fire(first.id)
    await queue.remove(second.id, second.version)

    const again = await mock.importFile(msel(), { dryRun: false })
    const byTitle = (title: string) => again.rows.find(r => r.title === title)
    expect(byTitle(first.title)).toMatchObject({ status: 'unchanged', message: MOCK_IMPORT_MESSAGES.alreadyFired })
    expect(byTitle(second.title)?.status).toBe('created')
    expect(again.createdCount).toBe(1)
    expect(again.unchangedCount).toBe(SOCIAL_OK.length - 1)
    expect(queue.snapshot().items).toHaveLength(SOCIAL_OK.length)
  })

  it('records every call and raises queued refusals / conflicts once', async () => {
    mock.refuseNext('the header row is missing the required column(s): Delivery Method.')
    await expect(mock.importFile(msel(), { dryRun: true })).rejects.toMatchObject({
      kind: 'refused',
      detail: 'the header row is missing the required column(s): Delivery Method.',
    })
    mock.conflictNext('The run sheet changed while importing. Run the import again.')
    await expect(mock.importFile(msel(), { dryRun: false })).rejects.toMatchObject({ kind: 'conflict' })
    await expect(mock.importFile(msel(), { dryRun: true })).resolves.toMatchObject({ dryRun: true })
    expect(mock.calls.map(c => c.dryRun)).toEqual([true, false, true])
    mock.reset()
    expect(mock.calls).toHaveLength(0)
  })
})

/**
 * features/controller/runSheet/import/RunSheetImportDialog.test.tsx
 * ---------------------------------------------------------------------------
 * "Import from Excel" end to end in the run sheet (demo-feedback story 10), against the REAL
 * mocks behind the run sheet's mock switch (`injectMock` + `injectImportMock`):
 *
 *  - the toolbar shows **Import from Excel** right after **Add**; it opens a COBRA dialog with a
 *    picker accepting .xlsx / .csv, the one-line hint and **Preview**;
 *  - Preview posts with dryRun=true and shows the five counts and the row table, FAILED rows
 *    first, skipped rows collapsed under "N rows skipped (not social media)";
 *  - **Import N items** re-posts the SAME file with dryRun=false, shows the result counts, and
 *    **Done** closes; the run sheet shows the new items on its next poll;
 *  - a 400 shows the server's reason (preview and import);
 *  - a11y: modal with focus inside, focus kept inside, Escape closes, the table has headers;
 *    run-sheet single-key shortcuts do not fire from inside the dialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { RunSheetPanel } from '../RunSheetPanel'
import { injectMock } from '../injectMock'
import { renderRunSheet } from '../runSheetTestHarness'
import { injectImportMock, MOCK_MSEL_ROWS } from './importMock'
import type { InjectItemWrite } from '../types'

const seed: InjectItemWrite[] = [
  { kind: 'post', title: 'Alpha', posts: [{ personaId: 'persona-fairhavenwater', text: 'Alpha text' }] },
]

const IMPORTABLE = MOCK_MSEL_ROWS.filter(r => /social|pulse/i.test(r.deliveryMethod) && !r.failure)

function msel(name = 'kestrel-msel.xlsx'): File {
  return new File(['PK fake workbook bytes'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

async function openDialog(): Promise<HTMLElement> {
  renderRunSheet(<RunSheetPanel />)
  await screen.findAllByTestId('run-sheet-row')
  fireEvent.click(screen.getByRole('button', { name: 'Import from Excel' }))
  return screen.findByRole('dialog', { name: 'Import from Excel' })
}

function pick(dialog: HTMLElement, file: File): void {
  fireEvent.change(within(dialog).getByTestId('import-file-input'), { target: { files: [file] } })
}

async function preview(dialog: HTMLElement): Promise<void> {
  fireEvent.click(within(dialog).getByRole('button', { name: /^Preview/ }))
  await within(dialog).findByTestId('import-report')
}

beforeEach(() => {
  window.localStorage.clear()
  injectMock.reset({ seed })
  injectImportMock.reset()
})

afterEach(() => {
  injectMock.dispose()
  vi.restoreAllMocks()
})

describe('Import from Excel — the toolbar and the dialog', () => {
  it('puts Import from Excel right after Add', async () => {
    renderRunSheet(<RunSheetPanel />)
    await screen.findAllByTestId('run-sheet-row')
    const add = screen.getByRole('button', { name: 'Add item' })
    const importButton = screen.getByRole('button', { name: 'Import from Excel' })
    expect(add.nextElementSibling).toBe(importButton)
  })

  it('opens a modal dialog with an .xlsx/.csv picker, the hint and Preview', async () => {
    const dialog = await openDialog()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const input = within(dialog).getByTestId('import-file-input')
    expect(input).toHaveAttribute('type', 'file')
    expect(input.getAttribute('accept')).toMatch(/\.xlsx/)
    expect(input.getAttribute('accept')).toMatch(/\.csv/)
    expect(within(dialog).getByTestId('import-hint')).toHaveTextContent(
      'A Cadence MSEL export works as-is; only social-media rows are imported',
    )
    // Preview is there, and waits for a file.
    expect(within(dialog).getByRole('button', { name: /^Preview/ })).toBeDisabled()
    pick(dialog, msel())
    expect(within(dialog).getByTestId('import-file-name')).toHaveTextContent('kestrel-msel.xlsx')
    expect(within(dialog).getByRole('button', { name: /^Preview/ })).toBeEnabled()
  })

  it('checks the file before upload (wrong type: a reason, no request)', async () => {
    const dialog = await openDialog()
    pick(dialog, msel('notes.txt'))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/\.xlsx.*\.csv/)
    expect(within(dialog).getByRole('button', { name: /^Preview/ })).toBeDisabled()
    expect(injectImportMock.calls).toHaveLength(0)
  })
})

describe('Import from Excel — preview', () => {
  it('posts a dry run and shows the counts and the rows, failed first, skipped collapsed', async () => {
    const dialog = await openDialog()
    pick(dialog, msel())
    await preview(dialog)

    expect(injectImportMock.calls.map(c => c.dryRun)).toEqual([true])
    const counts = within(dialog).getByTestId('import-counts')
    expect(within(counts).getByTestId('import-count-created')).toHaveTextContent(`To create${IMPORTABLE.length}`)
    expect(within(counts).getByTestId('import-count-updated')).toHaveTextContent('To update0')
    expect(within(counts).getByTestId('import-count-unchanged')).toHaveTextContent('Unchanged0')
    expect(within(counts).getByTestId('import-count-skipped')).toHaveTextContent('Skipped3')
    expect(within(counts).getByTestId('import-count-failed')).toHaveTextContent('Failed1')

    const table = within(dialog).getByTestId('import-rows')
    const headers = within(table).getAllByRole('columnheader').map(h => h.textContent)
    expect(headers).toEqual(['Row', 'Inject #', 'Title', 'Persona', 'Planned', 'Status', 'Message'])
    const bodyRows = within(table).getAllByRole('row').slice(1)
    // Failed first, then the importable rows in file order; no skipped row in the main table.
    expect(bodyRows.map(r => r.getAttribute('data-status'))).toEqual([
      'failed',
      ...IMPORTABLE.map(() => 'created'),
    ])
    const failed = bodyRows[0]
    if (!failed) throw new Error('no failed row')
    expect(failed).toHaveTextContent('INJ-005')
    expect(failed).toHaveTextContent('Will fail')
    expect(failed).toHaveTextContent(/unknown persona 'Plant Insider'/)
    const firstImport = bodyRows[1]
    if (!firstImport) throw new Error('no importable row')
    expect(firstImport).toHaveTextContent('3')
    expect(firstImport).toHaveTextContent('INJ-002')
    expect(firstImport).toHaveTextContent('@FairhavenWater')
    expect(firstImport).toHaveTextContent('T+5')
    expect(firstImport).toHaveTextContent('Will create')

    // Skipped rows: collapsed under a summary, not open.
    const skipped = within(dialog).getByTestId('import-skipped')
    expect(skipped.tagName).toBe('DETAILS')
    expect(skipped).not.toHaveAttribute('open')
    expect(within(skipped).getByText('3 rows skipped (not social media)')).toBeInTheDocument()

    // Nothing written yet, and the next step names how many items.
    expect(injectMock.snapshot().items).toHaveLength(1)
    expect(within(dialog).getByRole('button', { name: `Import ${IMPORTABLE.length} items` })).toBeEnabled()
    expect(within(dialog).getByTestId('import-status')).toHaveTextContent(/Nothing has been written yet/)
  })

  it('shows the server\'s reason on a 400 and stays on the file step', async () => {
    const dialog = await openDialog()
    pick(dialog, msel())
    injectImportMock.refuseNext('the header row is missing the required column(s): Delivery Method.')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Preview/ }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(
      'The file could not be previewed: the header row is missing the required column(s): Delivery Method.',
    )
    expect(within(dialog).queryByTestId('import-report')).toBeNull()
    expect(within(dialog).getByRole('button', { name: /^Preview/ })).toBeEnabled()
  })
})

describe('Import from Excel — apply', () => {
  it('re-posts the same file with dryRun=false, shows the result, Done closes, the sheet updates', async () => {
    const dialog = await openDialog()
    const file = msel()
    pick(dialog, file)
    await preview(dialog)

    fireEvent.click(within(dialog).getByRole('button', { name: `Import ${IMPORTABLE.length} items` }))
    const done = await within(dialog).findByRole('button', { name: 'Done' })

    expect(injectImportMock.calls.map(c => c.dryRun)).toEqual([true, false])
    expect(injectImportMock.calls[1]?.file).toBe(file)
    expect(within(dialog).getByTestId('import-report')).toHaveAttribute('data-dry-run', 'false')
    expect(within(dialog).getByTestId('import-count-created')).toHaveTextContent(`Created${IMPORTABLE.length}`)
    expect(within(dialog).getByTestId('import-status')).toHaveTextContent(/Import complete/)
    expect(injectMock.snapshot().items).toHaveLength(1 + IMPORTABLE.length)
    await waitFor(() => expect(done).toHaveFocus())

    fireEvent.click(done)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // The run sheet's own poll (every ~3 s) brings the new items in: no extra wiring.
    const firstTitle = IMPORTABLE[0]?.title ?? ''
    expect(await screen.findByText(firstTitle, {}, { timeout: 4500 })).toBeInTheDocument()
  }, 15_000)

  it('shows the server\'s reason when the import itself is refused, keeping the preview', async () => {
    const dialog = await openDialog()
    pick(dialog, msel())
    await preview(dialog)
    injectImportMock.refuseNext('the file exceeds the maximum size of 2097152 bytes (2 MiB).')
    fireEvent.click(within(dialog).getByRole('button', { name: `Import ${IMPORTABLE.length} items` }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(
      'The file could not be imported: the file exceeds the maximum size of 2097152 bytes (2 MiB).',
    )
    expect(within(dialog).getByTestId('import-report')).toHaveAttribute('data-dry-run', 'true')
    expect(injectMock.snapshot().items).toHaveLength(1)
  })

  it('a 409 asks to run the import again', async () => {
    const dialog = await openDialog()
    pick(dialog, msel())
    await preview(dialog)
    injectImportMock.conflictNext('The run sheet changed while importing. Run the import again.')
    fireEvent.click(within(dialog).getByRole('button', { name: `Import ${IMPORTABLE.length} items` }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The run sheet changed while importing. Run the import again.',
    )
  })
})

describe('Import from Excel — accessibility', () => {
  it('starts with focus inside the dialog and keeps it there', async () => {
    const dialog = await openDialog()
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    expect(within(dialog).getByRole('button', { name: 'Choose file' })).toHaveFocus()
    // The trap: MUI's focus sentinels bracket the dialog, and everything behind it (the run
    // sheet) is hidden from assistive tech while it is open. (jsdom has no real window focus,
    // so MUI's focusin enforcement cannot be driven here; the structure is what is asserted.)
    expect(document.querySelector('[data-testid="sentinelStart"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="sentinelEnd"]')).not.toBeNull()
    const panel = screen.getByTestId('run-sheet-panel')
    expect(panel.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('Escape closes the dialog', async () => {
    const dialog = await openDialog()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('run-sheet shortcuts do not fire from inside the dialog', async () => {
    const dialog = await openDialog()
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Choose file' }), { key: 'a' })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    expect(screen.queryByTestId('inject-editor')).toBeNull()
  })

  it('the result table has a caption and column headers; row numbers are row headers', async () => {
    const dialog = await openDialog()
    pick(dialog, msel())
    await preview(dialog)
    const table = within(dialog).getByTestId('import-rows')
    expect(table.querySelector('caption')?.textContent).toMatch(/failed rows first/)
    expect(within(table).getAllByRole('columnheader')).toHaveLength(7)
    expect(within(table).getAllByRole('rowheader').length).toBeGreaterThan(0)
  })
})

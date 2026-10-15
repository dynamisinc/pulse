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
 *  - the picked file is snapshot at pick time: a .csv goes as text/csv whatever the browser
 *    said, and Import posts the previewed bytes even if the file changed on disk;
 *  - a11y: modal, the focus trap driven (escape + wrap), Escape closes (not while a request
 *    is in flight), secondary text >= 4.5:1, the table has headers; Ctrl/Cmd+K still
 *    reaches the console;
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

/** WCAG 2.1 contrast of two CSS colours (`#rrggbb` or `rgb(...)`). */
function contrast(a: string, b: string): number {
  const lum = (value: string): number => {
    const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
    const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(value.trim())
    const n = hex ? Number.parseInt(hex[1] ?? '0', 16) : 0
    const channels = hex
      ? [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      : rgb
        ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
        : [Number.NaN, Number.NaN, Number.NaN]
    const [r, g, bl] = channels.map(c => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** A Blob's text through `FileReader`. */
function textOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

function msel(name = 'kestrel-msel.xlsx'): File {
  return new File(['PK fake workbook bytes'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

async function openDialog(onOuterKeyDown?: (key: string) => void): Promise<HTMLElement> {
  renderRunSheet(
    <div onKeyDown={event => onOuterKeyDown?.(event.key)}>
      <RunSheetPanel />
    </div>,
  )
  await screen.findAllByTestId('run-sheet-row')
  fireEvent.click(screen.getByRole('button', { name: 'Import from Excel' }))
  return screen.findByRole('dialog', { name: 'Import from Excel' })
}

function pick(dialog: HTMLElement, file: File): void {
  fireEvent.change(within(dialog).getByTestId('import-file-input'), { target: { files: [file] } })
}

/** Preview is enabled once the picked file has been snapshot into memory. */
async function previewReady(dialog: HTMLElement): Promise<HTMLElement> {
  const button = within(dialog).getByRole('button', { name: /^Preview/ })
  await waitFor(() => expect(button).toBeEnabled())
  return button
}

async function preview(dialog: HTMLElement): Promise<void> {
  fireEvent.click(await previewReady(dialog))
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
    await previewReady(dialog)
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
    fireEvent.click(await previewReady(dialog))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(
      'The file could not be previewed: the header row is missing the required column(s): Delivery Method.',
    )
    expect(within(dialog).queryByTestId('import-report')).toBeNull()
    expect(within(dialog).getByRole('button', { name: /^Preview/ })).toBeEnabled()
  })
})

describe('Import from Excel — the file is snapshot at pick time', () => {
  it('posts a .csv picked as application/vnd.ms-excel as text/csv', async () => {
    const dialog = await openDialog()
    const csv = new File(['Inject #,Title'], 'kestrel-msel.csv', { type: 'application/vnd.ms-excel' })
    pick(dialog, csv)
    await preview(dialog)
    expect(injectImportMock.calls[0]?.file.type).toBe('text/csv')
    expect(injectImportMock.calls[0]?.file.name).toBe('kestrel-msel.csv')
  })

  it('Import sends the previewed bytes even after the original file changes', async () => {
    const dialog = await openDialog()
    const original = new File(['version one'], 'kestrel-msel.csv', { type: 'text/csv' })
    pick(dialog, original)
    await preview(dialog)
    // The controller re-saves the file on disk: the original File now reads differently.
    Object.defineProperty(original, 'arrayBuffer', {
      value: () => Promise.reject(new Error('ERR_UPLOAD_FILE_CHANGED')),
    })
    Object.defineProperty(original, 'size', { value: 999 })
    fireEvent.click(within(dialog).getByRole('button', { name: `Import ${IMPORTABLE.length} items` }))
    await within(dialog).findByRole('button', { name: 'Done' })
    const sent = injectImportMock.calls[1]?.file
    if (!sent) throw new Error('no import call')
    expect(sent).not.toBe(original)
    expect(sent).toBe(injectImportMock.calls[0]?.file)
    expect(await textOf(sent)).toBe('version one')
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
    // The SAME in-memory snapshot is posted twice (not the disk-backed original).
    expect(injectImportMock.calls[1]?.file).toBe(injectImportMock.calls[0]?.file)
    expect(injectImportMock.calls[1]?.file.name).toBe(file.name)
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
  it('starts with focus inside the dialog, and the trap brings focus back', async () => {
    // jsdom's document never "has focus"; MUI's trap only enforces when it does.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const dialog = await openDialog()
    const choose = within(dialog).getByRole('button', { name: 'Choose file' })
    await waitFor(() => expect(choose).toHaveFocus())
    // Everything behind the modal (the run sheet) is hidden from assistive tech.
    expect(screen.getByTestId('run-sheet-panel').closest('[aria-hidden="true"]')).not.toBeNull()

    // Focus escapes to a control behind the modal: the trap pulls it back into its root (the
    // dialog container around the Paper, which MUI focuses when no sentinel was crossed).
    const trapRoot = dialog.closest('.MuiDialog-container')
    if (!trapRoot) throw new Error('no dialog container')
    const behind = screen.getByTestId('add-item')
    act(() => behind.focus())
    await waitFor(() => expect(trapRoot.contains(document.activeElement)).toBe(true))
    expect(behind).not.toHaveFocus()

    // Tab off the end lands on the end sentinel: focus wraps to the first tabbable control.
    const end = document.querySelector<HTMLElement>('[data-testid="sentinelEnd"]')
    if (!end) throw new Error('no end sentinel')
    act(() => end.focus())
    await waitFor(() => expect(choose).toHaveFocus())
  })

  it('the hidden file input is not a tab stop of its own', async () => {
    const dialog = await openDialog()
    expect(within(dialog).getByTestId('import-file-input')).toHaveAttribute('tabindex', '-1')
  })

  it('Escape and Cancel are ignored while a request is in flight', async () => {
    let release: () => void = () => {}
    const real = injectImportMock.importFile
    vi.spyOn(injectImportMock, 'importFile').mockImplementation(async (file, options) => {
      await new Promise<void>(resolve => {
        release = resolve
      })
      return real(file, options)
    })
    const dialog = await openDialog()
    pick(dialog, msel())
    fireEvent.click(await previewReady(dialog))
    await within(dialog).findByRole('button', { name: /^Previewing/ })

    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    expect(screen.getByRole('dialog')).toBe(dialog)

    await act(async () => {
      release()
    })
    await within(dialog).findByTestId('import-report')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('modified keys (Ctrl/Cmd+K) still reach the console; plain keys stay in the dialog', async () => {
    const outer = vi.fn<(key: string) => void>()
    const dialog = await openDialog(outer)
    const choose = within(dialog).getByRole('button', { name: 'Choose file' })
    fireEvent.keyDown(choose, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(choose, { key: 'k', metaKey: true })
    expect(outer).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(choose, { key: 'a' })
    fireEvent.keyDown(choose, { key: 'n' })
    expect(outer).toHaveBeenCalledTimes(2)
  })

  it('secondary text clears 4.5:1 on white (not COBRA text.secondary)', async () => {
    const dialog = await openDialog()
    for (const testId of ['import-hint', 'import-file-name']) {
      const colour = getComputedStyle(within(dialog).getByTestId(testId)).color
      expect(contrast(colour, '#ffffff'), testId).toBeGreaterThanOrEqual(4.5)
    }
    pick(dialog, msel())
    await preview(dialog)
    const caption = within(dialog).getByTestId('import-rows').querySelector('caption')
    const label = within(within(dialog).getByTestId('import-count-created')).getByText('To create')
    for (const element of [caption, label]) {
      if (!element) throw new Error('missing element')
      expect(contrast(getComputedStyle(element).color, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    }
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

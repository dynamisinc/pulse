/**
 * features/participantAdmin/components/people/RosterImportPanel.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login story 10 — the CSV import panel, through the stateful mock backend.
 * Pins: the pre-upload size/type check with the server's wording, Validate
 * (`dryRun=true`, writes nothing) vs Import (`dryRun=false`, refetches), the
 * file KEPT after a validate, the per-row result (text + icon), the server's
 * reason on a 400, and the template link.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { rosterQueryKey } from '../../hooks/useRoster'
import { getRosterMockEntries, resetRosterMocks } from '../../mocks/rosterMocks'
import * as rosterService from '../../services/rosterService'
import { makeQueryClient, renderWithProviders } from '../../test/renderWithProviders'
import { RosterImportPanel } from './RosterImportPanel'
import { deferred, setupUser } from '../../test/userEvents'

// These tests render the full COBRA page / MUI dialogs through the stateful mock
// backend. A CI box under load can take several seconds just to mount the first
// one, so give them headroom over the 10 s test default and the 5 s `findBy`/`waitFor`
// default (set in src/test/setup.ts) rather than let contention read as a regression.
// Both settings are per test file (each file runs in its own isolated worker).
vi.setConfig({ testTimeout: 30_000 })
configure({ asyncUtilTimeout: 10_000 })

vi.mock('../../services/rosterService', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/rosterService')>()
  return { ...actual, importRoster: vi.fn(actual.importRoster) }
})

const importSpy = vi.mocked(rosterService.importRoster)

const GOOD_CSV = [
  'name,agency,role,email,personaHandle,signInName',
  'Riley Chen,Fulco Fire,Captain,,,',
  'Sam Ortiz,Fulco EM,Liaison,,@FulcoEM,',
  'Bad Persona,Fulco EM,,,NoSuchOrg,',
].join('\n')

function csv(text: string, name = 'roster.csv', type = 'text/csv') {
  return new File([text], name, { type })
}

async function renderPanel() {
  const queryClient = makeQueryClient()
  renderWithProviders(<RosterImportPanel />, { queryClient })
  const input = await screen.findByTestId('roster-import-file-input')
  return { queryClient, input, user: setupUser() }
}

function pick(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  resetRosterMocks()
  importSpy.mockClear()
})

describe('RosterImportPanel — structure', () => {
  it('is a labelled region with a labelled file input, Validate, Import and a template link', async () => {
    await renderPanel()
    expect(screen.getByRole('region', { name: 'Import a CSV roster' })).toBeInTheDocument()
    expect(screen.getByLabelText('Choose a CSV roster file')).toHaveAttribute('accept', '.csv,text/csv')
    expect(screen.getByRole('button', { name: 'Validate' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it('offers a client-generated template link with exactly the frozen header', async () => {
    await renderPanel()
    const link = screen.getByRole('link', { name: /download template/i })
    expect(link).toHaveAttribute('download', 'roster-template.csv')
    const href = link.getAttribute('href') ?? ''
    expect(href.startsWith('data:text/csv')).toBe(true)
    expect(decodeURIComponent(href.split(',')[1] ?? '').trim())
      .toBe('name,agency,role,email,personaHandle,signInName')
  })

  it('explains how the file is read, including the derivation and matching rules', async () => {
    const { user } = await renderPanel()
    const rules = screen.getByTestId('roster-import-rules')
    await user.click(within(rules).getByText('How the file is read'))
    expect(rules).toHaveTextContent('jsmith')
    expect(rules).toHaveTextContent('jsmith2')
    expect(rules).toHaveTextContent(/never changed/i)
    expect(rules).toHaveTextContent(/new citizen persona/i)
    expect(rules).toHaveTextContent(/blank cell never erases/i)
    expect(rules).toHaveTextContent(/by sign-in name, then email, then name plus agency/i)
  })

  it('states the amended contract rules (story 10 Gate-1 W4 + W5) in plain words', async () => {
    const { user } = await renderPanel()
    const rules = screen.getByTestId('roster-import-rules')
    await user.click(within(rules).getByText('How the file is read'))

    // Derived names step around persona handles too.
    expect(rules).toHaveTextContent(/by a persona handle/i)
    // An explicit name: invalid, equal to a persona handle, or taken (an earlier row or a
    // non-roster account).
    expect(rules).toHaveTextContent(/never changed: that row fails/i)
    expect(rules).toHaveTextContent(/equals a persona handle/i)
    expect(rules).toHaveTextContent(/earlier row or by an account that is not on this roster/i)
    // The public handle is never a sign-in name.
    expect(rules).toHaveTextContent('madonna')
    expect(rules).toHaveTextContent('@madonna_2')
    // The cascade, and what makes a row fail rather than guess.
    expect(rules).toHaveTextContent(/before the file/i)
    expect(rules).toHaveTextContent(/filling in a blank\s+email or sign-in name/i)
    expect(rules).toHaveTextContent(/two\s+different people match one row/i)
    expect(rules).toHaveTextContent(/someone with a different email/i)
    expect(rules).toHaveTextContent(/never update each other/i)
    expect(rules).toHaveTextContent(/duplicate of the first/i)
  })

  it('states the Gate-2 rules in plain words: ambiguity, the same-file guards, personas, notes, CSV', async () => {
    const { user } = await renderPanel()
    const rules = screen.getByTestId('roster-import-rules')
    await user.click(within(rules).getByText('How the file is read'))

    // A key that names more than one person fails rather than guess.
    expect(rules).toHaveTextContent(/more than one person already on the roster/i)
    expect(rules).toHaveTextContent(/matches more than one person on the roster/i)
    expect(rules).toHaveTextContent(/add a sign-in name to say\s+which one you mean/i)
    // Guard (2): a name-only row beside a keyed row of the same name and agency.
    expect(rules).toHaveTextContent(/same name and agency as row N/)
    expect(rules).toHaveTextContent(/add a\s+sign-in name or email to the plain row/i)
    // Guard (4): one email per file.
    expect(rules).toHaveTextContent(/email\s+also on row N/)
    expect(rules).toHaveTextContent(/never end up sharing an address/i)
    // Guards (1) and (3): two rows reaching one person; the earlier row counts even if it failed.
    expect(rules).toHaveTextContent(/duplicate of row N \(same\s+person\)/)
    expect(rules).toHaveTextContent(/earlier row counts even if it failed/i)
    // A person with no persona gets one; a lost persona is re-created.
    expect(rules).toHaveTextContent(/people with no persona get one/i)
    expect(rules).toHaveTextContent(/persona\s+created/)
    expect(rules).toHaveTextContent(/persona re-created/)
    // An unused sign-in name is ignored, and the row says so.
    expect(rules).toHaveTextContent(/that person keeps\s+the sign-in name they already have/i)
    expect(rules).toHaveTextContent(/signInName .* ignored: this person signs in as/)
    // A newline inside a quoted cell is not supported.
    expect(rules).toHaveTextContent(/line break inside a quoted cell is not\s+supported/i)
    expect(rules).toHaveTextContent(/plain CSV/)
  })
})

describe('RosterImportPanel — pre-upload checks (the server\'s wording)', () => {
  it('rejects a non-CSV without calling the server, and keeps both buttons off', async () => {
    const { input } = await renderPanel()
    pick(input, csv('x', 'roster.pdf', 'application/pdf'))

    const alert = screen.getByTestId('roster-import-client-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('The uploaded file must be a CSV (text/csv or a .csv file).')
    expect(screen.getByRole('button', { name: 'Validate' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(importSpy).not.toHaveBeenCalled()
  })

  it('rejects a file over 1 MB with the server\'s sentence', async () => {
    const { input } = await renderPanel()
    pick(input, csv('x'.repeat(1024 * 1024 + 1)))

    expect(screen.getByTestId('roster-import-client-error'))
      .toHaveTextContent('The CSV file exceeds the maximum size of 1048576 bytes.')
    expect(screen.getByRole('button', { name: 'Validate' })).toBeDisabled()
  })

  it('rejects an empty file', async () => {
    const { input } = await renderPanel()
    pick(input, csv(''))
    expect(screen.getByTestId('roster-import-client-error')).toHaveTextContent('A non-empty CSV file is required.')
  })

  it('accepts a good file, names it, and enables both buttons', async () => {
    const { input } = await renderPanel()
    pick(input, csv(GOOD_CSV))

    expect(screen.getByTestId('roster-import-file-name')).toHaveTextContent('roster.csv')
    expect(screen.queryByTestId('roster-import-client-error')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Validate' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
  })
})

describe('RosterImportPanel — Validate vs Import', () => {
  it('Validate sends dryRun=true, writes nothing, and says so', async () => {
    const { queryClient, input, user } = await renderPanel()
    queryClient.setQueryData(rosterQueryKey('ex-mock-0001'), { participants: [] })
    const before = getRosterMockEntries()
    const file = csv(GOOD_CSV)
    pick(input, file)

    await user.click(screen.getByRole('button', { name: 'Validate' }))

    const status = await screen.findByTestId('roster-import-status')
    await waitFor(() => expect(status).toHaveTextContent(/Validated 3 rows/))
    expect(status).toHaveTextContent('2 would be created')
    expect(status).toHaveTextContent('1 failed')
    expect(status).toHaveTextContent('Nothing was written.')
    expect(status).toHaveAttribute('aria-live', 'polite')

    expect(importSpy).toHaveBeenCalledTimes(1)
    expect(importSpy).toHaveBeenCalledWith(file, { dryRun: true })
    expect(getRosterMockEntries()).toEqual(before)
    // A dry run changes nothing, so the roster is NOT refetched.
    expect(queryClient.getQueryState(rosterQueryKey('ex-mock-0001'))?.isInvalidated).toBe(false)
  })

  it('keeps the chosen file after a validate, so Import needs no second pick', async () => {
    const { input, user } = await renderPanel()
    const file = csv(GOOD_CSV)
    pick(input, file)
    await user.click(screen.getByRole('button', { name: 'Validate' }))
    await screen.findByText(/Validated 3 rows/)

    expect(screen.getByTestId('roster-import-file-name')).toHaveTextContent('roster.csv')
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText(/Imported 3 rows/)
    expect(importSpy).toHaveBeenCalledTimes(2)
    expect(importSpy).toHaveBeenLastCalledWith(file, { dryRun: false })
  })

  it('Import sends dryRun=false, writes the valid rows, and refetches the roster', async () => {
    const { queryClient, input, user } = await renderPanel()
    queryClient.setQueryData(rosterQueryKey('ex-mock-0001'), { participants: [] })
    pick(input, csv(GOOD_CSV))

    await user.click(screen.getByRole('button', { name: 'Import' }))

    const status = await screen.findByTestId('roster-import-status')
    await waitFor(() => expect(status).toHaveTextContent('Imported 3 rows: 2 created'))
    expect(status).not.toHaveTextContent('Nothing was written')
    expect(getRosterMockEntries().map(e => e.signInName)).toEqual(expect.arrayContaining(['rchen', 'sortiz']))
    expect(queryClient.getQueryState(rosterQueryKey('ex-mock-0001'))?.isInvalidated).toBe(true)
  })

  it('uploading the same file again reports everything valid as unchanged', async () => {
    const { input, user } = await renderPanel()
    pick(input, csv(GOOD_CSV))
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText(/Imported 3 rows: 2 created/)

    await user.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText(/Imported 3 rows: 0 created, 0 updated, 2 unchanged, 1 failed/)
  })

  it('a new pick clears the previous result so it never sits against another file', async () => {
    const { input, user } = await renderPanel()
    pick(input, csv(GOOD_CSV))
    await user.click(screen.getByRole('button', { name: 'Validate' }))
    await screen.findByTestId('roster-import-rows')

    pick(input, csv('name\nOther Person', 'other.csv'))

    expect(screen.queryByTestId('roster-import-rows')).not.toBeInTheDocument()
    expect(screen.getByTestId('roster-import-status')).toBeEmptyDOMElement()
    expect(screen.getByTestId('roster-import-file-name')).toHaveTextContent('other.csv')
  })
})

describe('RosterImportPanel — the per-row result', () => {
  it('shows row, name, sign-in name, status (text + icon), persona and message', async () => {
    const { input, user } = await renderPanel()
    pick(input, csv(GOOD_CSV))
    await user.click(screen.getByRole('button', { name: 'Validate' }))
    const table = await screen.findByTestId('roster-import-rows')

    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual([
      'Row', 'Name', 'Sign-in name', 'Status', 'Persona', 'Message',
    ])
    for (const header of within(table).getAllByRole('columnheader')) {
      expect(header).toHaveAttribute('scope', 'col')
    }

    const riley = screen.getByTestId('roster-import-row-1')
    expect(riley).toHaveTextContent('Riley Chen')
    expect(riley).toHaveTextContent('rchen')
    expect(riley).toHaveTextContent('@riley_chen')
    expect(riley).toHaveTextContent('Citizen persona would be created')
    expect(within(riley).getByTestId('import-status-created')).toHaveTextContent('Would create')

    // The org-bound row binds an existing persona: no "new persona" line.
    const sam = screen.getByTestId('roster-import-row-2')
    expect(sam).toHaveTextContent('@FulcoEM')
    expect(sam).not.toHaveTextContent('Citizen persona')

    // The failed row carries its reason.
    const bad = screen.getByTestId('roster-import-row-3')
    expect(within(bad).getByTestId('import-status-failed')).toHaveTextContent('Failed')
    expect(bad).toHaveTextContent('personaHandle must name an organization persona')
  })

  it('every status is an icon AND a word (never colour alone)', async () => {
    const { input, user } = await renderPanel()
    // created + updated + unchanged + failed in one upload
    pick(input, csv([
      'name,agency,signInName',
      'New Person,Fulco,newperson',
      'Dana Whitfield-Reyes,,dwhitfield',
      'Marcus Oyelaran,Fulco County Health,moyelaran',
      'Bad,,x',
    ].join('\n')))
    await user.click(screen.getByRole('button', { name: 'Validate' }))
    await screen.findByTestId('roster-import-rows')

    const expected = {
      created: 'Would create',
      updated: 'Would update',
      unchanged: 'Unchanged',
      failed: 'Failed',
    } as const
    for (const [status, word] of Object.entries(expected)) {
      const badge = screen.getByTestId(`import-status-${status}`)
      expect(badge).toHaveTextContent(word)
      expect(badge.querySelector('svg')).not.toBeNull()
      expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('after a real import the words are in the past tense', async () => {
    const { input, user } = await renderPanel()
    pick(input, csv(GOOD_CSV))
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByTestId('roster-import-rows')

    expect(screen.getAllByTestId('import-status-created')[0]).toHaveTextContent('Created')
    expect(screen.getByTestId('roster-import-row-1')).toHaveTextContent('New citizen persona')
  })
})

describe('RosterImportPanel — a 400', () => {
  it('shows the server\'s reason in a role="alert" and no result', async () => {
    const { input, user } = await renderPanel()
    pick(input, csv('agency,role\nFulco,Liaison'))

    await user.click(screen.getByRole('button', { name: 'Import' }))

    const alert = await screen.findByTestId('roster-import-server-error')
    expect(alert).toHaveAttribute('role', 'alert')
    // The server's exact sentence (RosterCsvParser.NoNameColumnError), alias included.
    expect(alert).toHaveTextContent(
      'The file could not be imported: the CSV header must include a "name" column (or its alias "displayName").',
    )
    expect(screen.queryByTestId('roster-import-rows')).not.toBeInTheDocument()
  })

  it('a 403 says the user has no access to import', async () => {
    importSpy.mockRejectedValueOnce(new rosterService.RosterError('x', { status: 403 }))
    const { input, user } = await renderPanel()
    pick(input, csv(GOOD_CSV))
    await user.click(screen.getByRole('button', { name: 'Validate' }))

    expect(await screen.findByTestId('roster-import-server-error'))
      .toHaveTextContent('You don\'t have access to import a roster.')
  })

  it('a network failure says so', async () => {
    importSpy.mockRejectedValueOnce(new rosterService.RosterError('x'))
    const { input, user } = await renderPanel()
    pick(input, csv(GOOD_CSV))
    await user.click(screen.getByRole('button', { name: 'Import' }))

    expect(await screen.findByTestId('roster-import-server-error')).toHaveTextContent(/could not reach the server/i)
  })
})

describe('RosterImportPanel — one request at a time (Gate-1 W3)', () => {
  const RESULT = {
    dryRun: true,
    totalRows: 1,
    createdCount: 1,
    updatedCount: 0,
    unchangedCount: 0,
    failedCount: 0,
    rows: [{ rowNumber: 1, name: 'Riley Chen', status: 'created' as const, personaCreated: true }],
  }

  it('disables the file picker (button and input) while a request is pending, and ignores a swap', async () => {
    const gate = deferred<typeof RESULT>()
    importSpy.mockReturnValueOnce(gate.promise)
    const { input, user } = await renderPanel()
    pick(input, csv(GOOD_CSV))

    await user.click(screen.getByRole('button', { name: 'Validate' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose CSV file' })).toBeDisabled())
    expect(input).toBeDisabled()
    // A change event that still arrives is ignored: the file (and the pending result) stay.
    pick(input, csv('name\nOther Person', 'other.csv'))
    expect(screen.getByTestId('roster-import-file-name')).toHaveTextContent('roster.csv')

    gate.resolve(RESULT)
    await screen.findByText(/Validated 1 row/)
    expect(screen.getByRole('button', { name: 'Choose CSV file' })).toBeEnabled()
    expect(input).toBeEnabled()
  })

  it('a double click on Import uploads ONCE', async () => {
    const gate = deferred<typeof RESULT>()
    importSpy.mockReturnValueOnce(gate.promise)
    const { input } = await renderPanel()
    pick(input, csv(GOOD_CSV))
    const button = screen.getByRole('button', { name: 'Import' })

    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(importSpy).toHaveBeenCalledTimes(1))
    gate.resolve({ ...RESULT, dryRun: false })
    await screen.findByText(/Imported 1 row/)
    expect(importSpy).toHaveBeenCalledTimes(1)
  })

  it('releases the guard after a failure, so a retry uploads again', async () => {
    importSpy.mockRejectedValueOnce(new rosterService.RosterError('x', { status: 500 }))
    const { input, user } = await renderPanel()
    pick(input, csv(GOOD_CSV))
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByTestId('roster-import-server-error')

    await user.click(screen.getByRole('button', { name: 'Import' }))

    await screen.findByText(/Imported 3 rows/)
    expect(importSpy).toHaveBeenCalledTimes(2)
  })
})

/**
 * features/participantAdmin/mocks/rosterMocks.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 10 — the mock adapter FOLLOWS THE FROZEN CONTRACT. It is
 * exercised through the real service (so the request shape is the live call's)
 * with `USE_MOCK_DATA` on, as under Vitest. The mock is the screen's only
 * backend until story 02/03 deploy, so what it promises is pinned here:
 * the seeded states, dry-run-writes-nothing, idempotent re-upload, the
 * derivation rules, org-persona binding, the actions and the 403 switch.
 *
 * ## Pinned against the SERVER's own examples (Gate-2 W-4)
 * The mock must behave exactly like the real roster, or the screen's explainer and
 * the staff's dev experience drift from production. The later describes port the
 * cases of `src/Pulse.WebApi.Tests/Features/Identity/Roster/RosterWorkspaceTests.cs`
 * (same seed, same rows, same expected statuses and the server's exact messages), so
 * the two suites are pinned to the same examples. Each describe below, and the server rule
 * it mirrors (`RosterWorkspace.cs` unless noted):
 *
 *   validation comes first ......... ApplyFileRow: Validate, THEN record the file key
 *   guard (2): name + agency only .. ApplyFile pre-scan `keyedNameAgency`
 *   guard (4): one email per file .. ApplyFileRow `_emailsInFile`, before the first-key check
 *   guards (1) + (3): same person .. ApplyCore `_matchedInFile` + `Reach`
 *   a key matching >1 person ....... ApplyCore `primaryMatches.Count > 1`
 *   a later key conflicts only ..... ApplyCore `matches.Any(m => m.Id == matched.Id)`
 *   a person with no persona ....... Update: `org is null && current.Persona is null`
 *   persona re-created ............. Update: `HadUnresolvedPersona`
 *   the "ignored" note ............. Update: `note` (also on `unchanged`)
 *   org rebind + message format .... Update: persona id differs OR role is not pio; `parts`
 *   the exact error strings ........ RosterCsvParser.cs, RosterRowRules.cs
 *   the email shape ................ RosterRowRules.EmailPattern
 *   the ASCII fold ................. SignInNameDeriver.AsciiFold (non-spacing marks only)
 *   CSV reading .................... RosterCsvParser.cs over AccountCsvParser.cs
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  RosterError,
  addParticipant,
  disableParticipant,
  enableParticipant,
  getRoster,
  importRoster,
  reissueLink,
  revokeLink,
} from '../services/rosterService'
import type { RosterEntryDto, RosterImportResultDto } from '../types'
import {
  MOCK_UNRESOLVED_PERSONA_PERSON_ID,
  addRosterMockEntry,
  addRosterMockUnresolvedPersonaPerson,
  deriveAutoPersonaHandle,
  deriveSignInName,
  getRosterMockEntries,
  resetRosterMocks,
  setRosterMockAccess,
  setRosterMockJoinLinksAvailable,
} from './rosterMocks'

const csv = (text: string, name = 'roster.csv') => new File([text], name, { type: 'text/csv' })

async function failure(promise: Promise<unknown>): Promise<RosterError> {
  const error = await promise.then(() => undefined, (e: unknown) => e)
  expect(error).toBeInstanceOf(RosterError)
  return error as RosterError
}

/** A participant's join URL, read from the LIST (the only place it is returned). */
async function urlOf(id: string): Promise<string | undefined> {
  return (await getRoster()).participants.find(p => p.id === id)?.link.joinUrl
}

beforeEach(() => {
  resetRosterMocks()
})

describe('seed data covers every state the screen renders', () => {
  it('has a needsReissue row, a none-link row, a revoked row, a disabled row and an org persona', async () => {
    const { participants, joinLinksAvailable, capabilities } = await getRoster()
    expect(joinLinksAvailable).toBe(true)
    expect(capabilities.emailLinks).toBe(false)

    expect(participants.some(p => p.link.status === 'active' && p.link.needsReissue === true)).toBe(true)
    expect(participants.some(p => p.link.status === 'none')).toBe(true)
    expect(participants.some(p => p.link.status === 'revoked')).toBe(true)
    expect(participants.some(p => p.access === 'disabled')).toBe(true)
    expect(participants.some(p => p.persona?.kind === 'org')).toBe(true)
    expect(participants.some(p => p.persona?.autoCreated === true)).toBe(true)
    expect(participants.some(p => p.persona === undefined)).toBe(true)
    expect(participants.some(p => p.lastSignInAt === undefined)).toBe(true)
  })

  it('an active, recoverable link carries a joinUrl; a needsReissue link does not', async () => {
    const { participants } = await getRoster()
    const recoverable = participants.filter(p => p.link.status === 'active' && !p.link.needsReissue)
    expect(recoverable.length).toBeGreaterThan(0)
    for (const p of recoverable) {
      expect(p.link.joinUrl).toMatch(/^https:\/\/pulse\.example\.test\/join\//)
    }
    for (const p of participants.filter(q => q.link.needsReissue)) {
      expect(p.link.joinUrl).toBeUndefined()
    }
  })

  it('optional fields are omitted, never null', async () => {
    const { participants } = await getRoster()
    expect(JSON.stringify(participants)).not.toContain(':null')
  })
})

describe('the switches', () => {
  it('the 403 switch makes every call a 403', async () => {
    setRosterMockAccess('forbidden')
    expect((await failure(getRoster())).status).toBe(403)
    expect((await failure(addParticipant({ name: 'X Y' }))).status).toBe(403)
    expect((await failure(importRoster(csv('name\nX Y'), { dryRun: true }))).status).toBe(403)
    expect((await failure(disableParticipant('mock-acct-001'))).status).toBe(403)

    setRosterMockAccess('allowed')
    await expect(getRoster()).resolves.toBeDefined()
  })

  it('joinLinksAvailable:false removes every joinUrl and reports the flag', async () => {
    setRosterMockJoinLinksAvailable(false)
    const { participants, joinLinksAvailable } = await getRoster()
    expect(joinLinksAvailable).toBe(false)
    expect(participants.every(p => p.link.joinUrl === undefined)).toBe(true)

    const added = await addParticipant({ name: 'New Person' })
    expect(added.link.status).toBe('active')
    expect(await urlOf(added.id)).toBeUndefined()
  })
})

describe('the frozen derivation rules', () => {
  const none = new Set<string>()

  it.each([
    ['Jane Smith', 'jsmith'],
    ['Mary-Ann O\'Neil', 'moneil'],
    ['José Álvarez', 'jalvarez'],
    ['Madonna', 'madonna'],
    ['Ng', 'ng1'],
    ['John Smith Jr', 'jsmith'],
    ['Alexander Hamilton III', 'ahamilton'],
    ['Dr. Pat Lee MD', 'dlee'],
  ])('derives %s -> %s', (name, expected) => {
    expect(deriveSignInName(name, none)).toBe(expected)
  })

  it('adds the smallest free integer from 2 on a collision', () => {
    expect(deriveSignInName('Jane Smith', new Set(['jsmith']))).toBe('jsmith2')
    expect(deriveSignInName('Jane Smith', new Set(['jsmith', 'jsmith2']))).toBe('jsmith3')
    expect(deriveSignInName('Jane Smith', new Set(['jsmith', 'jsmith3']))).toBe('jsmith2')
  })

  it('caps a derived name at 32 characters', () => {
    expect(deriveSignInName(`A ${'b'.repeat(60)}`, none)).toHaveLength(32)
  })

  it('slugs the auto persona handle to [a-z0-9_], max 30, with _2 on collision', () => {
    expect(deriveAutoPersonaHandle('Jane Smith', none)).toBe('jane_smith')
    expect(deriveAutoPersonaHandle('José Álvarez', none)).toBe('jose_alvarez')
    expect(deriveAutoPersonaHandle('Jane Smith', new Set(['jane_smith']))).toBe('jane_smith_2')
    expect(deriveAutoPersonaHandle('Jane Smith', new Set(['jane_smith', 'jane_smith_2']))).toBe('jane_smith_3')
    expect(deriveAutoPersonaHandle('x'.repeat(50), none)).toHaveLength(30)
  })
})

describe('POST /staff/roster (add one)', () => {
  it('creates a participant with a derived sign-in name, an auto persona and an active link', async () => {
    const created = await addParticipant({ name: 'Riley Chen', agency: 'Fulco Fire' })
    expect(created).toMatchObject({
      name: 'Riley Chen',
      agency: 'Fulco Fire',
      signInName: 'rchen',
      exerciseRole: 'participant',
      access: 'enabled',
      liveSessions: 0,
      persona: { handle: 'riley_chen', kind: 'human', autoCreated: true },
      link: { status: 'active' },
    })
    // The service drops the URL from the add result; the LIST carries it.
    expect(created.link.joinUrl).toBeUndefined()
    expect(await urlOf(created.id)).toMatch(/^https:\/\/pulse\.example\.test\/join\//)
  })

  it('binds an org persona (case-insensitive, @ tolerated) and makes the account a pio', async () => {
    const created = await addParticipant({ name: 'Sam Ortiz', personaHandle: '@fulcoem' })
    expect(created.exerciseRole).toBe('pio')
    expect(created.persona).toMatchObject({ handle: 'FulcoEM', kind: 'org', autoCreated: false })
  })

  it('answers 400 for an invalid field, with a readable reason', async () => {
    expect((await failure(addParticipant({ name: '   ' }))).serverMessage).toMatch(/name is required/)
    expect((await failure(addParticipant({ name: 'A B', email: 'nope' }))).status).toBe(400)
    expect((await failure(addParticipant({ name: 'A B', signInName: 'x' }))).serverMessage)
      .toMatch(/3 to 32/)
  })

  it('answers 400 for an unknown or non-org persona handle, with the SAME message', async () => {
    const unknown = await failure(addParticipant({ name: 'A B', personaHandle: 'NoSuchOrg' }))
    const seededCitizen = await failure(addParticipant({ name: 'C D', personaHandle: 'jpike_utilities' }))
    expect(unknown.status).toBe(400)
    expect(seededCitizen.serverMessage).toBe(unknown.serverMessage)
  })

  it('answers 409 when the key is already on the roster (sign-in name, email, or name + agency)', async () => {
    expect((await failure(addParticipant({ name: 'Someone Else', signInName: 'DWhitfield' }))).status).toBe(409)
    expect((await failure(addParticipant({ name: 'Someone Else', email: 'DANA.whitfield@example.test' }))).status).toBe(409)
    const byName = await failure(addParticipant({ name: ' dana  whitfield', agency: 'fulco county em' }))
    expect(byName.status).toBe(409)
    expect(byName.serverMessage).toMatch(/already on the roster/)
  })

  it('strips markup from the name on ingest (NFR-004)', async () => {
    const created = await addParticipant({ name: 'Eve <script>alert(1)</script>Adams' })
    expect(created.name).not.toContain('<')
    expect(created.name).toContain('Eve')
  })
})

describe('POST /staff/roster/import', () => {
  const FILE = [
    'name,agency,role,email,personaHandle,signInName',
    'Riley Chen,Fulco Fire,Captain,riley@example.test,,',
    'Sam Ortiz,Fulco EM,Liaison,,@FulcoEM,',
    'Taylor Reed,,,,,',
    'Bad Persona,Fulco EM,,,NoSuchOrg,',
  ].join('\n')

  it('a dry run reports per row and writes NOTHING', async () => {
    const before = getRosterMockEntries()
    const result = await importRoster(csv(FILE), { dryRun: true })

    expect(result).toMatchObject({
      dryRun: true,
      totalRows: 4,
      createdCount: 3,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 1,
    })
    expect(getRosterMockEntries()).toEqual(before)
  })

  it('a real import creates the valid rows, fails the bad one, and the list shows it', async () => {
    const result = await importRoster(csv(FILE), { dryRun: false })
    expect(result.dryRun).toBe(false)
    expect(result.createdCount).toBe(3)

    const failed = result.rows.find(r => r.status === 'failed')
    expect(failed).toMatchObject({ rowNumber: 4, name: 'Bad Persona', personaCreated: false })
    expect(failed?.message).toMatch(/organization persona/)

    const sam = result.rows[1]
    expect(sam).toMatchObject({ status: 'created', personaHandle: 'FulcoEM', personaCreated: false })
    expect(result.rows[0]).toMatchObject({ signInName: 'rchen', personaHandle: 'riley_chen', personaCreated: true })

    const { participants } = await getRoster()
    expect(participants.map(p => p.signInName)).toEqual(expect.arrayContaining(['rchen', 'sortiz', 'treed']))
    expect(participants.find(p => p.signInName === 'sortiz')?.exerciseRole).toBe('pio')
  })

  it('re-uploading the same file is idempotent: every valid row is `unchanged`', async () => {
    await importRoster(csv(FILE), { dryRun: false })
    const countAfterFirst = (await getRoster()).participants.length

    const again = await importRoster(csv(FILE), { dryRun: false })
    expect(again.createdCount).toBe(0)
    expect(again.unchangedCount).toBe(3)
    expect(again.failedCount).toBe(1)
    expect((await getRoster()).participants).toHaveLength(countAfterFirst)
  })

  it('a changed agency/role/persona is `updated` and says what changed; a blank cell never clears', async () => {
    await importRoster(csv(FILE), { dryRun: false })
    const changed = [
      'name,agency,role,email,personaHandle,signInName',
      'Riley Chen,Fulco Fire Dept,,riley@example.test,,',
      'Sam Ortiz,,,,,sortiz',
    ].join('\n')

    const result = await importRoster(csv(changed), { dryRun: false })
    expect(result.rows[0]).toMatchObject({ status: 'updated' })
    expect(result.rows[0]?.message).toMatch(/agency/)
    // Sam's row is blank apart from the key: nothing to change, nothing cleared.
    expect(result.rows[1]).toMatchObject({ status: 'unchanged' })

    const { participants } = await getRoster()
    const riley = participants.find(p => p.signInName === 'rchen')
    expect(riley?.agency).toBe('Fulco Fire Dept')
    expect(riley?.role).toBe('Captain')
    expect(participants.find(p => p.signInName === 'sortiz')?.persona?.handle).toBe('FulcoEM')
  })

  it('binding an org persona on re-upload updates the row and makes it a pio', async () => {
    await importRoster(csv(FILE), { dryRun: false })

    const bySignIn = await importRoster(
      csv('name,signInName,personaHandle\nRiley Chen,rchen,FulcoPIO'),
      { dryRun: false },
    )
    expect(bySignIn.rows[0]).toMatchObject({ status: 'updated', personaHandle: 'FulcoPIO' })
    expect(bySignIn.rows[0]?.message).toMatch(/persona bound to @FulcoPIO/)
    expect((await getRoster()).participants.find(p => p.signInName === 'rchen')?.exerciseRole)
      .toBe('pio')
  })

  it('derives collision suffixes against existing accounts AND earlier rows in the same file', async () => {
    const result = await importRoster(
      csv('name,agency\nJane Smith,A\nJohn Smith,B\nJoan Smith,C'),
      { dryRun: false },
    )
    expect(result.rows.map(r => r.signInName)).toEqual(['jsmith', 'jsmith2', 'jsmith3'])
    expect(result.rows.map(r => r.personaHandle)).toEqual(['jane_smith', 'john_smith', 'joan_smith'])
  })

  it('an explicit signInName is never altered: an invalid one fails the row, a valid one is kept', async () => {
    const result = await importRoster(
      csv('name,signInName\nB Two,x\nC Three,CThree'),
      { dryRun: true },
    )
    expect(result.rows[0]).toMatchObject({ status: 'failed' })
    expect(result.rows[0]?.message).toMatch(/3 to 32/)
    expect(result.rows[1]).toMatchObject({ status: 'created', signInName: 'cthree' })
  })

  it('an explicit signInName that is already on the roster MATCHES that person (identity key)', async () => {
    const result = await importRoster(
      csv('name,signInName\nDana Whitfield-Reyes,dwhitfield'),
      { dryRun: true },
    )
    expect(result.rows[0]).toMatchObject({ status: 'updated', signInName: 'dwhitfield' })
    expect(result.rows[0]?.message).toMatch(/name/)
  })

  it('fails the later of two rows with the same key, naming the earlier row', async () => {
    const result = await importRoster(
      csv('name,agency\nJane Smith,A\nJane Smith,A'),
      { dryRun: true },
    )
    expect(result.rows[0]?.status).toBe('created')
    expect(result.rows[1]).toMatchObject({ status: 'failed' })
    expect(result.rows[1]?.message).toBe('duplicate of row 1; give a signInName to tell them apart')
  })

  it('accepts the legacy aliases (displayName, username), a BOM, quotes and blank lines', async () => {
    const text = '﻿displayName,username,Agency\n\n"Smith, Jane",jsmith7,"Fulco ""EM"""\n'
    const result = await importRoster(csv(text), { dryRun: false })
    expect(result.rows[0]).toMatchObject({ name: 'Smith, Jane', signInName: 'jsmith7', status: 'created' })
    const added = (await getRoster()).participants.find(p => p.signInName === 'jsmith7')
    expect(added?.agency).toBe('Fulco "EM"')
  })

  it('400s a file with no name column, a non-CSV, and an empty file', async () => {
    const noName = await failure(importRoster(csv('agency\nFulco'), { dryRun: true }))
    expect(noName.status).toBe(400)
    // The server's exact sentence (RosterCsvParser.NoNameColumnError), alias included.
    expect(noName.serverMessage)
      .toBe('the CSV header must include a "name" column (or its alias "displayName").')

    const notCsv = await failure(
      importRoster(new File(['x'], 'roster.pdf', { type: 'application/pdf' }), { dryRun: true }),
    )
    expect(notCsv.serverMessage).toMatch(/must be a CSV/)

    const empty = await failure(importRoster(csv(''), { dryRun: true }))
    expect(empty.status).toBe(400)
  })

  it('a header-only file is a valid empty import', async () => {
    const result = await importRoster(csv('name,agency\n'), { dryRun: true })
    expect(result.totalRows).toBe(0)
    expect(result.rows).toEqual([])
  })
})

describe('the four actions', () => {
  it('reissue replaces the link (new URL), ends sessions, and the list reflects it', async () => {
    const before = (await getRoster()).participants.find(p => p.id === 'mock-acct-002')
    expect(before?.liveSessions).toBe(2)

    const result = await reissueLink('mock-acct-002')
    expect(result.sessionsEnded).toBe(2)
    expect(result.link.status).toBe('active')
    // No URL in the action result (it would sit in the mutation cache); the list has it.
    expect(result.link.joinUrl).toBeUndefined()

    const after = (await getRoster()).participants.find(p => p.id === 'mock-acct-002')
    expect(after?.liveSessions).toBe(0)
    expect(after?.link.joinUrl).toBeDefined()
    expect(after?.link.joinUrl).not.toBe(before?.link.joinUrl)
  })

  it('reissue clears needsReissue and issues a first link to a `none` row', async () => {
    const fixed = await reissueLink('mock-acct-004')
    expect(fixed.link.needsReissue).toBeUndefined()
    expect(await urlOf('mock-acct-004')).toBeDefined()

    const first = await reissueLink('mock-acct-003')
    expect(first.link.status).toBe('active')
    expect(first.sessionsEnded).toBe(0)
  })

  it('revoke ends sessions, marks the link revoked and removes the URL', async () => {
    const result = await revokeLink('mock-acct-001')
    expect(result.sessionsEnded).toBe(1)
    expect(result.link.status).toBe('revoked')
    expect(result.link.joinUrl).toBeUndefined()
    expect(result.link.revokedAt).toBeDefined()
    expect(result.access).toBe('enabled')
  })

  it('disable ends sessions and flips access; enable flips it back without ending anything', async () => {
    const disabled = await disableParticipant('mock-acct-002')
    expect(disabled).toMatchObject({ access: 'disabled', sessionsEnded: 2 })

    const enabled = await enableParticipant('mock-acct-002')
    expect(enabled).toMatchObject({ access: 'enabled', sessionsEnded: 0 })
  })

  it('an unknown id is a 404 (a cross-exercise id looks exactly the same)', async () => {
    for (const run of [reissueLink, revokeLink, disableParticipant, enableParticipant]) {
      expect((await failure(run('not-a-real-id'))).status).toBe(404)
    }
  })
})

// ---------------------------------------------------------------------------
// The amended derivation + matching rules (implementation.md at 34c6c80;
// story 10 Gate-1 W4 + W5). The mock must reproduce them exactly: the screen's
// explainer promises them, and the live server (story 02) is built to them.
// ---------------------------------------------------------------------------

describe('the identity key CASCADES: signInName, then email, then name + agency', () => {
  it('a row with an unknown signInName but a known email matches by email (never duplicated)', async () => {
    const before = (await getRoster()).participants.length
    const result = await importRoster(
      csv('name,email,signInName\nDana Whitfield,dana.whitfield@example.test,dana.w'),
      { dryRun: false },
    )

    expect(result.rows[0]).toMatchObject({ status: 'unchanged', signInName: 'dwhitfield' })
    const { participants } = await getRoster()
    expect(participants).toHaveLength(before)
    // The matched person's sign-in name is NOT changed by the row.
    expect(participants.find(p => p.id === 'mock-acct-001')?.signInName).toBe('dwhitfield')
  })

  it('a row with an unknown signInName but a known name + agency matches that person', async () => {
    const before = (await getRoster()).participants.length
    const result = await importRoster(
      csv('name,agency,signInName\nTom Becker,County Transportation,tom.b'),
      { dryRun: true },
    )
    expect(result.rows[0]).toMatchObject({ status: 'unchanged', signInName: 'tbecker' })
    expect((await getRoster()).participants).toHaveLength(before)
  })

  it('filling in a previously blank email and re-uploading updates the SAME person, then is unchanged', async () => {
    const before = (await getRoster()).participants.length
    const file = 'name,agency,email\nTom Becker,County Transportation,tom.becker@example.test'

    const first = await importRoster(csv(file), { dryRun: false })
    expect(first.rows[0]).toMatchObject({ status: 'updated', signInName: 'tbecker' })
    expect(first.rows[0]?.message).toMatch(/email/)

    const { participants } = await getRoster()
    expect(participants).toHaveLength(before)
    expect(participants.find(p => p.id === 'mock-acct-004')?.email).toBe('tom.becker@example.test')

    // Now the EMAIL key carries the match, and nothing is left to change.
    const second = await importRoster(csv(file), { dryRun: false })
    expect(second.rows[0]?.status).toBe('unchanged')
  })

  it('two keys matching DIFFERENT people fails the row and names both', async () => {
    const result = await importRoster(
      csv('name,email,signInName\nAnyone,dana.whitfield@example.test,moyelaran'),
      { dryRun: false },
    )
    expect(result.rows[0]).toMatchObject({ status: 'failed' })
    expect(result.rows[0]?.message)
      .toBe('signInName matches Marcus Oyelaran but email matches Dana Whitfield.')
    expect(result.createdCount + result.updatedCount).toBe(0)
  })

  it('an email matching one person and name + agency another fails the row', async () => {
    const result = await importRoster(
      csv('name,agency,email\nTom Becker,County Transportation,dana.whitfield@example.test'),
      { dryRun: true },
    )
    expect(result.rows[0]?.status).toBe('failed')
    expect(result.rows[0]?.message)
      .toBe('email matches Dana Whitfield but name and agency matches Tom Becker.')
  })

  it('a signInName match whose stored email differs from the row\'s fails (guards a typo renaming someone)', async () => {
    const before = getRosterMockEntries()
    const result = await importRoster(
      csv('name,email,signInName\nDana Whitfield-Reyes,other@example.test,dwhitfield'),
      { dryRun: false },
    )
    expect(result.rows[0]).toMatchObject({
      status: 'failed',
      message: 'signInName belongs to someone with a different email.',
    })
    expect(getRosterMockEntries()).toEqual(before)
  })

  it('…but the same email (case and spacing aside) is no conflict, and a blank stored email is filled in', async () => {
    const same = await importRoster(
      csv('name,email,signInName\nDana Whitfield, DANA.whitfield@example.test ,dwhitfield'),
      { dryRun: true },
    )
    expect(same.rows[0]?.status).toBe('unchanged')

    const filled = await importRoster(
      csv('name,email,signInName\nMarcus Oyelaran,marcus@example.test,moyelaran'),
      { dryRun: false },
    )
    expect(filled.rows[0]?.status).toBe('updated')
    expect((await getRoster()).participants.find(p => p.id === 'mock-acct-002')?.email)
      .toBe('marcus@example.test')
  })
})

describe('rows in one file never update each other', () => {
  it('a second row with the same key fails as a duplicate of the first (and updates nobody)', async () => {
    const result = await importRoster(
      csv('name,agency\nZed Zimmer,Alpha\nZed Zimmer,Alpha'),
      { dryRun: false },
    )
    expect(result.rows[0]?.status).toBe('created')
    expect(result.rows[1]).toMatchObject({
      status: 'failed',
      message: 'duplicate of row 1; give a signInName to tell them apart',
    })
    expect(result.updatedCount).toBe(0)
  })

  it('a later row whose OTHER key would match an earlier row\'s new person does not update them', async () => {
    // Row 1 creates Zed under his signInName. Row 2 carries an email, so its first key differs
    // from row 1's; matching is only against who existed BEFORE the file, so it creates a
    // second person instead of updating the first. (Both rows are keyed, so the name-only
    // guard (2) does not fire: see "guard (2)" below for when it does.)
    const result = await importRoster(
      csv('name,agency,email,signInName\nZed Zimmer,Alpha,,zed.z\nZed Zimmer,Alpha,zed@example.test,'),
      { dryRun: false },
    )
    expect(result.rows.map(r => r.status)).toEqual(['created', 'created'])
    expect(result.updatedCount).toBe(0)
    expect(result.rows.map(r => r.signInName)).toEqual(['zed.z', 'zzimmer'])
    expect((await getRoster()).participants.filter(p => p.name === 'Zed Zimmer')).toHaveLength(2)
  })

  it('a name-only row beside a keyed row of the same name and agency is refused, not created twice', async () => {
    // The shape this test used to pin as two creations. It is now guard (2): the server fails
    // the plain row so a re-upload cannot flip it onto the keyed person.
    const result = await importRoster(
      csv('name,agency,email\nZed Zimmer,Alpha,\nZed Zimmer,Alpha,zed@example.test'),
      { dryRun: false },
    )
    expect(result.rows.map(r => r.status)).toEqual(['failed', 'created'])
    expect(result.rows[0]?.message)
      .toBe('same name and agency as row 2: add a signInName or email to tell them apart')
    expect((await getRoster()).participants.filter(p => p.name === 'Zed Zimmer')).toHaveLength(1)
  })
})

describe('an explicit signInName fails when it equals a persona handle or is taken', () => {
  it('equals an organization persona handle (case-insensitive)', async () => {
    const result = await importRoster(csv('name,signInName\nA One,fulcoem'), { dryRun: true })
    expect(result.rows[0]?.status).toBe('failed')
    expect(result.rows[0]?.message).toMatch(/persona handle/)
  })

  it('equals an existing participant\'s persona handle', async () => {
    const result = await importRoster(csv('name,signInName\nA Two,marcus_oyelaran'), { dryRun: true })
    expect(result.rows[0]?.status).toBe('failed')
    expect(result.rows[0]?.message).toMatch(/persona handle/)
  })

  it('equals the auto handle an EARLIER ROW in the same file just claimed', async () => {
    const result = await importRoster(
      csv('name,signInName\nRiley Chen,\nOther Person,riley_chen'),
      { dryRun: true },
    )
    expect(result.rows[0]?.status).toBe('created')
    expect(result.rows[0]?.personaHandle).toBe('riley_chen')
    expect(result.rows[1]?.status).toBe('failed')
    expect(result.rows[1]?.message).toMatch(/persona handle/)
  })

  it('was claimed by an earlier row in the same file (even a derived one)', async () => {
    const result = await importRoster(
      csv('name,agency,signInName\nJane Smith,A,\nOther Person,B,jsmith'),
      { dryRun: true },
    )
    expect(result.rows[0]).toMatchObject({ status: 'created', signInName: 'jsmith' })
    expect(result.rows[1]?.status).toBe('failed')
    expect(result.rows[1]?.message).toMatch(/claimed by an earlier row/)
  })

  it('belongs to an account the roster does not list (a staff or legacy account)', async () => {
    const result = await importRoster(csv('name,signInName\nA One,admin'), { dryRun: true })
    expect(result.rows[0]?.status).toBe('failed')
    expect(result.rows[0]?.message).toMatch(/taken by another account/)
  })

  it('and an explicit name is never silently altered when it is fine', async () => {
    const result = await importRoster(csv('name,signInName\nA One,aone'), { dryRun: true })
    expect(result.rows[0]).toMatchObject({ status: 'created', signInName: 'aone' })
  })
})

describe('derived names and auto handles never collide with each other', () => {
  it('a DERIVED sign-in name steps around a non-roster account and around a persona handle', async () => {
    const result = await importRoster(
      csv('name,agency\nPat Lee,A\nFulcoem,B'),
      { dryRun: true },
    )
    // `plee` belongs to a legacy account; `fulcoem` is the org persona @FulcoEM.
    expect(result.rows[0]).toMatchObject({ status: 'created', signInName: 'plee2' })
    expect(result.rows[1]).toMatchObject({ status: 'created', signInName: 'fulcoem2' })
  })

  it('the auto handle never equals the row\'s OWN sign-in name: Madonna -> madonna_2', async () => {
    const result = await importRoster(csv('name\nMadonna'), { dryRun: false })
    expect(result.rows[0]).toMatchObject({
      status: 'created',
      signInName: 'madonna',
      personaHandle: 'madonna_2',
      personaCreated: true,
    })
  })

  it('the auto handle never equals ANY sign-in name in the exercise', async () => {
    // "Dwhitfield" slugs to `dwhitfield`, which is Dana's sign-in name.
    const result = await importRoster(csv('name\nDwhitfield'), { dryRun: false })
    expect(result.rows[0]).toMatchObject({
      status: 'created',
      signInName: 'dwhitfield2',
      personaHandle: 'dwhitfield_2',
    })
  })

  it('across a whole imported roster no persona handle is anyone\'s sign-in name', async () => {
    await importRoster(
      csv('name,agency\nMadonna,A\nCher,B\nDwhitfield,C\nJane Smith,D\nJane Smith,E'),
      { dryRun: false },
    )
    const { participants } = await getRoster()
    const signIns = new Set(participants.map(p => p.signInName.toLowerCase()))
    for (const p of participants) {
      if (!p.persona) continue
      expect(signIns.has(p.persona.handle.toLowerCase()), p.persona.handle).toBe(false)
    }
  })
})

describe('POST /staff/roster follows the same rules', () => {
  it('two keys matching different people is a 409', async () => {
    const error = await failure(addParticipant({
      name: 'Anyone',
      email: 'dana.whitfield@example.test',
      signInName: 'moyelaran',
    }))
    expect(error.status).toBe(409)
    expect(error.serverMessage).toBe('signInName matches Marcus Oyelaran but email matches Dana Whitfield.')
  })

  it('a signInName match with a different stored email is a 409', async () => {
    const error = await failure(addParticipant({
      name: 'Dana Whitfield',
      email: 'other@example.test',
      signInName: 'dwhitfield',
    }))
    expect(error.status).toBe(409)
    expect(error.serverMessage).toMatch(/different email/)
  })

  it('an explicit signInName equal to a persona handle is a 400', async () => {
    const error = await failure(addParticipant({ name: 'A One', signInName: 'FulcoEM' }))
    expect(error.status).toBe(400)
    expect(error.serverMessage).toMatch(/persona handle/)
  })

  it('an explicit signInName held by a non-roster account is a 409', async () => {
    expect((await failure(addParticipant({ name: 'A One', signInName: 'admin' }))).status).toBe(409)
  })

  it('a derived name and handle follow the same rules (Madonna -> madonna / madonna_2)', async () => {
    const created = await addParticipant({ name: 'Madonna' })
    expect(created.signInName).toBe('madonna')
    expect(created.persona?.handle).toBe('madonna_2')
  })
})

// ---------------------------------------------------------------------------
// Gate-2 W-4: the mock behaves EXACTLY like RosterWorkspace.cs. Everything below
// ports RosterWorkspaceTests.cs (same seed, rows and messages) or pins one item
// of the reviewer's checklist.
// ---------------------------------------------------------------------------

/** Uploads CSV text through the real service (so the request shape is the live call's). */
const upload = (text: string, dryRun = false): Promise<RosterImportResultDto> =>
  importRoster(csv(text), { dryRun })

/** `[status, message]` per row: what RosterWorkspaceTests.cs asserts across uploads. */
const outline = (result: RosterImportResultDto) =>
  result.rows.map(row => [row.status, row.message ?? null])

const byId = async (id: string): Promise<RosterEntryDto | undefined> =>
  (await getRoster()).participants.find(p => p.id === id)

const bySignIn = async (signInName: string): Promise<RosterEntryDto | undefined> =>
  (await getRoster()).participants.find(p => p.signInName === signInName)

const DANA_EMAIL = 'dana.whitfield@example.test'

/** A person the server already holds, for states the seed does not carry. */
function person(
  fields: Pick<RosterEntryDto, 'id' | 'name' | 'signInName'> & Partial<RosterEntryDto>,
): RosterEntryDto {
  return {
    exerciseRole: 'participant',
    persona: {
      id: `mock-persona-${fields.id}`,
      handle: `${fields.signInName}_persona`,
      displayName: fields.name,
      kind: 'human',
      autoCreated: true,
    },
    link: { status: 'none', useCount: 0 },
    access: 'enabled',
    liveSessions: 0,
    createdAt: '2026-09-30T15:00:00.000Z',
    ...fields,
  }
}

describe('validation comes first: a file key is recorded only after the guards pass', () => {
  it('an invalid row 1 does not make a valid row 2 with the same key "a duplicate of row 1"', async () => {
    // Before: the mock recorded row 1's key first, so row 2 failed "duplicate of row 1" while the
    // server (Validate, then the guards, then record the key) applied row 2.
    const result = await upload(`name,agency,role\nZed Zimmer,Alpha,${'r'.repeat(129)}\nZed Zimmer,Alpha,\n`)

    expect(result.rows[0]).toMatchObject({
      status: 'failed',
      message: 'role must be 128 characters or fewer.',
    })
    expect(result.rows[1]).toMatchObject({ status: 'created', signInName: 'zzimmer' })
    expect(result.rows[1]?.message).toBeUndefined()
  })

  it('an invalid row also records no email, so it cannot make a later row "email also on row 1"', async () => {
    const result = await upload(
      `name,role,email,signInName\nNew One,${'r'.repeat(129)},same@example.test,new.one\nNew Two,,same@example.test,new.two\n`,
    )
    expect(result.rows.map(r => r.status)).toEqual(['failed', 'created'])
    expect(result.rows[1]?.message).toBeUndefined()
  })

  it('an invalid row reports its field error BEFORE the name + agency guard', async () => {
    const result = await upload(
      `name,agency,role,email\nZed Zimmer,Alpha,${'r'.repeat(129)},\nZed Zimmer,Alpha,,zed@example.test\n`,
      true,
    )
    expect(result.rows[0]).toMatchObject({
      status: 'failed',
      message: 'role must be 128 characters or fewer.',
    })
  })
})

describe('guard (2): a name + agency only row fails when another row of the file is keyed to that name + agency', () => {
  const MESSAGE = 'same name and agency as row 2: add a signInName or email to tell them apart'

  it('fails on the first upload AND on every re-upload (the file never depends on which upload it is)', async () => {
    const file = 'name,agency,email\nZed Zimmer,Alpha,\nZed Zimmer,Alpha,zed@example.test\n'

    const first = await upload(file)
    expect(outline(first)[0]).toEqual(['failed', MESSAGE])
    expect(first.rows[1]).toMatchObject({ status: 'created', signInName: 'zzimmer' })

    const again = await upload(file)
    expect(outline(again)[0]).toEqual(['failed', MESSAGE])
    expect(again.rows[1]?.status).toBe('unchanged')
    expect((await getRoster()).participants.filter(p => p.name === 'Zed Zimmer'))
      .toHaveLength(1)
  })

  it('also fires when the keyed row is EARLIER than the plain one, and names that earlier row', async () => {
    const result = await upload(
      'name,agency,signInName\nZed Zimmer,Alpha,zed.z\nZed Zimmer,Alpha,\n',
      true,
    )
    expect(result.rows[0]?.status).toBe('created')
    expect(outline(result)[1])
      .toEqual(['failed', 'same name and agency as row 1: add a signInName or email to tell them apart'])
  })

  it('does not fire when the agency differs or when no other row is keyed', async () => {
    const differentAgency = await upload(
      'name,agency,email\nZed Zimmer,Alpha,\nZed Zimmer,Beta,zed@example.test\n',
      true,
    )
    expect(differentAgency.rows.map(r => r.status)).toEqual(['created', 'created'])

    const unkeyed = await upload('name,agency\nZed Zimmer,Alpha\nYan Young,Alpha\n', true)
    expect(unkeyed.rows.map(r => r.status)).toEqual(['created', 'created'])
  })

  it('counts a keyed row even when that row itself later fails', async () => {
    // Row 2 is keyed (it carries an email) but is refused for naming an unknown persona; the
    // pre-scan reads the file, not the outcomes, so row 1 is still refused.
    const result = await upload(
      'name,agency,email,personaHandle\nZed Zimmer,Alpha,,\nZed Zimmer,Alpha,zed@example.test,NoSuchOrg\n',
      true,
    )
    expect(result.rows.map(r => r.status)).toEqual(['failed', 'failed'])
    expect(result.rows[0]?.message).toBe(MESSAGE)
    expect(result.rows[1]?.message).toBe('personaHandle must name an organization persona in this exercise.')
  })
})

describe('guard (4): an email an earlier row of the file carried fails the later row', () => {
  it('Tom and Priya share one email: the later row fails, on every upload, and Priya\'s email is never written', async () => {
    const file = [
      'name,agency,email,signInName',
      'Tom Becker,County Transportation,shared@example.test,tbecker',
      'Priya Raman,Red Cross,shared@example.test,praman',
    ].join('\n')

    const first = await upload(file)
    expect(first.rows[0]?.status).toBe('updated')
    expect(outline(first)[1]).toEqual(['failed', 'email also on row 1'])

    const again = await upload(file)
    expect(outline(again)).toEqual([['unchanged', null], ['failed', 'email also on row 1']])
    expect((await byId('mock-acct-003'))?.email).toBeUndefined()
    expect((await byId('mock-acct-004'))?.email).toBe('shared@example.test')
  })

  it('two NEW people with explicit sign-in names and one email (any case or padding): the later fails, every upload', async () => {
    const file = [
      'name,email,signInName',
      'New One,Same@Example.test,new.one',
      'New Two, same@example.test ,new.two',
    ].join('\n')

    expect(outline(await upload(file))).toEqual([['created', null], ['failed', 'email also on row 1']])
    expect(outline(await upload(file))).toEqual([['unchanged', null], ['failed', 'email also on row 1']])
    expect(await bySignIn('new.two')).toBeUndefined()
  })

  it('is checked BEFORE the first-key duplicate: same email AND same first key says "email also on row N"', async () => {
    const result = await upload(
      'name,agency,email\nJane Smith,A,jane@example.test\nJane Smith,A,jane@example.test\n',
      true,
    )
    expect(outline(result)).toEqual([['created', null], ['failed', 'email also on row 1']])
  })

  it('a first-key duplicate still registers its email; the first-key check runs after', async () => {
    // Row 2 repeats row 1's first key (the signInName) with a NEW email: not an email clash, so it
    // is the first-key duplicate. Row 3 then carries row 2's email, which row 2 DID register.
    const result = await upload(
      [
        'name,agency,email,signInName',
        'Jane Smith,A,jane@example.test,jane.s',
        'Jane Smith,A,other@example.test,jane.s',
        'Someone Else,B,other@example.test,some.one',
      ].join('\n'),
      true,
    )
    expect(outline(result)).toEqual([
      ['created', null],
      ['failed', 'duplicate of row 1; give a signInName to tell them apart'],
      ['failed', 'email also on row 2'],
    ])
  })
})

describe('guards (1) and (3): a person reached once is reached once', () => {
  it('guard (1): two rows reaching the same EXISTING person through different keys fail the later one', async () => {
    const file = [
      'name,agency,role,email,signInName',
      'Dana Whitfield,Fulco County EM,Ops Chief,,dwhitfield',
      `Dana Whitfield,Fulco County EM,Planner,${DANA_EMAIL},`,
    ].join('\n')

    const first = await upload(file)
    expect(first.rows[0]?.status).toBe('updated')
    expect(first.rows[1]).toMatchObject({
      status: 'failed',
      message: 'duplicate of row 1 (same person)',
    })
    expect((await byId('mock-acct-001'))?.role).toBe('Ops Chief')

    // The re-upload is stable: no flip-flop between the two rows.
    expect((await upload(file)).rows.map(r => r.status)).toEqual(['unchanged', 'failed'])
  })

  it('guard (3): a person resolved by a FAILING row cannot be reached by a later row, on any upload', async () => {
    // Row 1 resolves Dana by signInName, then fails (different email). Row 2 reaches Dana too.
    const file = [
      'name,agency,role,email,signInName',
      'Dana Whitfield,Fulco County EM,,other@example.test,dwhitfield',
      'Dana Whitfield,Fulco County EM,Planner,new2@example.test,',
    ].join('\n')

    const first = await upload(file)
    expect(outline(first)).toEqual([
      ['failed', 'signInName belongs to someone with a different email.'],
      ['failed', 'duplicate of row 1 (same person)'],
    ])
    expect(outline(await upload(file))).toEqual(outline(first))
    expect((await byId('mock-acct-001'))?.role).toBe('EOC Liaison')
  })

  it('guard (3): the reviewer\'s regression (a failing row, then a row repeating its email) is identical on every upload', async () => {
    const file = [
      'name,agency,role,email,signInName',
      'Dana Whitfield,Fulco County EM,Ops Chief,new@example.test,dwhitfield',
      'Dana Whitfield,Fulco County EM,Planner,new@example.test,',
    ].join('\n')

    const first = outline(await upload(file))
    expect(first).toEqual([
      ['failed', 'signInName belongs to someone with a different email.'],
      ['failed', 'email also on row 1'],
    ])
    expect(outline(await upload(file))).toEqual(first)
    expect(outline(await upload(file))).toEqual(first)
    const dana = await byId('mock-acct-001')
    expect([dana?.email, dana?.role]).toEqual([DANA_EMAIL, 'EOC Liaison'])
  })

  it('guard (3): the people a CONFLICTING key names count as reached too', async () => {
    const file = [
      'name,agency,role,email,signInName',
      `Anyone,,,${DANA_EMAIL},moyelaran`,
      'Dana Whitfield,Fulco County EM,Planner,new3@example.test,',
    ].join('\n')

    const result = await upload(file)
    expect(outline(result)).toEqual([
      ['failed', 'signInName matches Marcus Oyelaran but email matches Dana Whitfield.'],
      // Row 1 resolved Dana through its email key before failing.
      ['failed', 'duplicate of row 1 (same person)'],
    ])
  })

  it('guard (1) does not apply to a single add (there is no file)', async () => {
    const error = await failure(addParticipant({ name: 'Dana Whitfield', agency: 'Fulco County EM' }))
    expect(error.status).toBe(409)
    expect(error.serverMessage).toBe('That person is already on the roster.')
  })
})

describe('a key matching MORE than one person fails the row instead of guessing', () => {
  const ambiguous = (label: string) =>
    `${label} matches more than one person on the roster; give a signInName to tell them apart.`

  beforeEach(() => {
    // Two legacy "Pat Lee" rows with no agency (plee itself is a non-roster account's name).
    addRosterMockEntry(person({ id: 'mock-acct-201', name: 'Pat Lee', signInName: 'plee7' }))
    addRosterMockEntry(person({ id: 'mock-acct-202', name: 'Pat Lee', signInName: 'plee8' }))
  })

  it('name + agency naming two people: the server\'s exact text, a failed row, nothing written', async () => {
    const before = getRosterMockEntries()
    const result = await upload('name\nPat Lee\n')

    expect(result.rows[0]).toMatchObject({ status: 'failed', message: ambiguous('name and agency') })
    expect(getRosterMockEntries()).toEqual(before)
  })

  it('an email held by two people is ambiguous too, and says "email"', async () => {
    addRosterMockEntry(person({ id: 'mock-acct-203', name: 'Twin One', signInName: 'twin1', email: 'twin@example.test' }))
    addRosterMockEntry(person({ id: 'mock-acct-204', name: 'Twin Two', signInName: 'twin2', email: 'twin@example.test' }))

    const result = await upload('name,email\nTwin Anyone,twin@example.test\n', true)
    expect(result.rows[0]?.message).toBe(ambiguous('email'))
  })

  it('a signInName tells them apart: the row matches that one person', async () => {
    const result = await upload('name,signInName\nPat Lee,plee8\n', true)
    expect(result.rows[0]).toMatchObject({ status: 'unchanged', signInName: 'plee8' })
  })

  it('an ambiguous add is a 409 with the same text', async () => {
    const error = await failure(addParticipant({ name: 'Pat Lee' }))
    expect(error.status).toBe(409)
    expect(error.serverMessage).toBe(ambiguous('name and agency'))
  })

  it('every candidate counts as reached (guard 3), so a later row for one of them fails', async () => {
    addRosterMockEntry(person({ id: 'mock-acct-203', name: 'Twin One', signInName: 'twin1', email: 'twin@example.test' }))
    addRosterMockEntry(person({ id: 'mock-acct-204', name: 'Twin Two', signInName: 'twin2', email: 'twin@example.test' }))

    // Row 1's email names both twins (ambiguous, so it fails) and reaches both; row 2 then
    // asks for twin1 by signInName.
    const result = await upload('name,email,signInName\nTwin Anyone,twin@example.test,\nTwin One,,twin1\n', true)
    expect(result.rows[0]?.message).toBe(ambiguous('email'))
    expect(outline(result)[1]).toEqual(['failed', 'duplicate of row 1 (same person)'])
  })
})

describe('an ambiguous row is not "the same person" (guard 1 needs exactly one person)', () => {
  it('an ambiguous row after a row that reached one candidate still says "more than one person"', async () => {
    addRosterMockEntry(person({ id: 'mock-acct-203', name: 'Twin One', signInName: 'twin1', email: 'twin@example.test' }))
    addRosterMockEntry(person({ id: 'mock-acct-204', name: 'Twin Two', signInName: 'twin2', email: 'twin@example.test' }))

    const result = await upload('name,email,signInName\nTwin One,,twin1\nTwin Anyone,twin@example.test,\n', true)
    expect(result.rows[0]?.status).toBe('unchanged')
    expect(result.rows[1]?.message)
      .toBe('email matches more than one person on the roster; give a signInName to tell them apart.')
  })
})

describe('a later key conflicts only when NONE of its matches is the matched person', () => {
  it('re-uploading two same-name, same-agency people told apart by signInName is unchanged for both', async () => {
    const file = 'name,agency,signInName\nJane Smith,A,jane.a\nJane Smith,A,jane.b\n'

    expect((await upload(file)).rows.map(r => r.status)).toEqual(['created', 'created'])
    // name + agency now matches BOTH people, one of them the signInName match: no conflict.
    const again = await upload(file)
    expect(again.rows.map(r => r.status)).toEqual(['unchanged', 'unchanged'])
    expect(again.failedCount).toBe(0)
  })

  it('a later key naming only OTHER people still fails the row, and names both', async () => {
    const result = await upload('name,agency,email\nTom Becker,County Transportation,' + DANA_EMAIL + '\n', true)
    expect(result.rows[0]?.message)
      .toBe('email matches Dana Whitfield but name and agency matches Tom Becker.')
  })
})

describe('a matched person with NO persona gets one', () => {
  it('Aiko Tanaka (mock-acct-007): updated, personaCreated, "persona created @aiko_tanaka.", role participant', async () => {
    const before = await byId('mock-acct-007')
    expect(before?.persona).toBeUndefined()

    const result = await upload('name\nAiko Tanaka\n')
    expect(result.rows[0]).toMatchObject({
      status: 'updated',
      personaCreated: true,
      personaHandle: 'aiko_tanaka',
      signInName: 'atanaka',
      message: 'persona created @aiko_tanaka.',
    })
    expect(result.updatedCount).toBe(1)

    const after = await byId('mock-acct-007')
    expect(after).toMatchObject({
      exerciseRole: 'participant',
      persona: { handle: 'aiko_tanaka', kind: 'human', autoCreated: true },
    })
    expect((await getRoster()).participants).toHaveLength(7)

    // The persona exists now: a second upload changes nothing.
    expect((await upload('name\nAiko Tanaka\n')).rows[0]).toMatchObject({
      status: 'unchanged',
      personaCreated: false,
      personaHandle: 'aiko_tanaka',
    })
  })

  it('a dry run reports the persona and creates none', async () => {
    const before = getRosterMockEntries()
    const result = await upload('name\nAiko Tanaka\n', true)

    expect(result.rows[0]).toMatchObject({
      status: 'updated',
      personaCreated: true,
      message: 'persona created @aiko_tanaka.',
    })
    expect(getRosterMockEntries()).toEqual(before)
  })

  it('the role is set to participant: a persona-less pio comes back a participant', async () => {
    const lonePio = person({ id: 'mock-acct-206', name: 'Lone Pio', signInName: 'lonepio', exerciseRole: 'pio' })
    delete lonePio.persona
    addRosterMockEntry(lonePio)

    const result = await upload('name\nLone Pio\n')
    expect(result.rows[0]).toMatchObject({ status: 'updated', personaCreated: true })
    expect(await byId('mock-acct-206')).toMatchObject({
      exerciseRole: 'participant',
      persona: { handle: 'lone_pio', autoCreated: true },
    })
  })

  it('a legacy "madonna" posts as @madonna_2, and the message says so', async () => {
    const madonna = person({ id: 'mock-acct-207', name: 'Madonna', signInName: 'madonna' })
    delete madonna.persona
    addRosterMockEntry(madonna)

    const result = await upload('name\nMadonna\n')
    expect(result.rows[0]).toMatchObject({
      status: 'updated',
      personaHandle: 'madonna_2',
      message: 'persona created @madonna_2.',
    })
  })

  it('a single add that matches a persona-less person is still a 409, not a creation', async () => {
    const error = await failure(addParticipant({ name: 'Aiko Tanaka' }))
    expect(error.status).toBe(409)
    expect(error.serverMessage).toBe('That person is already on the roster.')
    expect((await byId('mock-acct-007'))?.persona).toBeUndefined()
  })

  it('an org persona named on a persona-less person binds it (pio), it does not create a citizen one', async () => {
    const result = await upload('name,personaHandle\nAiko Tanaka,FulcoEM\n')
    expect(result.rows[0]).toMatchObject({
      status: 'updated',
      personaCreated: false,
      personaHandle: 'FulcoEM',
      message: 'persona bound to @FulcoEM.',
    })
    expect(await byId('mock-acct-007')).toMatchObject({ exerciseRole: 'pio' })
  })
})

describe('"persona re-created": the stored persona cannot be found', () => {
  const MESSAGE = 'persona re-created @lena_okafor: the previous one was not found.'

  it('is not in the default seed (its seven rows are counted by the screen\'s own tests)', async () => {
    const { participants } = await getRoster()
    expect(participants).toHaveLength(7)
    expect(participants.some(p => p.id === MOCK_UNRESOLVED_PERSONA_PERSON_ID)).toBe(false)
  })

  it('looks persona-less on the list, and a matching row re-creates it with ONE message', async () => {
    addRosterMockUnresolvedPersonaPerson()
    expect((await byId(MOCK_UNRESOLVED_PERSONA_PERSON_ID))?.persona).toBeUndefined()

    const result = await upload('name,agency\nLena Okafor,Fulco Public Works\n')
    expect(result.rows[0]).toMatchObject({
      status: 'updated',
      personaCreated: true,
      personaHandle: 'lena_okafor',
      message: MESSAGE,
    })
    expect((await byId(MOCK_UNRESOLVED_PERSONA_PERSON_ID))?.persona)
      .toMatchObject({ handle: 'lena_okafor', autoCreated: true })

    // The new persona resolves now, so the next upload is a no-op (not "re-created" again).
    expect((await upload('name,agency\nLena Okafor,Fulco Public Works\n')).rows[0]?.status)
      .toBe('unchanged')
  })

  it('a dry run says the same and keeps the flag, so the real run still says it', async () => {
    addRosterMockUnresolvedPersonaPerson()
    const before = getRosterMockEntries()

    const dry = await upload('name,agency\nLena Okafor,Fulco Public Works\n', true)
    expect(dry.rows[0]?.message).toBe(MESSAGE)
    expect(getRosterMockEntries()).toEqual(before)

    expect((await upload('name,agency\nLena Okafor,Fulco Public Works\n')).rows[0]?.message).toBe(MESSAGE)
  })

  it('reset forgets the flag: the same id staged as an ordinary persona-less person says "created"', async () => {
    addRosterMockUnresolvedPersonaPerson()
    resetRosterMocks()

    const plain = person({ id: MOCK_UNRESOLVED_PERSONA_PERSON_ID, name: 'Lena Okafor', signInName: 'lokafor' })
    delete plain.persona
    addRosterMockEntry(plain)
    expect((await upload('name\nLena Okafor\n')).rows[0]?.message).toBe('persona created @lena_okafor.')
  })
})

describe('"signInName X ignored: this person signs in as Y." on an email or name + agency match', () => {
  const NOTE = 'signInName dana.w ignored: this person signs in as dwhitfield.'

  it('an UNCHANGED row carries the note as its message', async () => {
    const result = await upload(`name,email,signInName\nDana Whitfield,${DANA_EMAIL},dana.w\n`)
    expect(result.rows[0]).toMatchObject({ status: 'unchanged', signInName: 'dwhitfield', message: NOTE })
  })

  it('an UPDATED row appends it after the changes', async () => {
    const result = await upload(
      `name,agency,role,email,signInName\nDana Whitfield,Fulco County EM,Ops Chief,${DANA_EMAIL},dana.w\n`,
    )
    expect(result.rows[0]).toMatchObject({
      status: 'updated',
      message: `role changed. ${NOTE}`,
    })
  })

  it('a name + agency match gets it too', async () => {
    const result = await upload('name,agency,signInName\nTom Becker,County Transportation,tom.b\n', true)
    expect(result.rows[0]).toMatchObject({
      status: 'unchanged',
      message: 'signInName tom.b ignored: this person signs in as tbecker.',
    })
  })

  it('a signInName match has no note, and neither does a row with no signInName', async () => {
    const bySignInName = await upload(`name,email,signInName\nDana Whitfield,${DANA_EMAIL},dwhitfield\n`, true)
    expect(bySignInName.rows[0]).toMatchObject({ status: 'unchanged' })
    expect(bySignInName.rows[0]?.message).toBeUndefined()

    const byEmail = await upload(`name,email\nDana Whitfield,${DANA_EMAIL}\n`, true)
    expect(byEmail.rows[0]?.message).toBeUndefined()
  })
})

describe('the org rebind: persona id differs OR the role is not pio', () => {
  it('a DIFFERENT org persona rebinds', async () => {
    const result = await upload('name,signInName,personaHandle\nDana Whitfield,dwhitfield,FulcoPIO\n')
    expect(result.rows[0]).toMatchObject({
      status: 'updated',
      personaHandle: 'FulcoPIO',
      message: 'persona bound to @FulcoPIO.',
    })
  })

  it('the SAME org persona and already pio is unchanged', async () => {
    const result = await upload('name,signInName,personaHandle\nDana Whitfield,dwhitfield,@fulcoem\n', true)
    expect(result.rows[0]?.status).toBe('unchanged')
  })

  it('the SAME org persona but a role that is not pio is repaired (rebound, role pio)', async () => {
    addRosterMockEntry(person({
      id: 'mock-acct-208',
      name: 'Odd Role',
      signInName: 'oddrole',
      exerciseRole: 'participant',
      persona: { id: 'mock-persona-fulcoem', handle: 'FulcoEM', displayName: 'Fulco County Emergency Management', kind: 'org', autoCreated: false },
    }))

    const result = await upload('name,signInName,personaHandle\nOdd Role,oddrole,FulcoEM\n')
    expect(result.rows[0]).toMatchObject({
      status: 'updated',
      personaHandle: 'FulcoEM',
      message: 'persona bound to @FulcoEM.',
    })
    expect((await byId('mock-acct-208'))?.exerciseRole).toBe('pio')
  })
})

describe('the update message: "agency, role changed; persona bound to @X." with the note appended', () => {
  it('joins the changed fields with ", ", the parts with "; ", and ends with a full stop', async () => {
    await upload('name,agency,role,email\nRiley Chen,Fulco Fire,Captain,riley@example.test\n')

    const result = await upload('name,agency,role,email,personaHandle,signInName\nRiley Chen,Fulco Fire Dept,Chief,riley@example.test,FulcoPIO,rchen\n')
    expect(result.rows[0]?.message).toBe('agency, role changed; persona bound to @FulcoPIO.')
  })

  it('lists every field in the server\'s order: agency, role, email, name', async () => {
    const result = await upload(
      'name,agency,role,email,signInName\nMarcus O.,Fulco Health Dept,Health Chief,marcus@example.test,moyelaran\n',
      true,
    )
    expect(result.rows[0]).toMatchObject({
      status: 'updated',
      name: 'Marcus O.',
      message: 'agency, role, email, name changed.',
    })
  })

  it('the persona part alone has no "changed" part', async () => {
    const result = await upload('name,signInName,personaHandle\nMarcus Oyelaran,moyelaran,RegionalHealth\n', true)
    expect(result.rows[0]?.message).toBe('persona bound to @RegionalHealth.')
  })
})

describe('the server\'s exact error strings', () => {
  it('a header with no name column (alias named), and a file with no header row', async () => {
    const noName = await failure(upload('agency,role\nFulco,Liaison\n'))
    expect(noName.status).toBe(400)
    expect(noName.serverMessage)
      .toBe('the CSV header must include a "name" column (or its alias "displayName").')

    const noHeader = await failure(upload('\n\n   \n'))
    expect(noHeader.status).toBe(400)
    expect(noHeader.serverMessage).toBe('the CSV has no header row.')
  })

  it('a blank name and a markup-only name have SEPARATE messages', async () => {
    const result = await upload('name,agency\n   ,A\n<script>alert(1)</script>,B\n<b></b>,C\n')
    expect(result.rows.map(r => r.message)).toEqual([
      'name is required.',
      'name is required (it contained only markup, which is stripped on ingest).',
      'name is required (it contained only markup, which is stripped on ingest).',
    ])

    expect((await failure(addParticipant({ name: '   ' }))).serverMessage).toBe('name is required.')
    expect((await failure(addParticipant({ name: '<script>alert(1)</script>' }))).serverMessage)
      .toBe('name is required (it contained only markup, which is stripped on ingest).')
  })

  it('strips markup but keeps the author\'s literal characters (a stray < is not a tag)', async () => {
    const stripped = await addParticipant({ name: 'Ana <b>Lima</b> <i>x</i>' })
    expect(stripped.name).toBe('Ana Lima x')
    const literal = await addParticipant({ name: 'Bo 5 < 10 Wu' })
    expect(literal.name).toBe('Bo 5 < 10 Wu')
  })

  it('an unusable or over-long personaHandle cell is an error, not "no handle"', async () => {
    const lonely = await upload('name,personaHandle\nA One,@@\n', true)
    expect(lonely.rows[0]?.message).toBe('personaHandle is not a usable persona handle.')

    const tooLong = await upload(`name,personaHandle\nA Two,${'h'.repeat(257)}\n`, true)
    expect(tooLong.rows[0]?.message).toBe('personaHandle must be at most 256 characters.')
  })

  it('the field messages come in the server\'s order (name, agency, role, email, signInName, persona)', async () => {
    const result = await upload(
      [
        'name,agency,role,email,signInName,personaHandle',
        `${'n'.repeat(257)},,,,,`,
        `A One,${'a'.repeat(129)},${'r'.repeat(129)},,,`,
        'A Two,,,not-an-email,x,@@',
        'A Three,,,,x,@@',
      ].join('\n'),
      true,
    )
    expect(result.rows.map(r => r.message)).toEqual([
      'name must be 256 characters or fewer.',
      'agency must be 128 characters or fewer.',
      'email is not a valid address.',
      'signInName must be 3 to 32 characters: a-z, 0-9, ".", "_" or "-".',
    ])
  })
})

describe('the email shape refuses angle brackets, as the server does', () => {
  it.each(['a<b>@x.test', 'Jane<jane@x.test>', 'jane@x<.test', 'jane@x.test>'])(
    'refuses %s on an import row and on a single add',
    async email => {
      const row = await upload(`name,email\nA One,"${email}"\n`, true)
      expect(row.rows[0]).toMatchObject({ status: 'failed', message: 'email is not a valid address.' })

      const added = await failure(addParticipant({ name: 'A One', email }))
      expect(added.status).toBe(400)
      expect(added.serverMessage).toBe('email is not a valid address.')
    },
  )

  it('still accepts an ordinary address', async () => {
    expect((await upload('name,email\nA One,a.one@x.test\n', true)).rows[0]?.status).toBe('created')
  })
})

describe('the ASCII fold strips the non-spacing marks the server strips (Mn)', () => {
  const none = new Set<string>()

  it('strips a combining mark OUTSIDE U+0300..U+036F (the old fold kept it as a separator)', () => {
    // U+20D7 COMBINING RIGHT ARROW ABOVE is category Mn but is not in the Diacritical Marks block.
    expect(deriveAutoPersonaHandle('Ja⃗ne Smith', none)).toBe('jane_smith')
    expect(deriveSignInName('Ja⃗ne Smith', none)).toBe('jsmith')
  })

  it('still folds the ordinary diacritics', () => {
    expect(deriveAutoPersonaHandle('Zoë Ålvarez', none)).toBe('zoe_alvarez')
    expect(deriveSignInName('José Álvarez', none)).toBe('jalvarez')
  })

  it('keeps a SPACING mark (Mc) as the server does: it separates a handle slug, it is not folded away', () => {
    // The server folds only UnicodeCategory.NonSpacingMark. U+0903 (Devanagari visarga) is a
    // spacing mark: it survives the fold, is not [a-z0-9], and so becomes a '_' separator.
    expect(deriveAutoPersonaHandle('aःb', none)).toBe('a_b')
  })
})

describe('CSV reading follows RosterCsvParser (lines first, first column wins)', () => {
  it('a newline inside a quoted cell is NOT supported: each line is a row', async () => {
    const result = await upload('name\n"Smith\nJane"\n', true)
    expect(result.totalRows).toBe(2)
    expect(result.rows.map(r => r.name)).toEqual(['Smith', 'Jane'])
  })

  it('a quote never carries across a line break (it is closed by the end of its own line)', async () => {
    const result = await upload('name,agency\n"Open Quote,Alpha\nNext Person,Beta\n', true)
    expect(result.rows.map(r => r.name)).toEqual(['Open Quote,Alpha', 'Next Person'])
  })

  it('tolerates CRLF and lone CR line endings', async () => {
    const result = await upload('name,agency\r\nAn One,A\rBo Two,B\r\n', true)
    expect(result.rows.map(r => r.name)).toEqual(['An One', 'Bo Two'])
  })

  it('when a column appears twice (name and displayName) the FIRST one wins', async () => {
    const result = await upload('name,displayName\nAlpha One,Beta Two\n', true)
    expect(result.rows[0]?.name).toBe('Alpha One')
  })

  it('a line of nothing but commas is skipped and not counted', async () => {
    const result = await upload('name,agency\nAn One,A\n,,\n   \nBo Two,B\n', true)
    expect(result.rows.map(r => r.rowNumber)).toEqual([1, 2])
  })
})

describe('two rows may name the same org persona: one persona, two people, two accounts (COR-018)', () => {
  it('each keeps their own account on the same org persona', async () => {
    const result = await upload('name,personaHandle\nAna Lima,FulcoEM\nBen Cole,FulcoEM\n')
    expect(result.rows.map(r => r.status)).toEqual(['created', 'created'])
    expect(result.rows.map(r => r.personaHandle)).toEqual(['FulcoEM', 'FulcoEM'])
    expect(result.rows[0]?.signInName).not.toBe(result.rows[1]?.signInName)
  })
})

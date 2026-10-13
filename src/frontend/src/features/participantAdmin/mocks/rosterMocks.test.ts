/**
 * features/participantAdmin/mocks/rosterMocks.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 10 — the mock adapter FOLLOWS THE FROZEN CONTRACT. It is
 * exercised through the real service (so the request shape is the live call's)
 * with `USE_MOCK_DATA` on, as under Vitest. The mock is the screen's only
 * backend until story 02/03 deploy, so what it promises is pinned here:
 * the seeded states, dry-run-writes-nothing, idempotent re-upload, the
 * derivation rules, org-persona binding, the actions and the 403 switch.
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
import {
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
    expect(noName.serverMessage).toMatch(/"name" column/)

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
    // Row 1 creates Zed. Row 2 carries an email, so its first key differs from row 1's
    // (name + agency); matching is only against who existed BEFORE the file, so it
    // creates a second person instead of updating the first.
    const result = await importRoster(
      csv('name,agency,email\nZed Zimmer,Alpha,\nZed Zimmer,Alpha,zed@example.test'),
      { dryRun: false },
    )
    expect(result.rows.map(r => r.status)).toEqual(['created', 'created'])
    expect(result.updatedCount).toBe(0)
    expect(result.rows.map(r => r.signInName)).toEqual(['zzimmer', 'zzimmer2'])
    expect((await getRoster()).participants.filter(p => p.name === 'Zed Zimmer')).toHaveLength(2)
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

/**
 * features/participantAdmin/test/fixtures.ts
 * ---------------------------------------------------------------------------
 * Small builders for roster rows used by the unit tests (feature: easy-login,
 * story 10). Rows are built from the FROZEN contract's shapes; the join URLs are
 * obviously fake.
 */
import type { RosterEntryDto, RosterLinkDto } from '../types'

export function makeEntry(overrides: Partial<RosterEntryDto> = {}): RosterEntryDto {
  return {
    id: 'acct-1',
    name: 'Jane Smith',
    agency: 'Fulco EM',
    role: 'EOC Liaison',
    signInName: 'jsmith',
    exerciseRole: 'participant',
    persona: {
      id: 'persona-1',
      handle: 'jane_smith',
      displayName: 'Jane Smith',
      kind: 'human',
      autoCreated: true,
    },
    link: {
      status: 'active',
      issuedAt: '2026-10-13T12:30:00.000Z',
      useCount: 0,
      joinUrl: 'https://pulse.example.test/join/FAKE-TOKEN-1',
    },
    access: 'enabled',
    liveSessions: 0,
    createdAt: '2026-10-13T12:30:00.000Z',
    ...overrides,
  }
}

export function makeLink(overrides: Partial<RosterLinkDto> = {}): RosterLinkDto {
  return { status: 'active', useCount: 0, ...overrides }
}

import { describe, expect, it } from 'vitest'
import {
  MOCK_EMBARGOED_RELEASE_AUTHOR,
  MOCK_FULTON_ORG,
  MOCK_HARBOR_ORG,
  MOCK_PENDING_RELEASE_AUTHOR,
  MOCK_PUBLISHED_PARTICIPANT_PAYLOAD,
  MOCK_PUBLISHED_RELEASE_AUTHOR,
  MOCK_PUBLISHED_RELEASE_CONTENT,
  MOCK_RETURNED_RELEASE_AUTHOR,
} from '../mocks/fixtures'
import {
  isReleaseAuthorDto,
  isReleaseAuthorList,
  isReleaseAuthorPayloadDto,
  isReleaseContactDto,
  isReleaseContentDto,
  isReleaseDocumentDto,
  isReleaseLetterheadDto,
  isReleaseOrgDto,
  isReleaseOrgList,
  isReleaseOrgRefDto,
  isReleaseParticipantPayload,
  isReleaseReturnNoteDto,
} from './guards'
import { STAFF_ONLY_PAYLOAD_KEYS } from './vocabulary'

/** A deep, mutable copy to corrupt one field of. */
function clone<T>(value: T): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>
}

describe('press guards: accept every fixture', () => {
  it('the participant payload and its parts', () => {
    expect(isReleaseParticipantPayload(MOCK_PUBLISHED_PARTICIPANT_PAYLOAD)).toBe(true)
    expect(isReleaseOrgRefDto(MOCK_PUBLISHED_PARTICIPANT_PAYLOAD.org)).toBe(true)
    expect(isReleaseContactDto(MOCK_PUBLISHED_PARTICIPANT_PAYLOAD.contact)).toBe(true)
    expect(isReleaseDocumentDto(MOCK_PUBLISHED_PARTICIPANT_PAYLOAD.document)).toBe(true)
  })

  it('the participant release content', () => {
    expect(isReleaseContentDto(MOCK_PUBLISHED_RELEASE_CONTENT)).toBe(true)
  })

  it.each([MOCK_FULTON_ORG, MOCK_HARBOR_ORG])('org $name and its letterhead', org => {
    expect(isReleaseOrgDto(org)).toBe(true)
    expect(isReleaseLetterheadDto(org.letterhead)).toBe(true)
  })

  it.each([
    MOCK_PUBLISHED_RELEASE_AUTHOR,
    MOCK_EMBARGOED_RELEASE_AUTHOR,
    MOCK_RETURNED_RELEASE_AUTHOR,
    MOCK_PENDING_RELEASE_AUTHOR,
  ])('author DTO in state $state and its payload', dto => {
    expect(isReleaseAuthorDto(dto)).toBe(true)
    expect(isReleaseAuthorPayloadDto(dto.payload)).toBe(true)
  })

  it('the return note, the lists', () => {
    expect(isReleaseReturnNoteDto(MOCK_RETURNED_RELEASE_AUTHOR.returnNote)).toBe(true)
    expect(isReleaseOrgList([MOCK_FULTON_ORG, MOCK_HARBOR_ORG])).toBe(true)
    expect(isReleaseAuthorList([MOCK_PUBLISHED_RELEASE_AUTHOR])).toBe(true)
    expect(isReleaseOrgList([{}])).toBe(false)
  })

  it('tolerates an unknown extra key on an author DTO (additive evolution)', () => {
    const extended = { ...clone(MOCK_PUBLISHED_RELEASE_AUTHOR), futureField: 1 }
    expect(isReleaseAuthorDto(extended)).toBe(true)
  })
})

describe('press guards: the participant payload rejects staff-only keys (XC-002)', () => {
  it.each(STAFF_ONLY_PAYLOAD_KEYS)('rejects a payload carrying %s', key => {
    const leaked = { ...clone(MOCK_PUBLISHED_PARTICIPANT_PAYLOAD), [key]: key === 'inputPath' ? 'rich' : {} }
    expect(isReleaseParticipantPayload(leaked)).toBe(false)
  })

  it('rejects a release content whose payload leaks a staff-only key', () => {
    const leaked = clone(MOCK_PUBLISHED_RELEASE_CONTENT)
    leaked.payload = { ...MOCK_PUBLISHED_PARTICIPANT_PAYLOAD, crossPost: { text: null } }
    expect(isReleaseContentDto(leaked)).toBe(false)
  })

  it('rejects the author payload as a participant payload', () => {
    expect(isReleaseParticipantPayload(MOCK_PUBLISHED_RELEASE_AUTHOR.payload)).toBe(false)
  })

  it('rejects release content of another kind', () => {
    expect(isReleaseContentDto({ ...clone(MOCK_PUBLISHED_RELEASE_CONTENT), kind: 'article' })).toBe(false)
  })
})

describe('press guards: fail closed on missing or wrong-typed fields', () => {
  it.each([null, undefined, 'x', 1, [], {}])('rejects non-shapes: %s', value => {
    expect(isReleaseParticipantPayload(value)).toBe(false)
    expect(isReleaseAuthorDto(value)).toBe(false)
    expect(isReleaseOrgDto(value)).toBe(false)
    expect(isReleaseContentDto(value)).toBe(false)
  })

  it('rejects a payload missing a key (nullable keys are present, never omitted)', () => {
    const missing = clone(MOCK_PUBLISHED_PARTICIPANT_PAYLOAD)
    delete missing.dateline
    expect(isReleaseParticipantPayload(missing)).toBe(false)
  })

  it('rejects a wrong-typed sizeBytes and a negative one', () => {
    const doc = { ...MOCK_PUBLISHED_PARTICIPANT_PAYLOAD.document }
    expect(isReleaseDocumentDto({ ...doc, sizeBytes: '184320' })).toBe(false)
    expect(isReleaseDocumentDto({ ...doc, sizeBytes: -1 })).toBe(false)
  })

  it('rejects an org missing its letterhead or with a non-boolean approvalRequired', () => {
    const noLetterhead = clone(MOCK_FULTON_ORG)
    delete noLetterhead.letterhead
    expect(isReleaseOrgDto(noLetterhead)).toBe(false)
    expect(isReleaseOrgDto({ ...clone(MOCK_FULTON_ORG), approvalRequired: 'no' })).toBe(false)
  })

  it('rejects an author DTO with a bad state', () => {
    expect(isReleaseAuthorDto({ ...clone(MOCK_PUBLISHED_RELEASE_AUTHOR), state: 'archived' })).toBe(false)
  })

  it('rejects an author payload with a bad input path', () => {
    expect(isReleaseAuthorPayloadDto({
      ...clone(MOCK_PUBLISHED_RELEASE_AUTHOR.payload), inputPath: 'pdf',
    })).toBe(false)
  })

  it('rejects an author DTO with a non-ISO scenario time or an absolute permalink', () => {
    const base = clone(MOCK_EMBARGOED_RELEASE_AUTHOR)
    expect(isReleaseAuthorDto({ ...base, scheduledScenarioTime: 'Dec 3 2026' })).toBe(false)
    expect(isReleaseAuthorDto({ ...base, permalink: 'https://evil.test/x' })).toBe(false)
  })

  it('rejects a return note without its scenario time', () => {
    expect(isReleaseReturnNoteDto({ text: 'x', byDisplayName: 'y', scenarioTime: 'yesterday' })).toBe(false)
  })

  it('rejects a version that is not a count', () => {
    const fractional = { ...clone(MOCK_PUBLISHED_RELEASE_AUTHOR), version: 1.5 }
    expect(isReleaseAuthorDto(fractional)).toBe(false)
  })
})

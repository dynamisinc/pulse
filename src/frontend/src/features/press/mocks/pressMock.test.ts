import { afterEach, describe, expect, it } from 'vitest'
import { api } from '@/core/services/api'
import { isReleaseAuthorDto, isReleaseAuthorList, isReleaseOrgList } from '../contract/guards'
import { MOCK_PUBLISHED_RELEASE_AUTHOR, PRESS_SCENARIOS } from './fixtures'
import {
  USE_MOCK_PRESS,
  getPressMockScenario,
  pressMockAdapter,
  resetPressMockScenario,
  setPressMockScenario,
  withPressMock,
} from './pressMock'

/** Press-room story 01 (#738): the scenarios ship behind the shared axios client. */

const mock = { adapter: pressMockAdapter }

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } }).response?.status
}

afterEach(() => {
  resetPressMockScenario()
})

describe('press mock adapter', () => {
  it('is on in the test build, and withPressMock attaches it', () => {
    expect(USE_MOCK_PRESS).toBe(true)
    const config = withPressMock({ params: { a: 1 } })
    expect(config).toEqual({ params: { a: 1 }, adapter: pressMockAdapter })
  })

  it('serves the orgs and the releases, in shape', async () => {
    expect(getPressMockScenario()).toBe('activeNewsrooms')
    const orgs = await api.get('/press/orgs', mock)
    const releases = await api.get('/press/releases', mock)
    expect(isReleaseOrgList(orgs.data)).toBe(true)
    expect(isReleaseAuthorList(releases.data)).toBe(true)
    expect(orgs.data).toEqual(PRESS_SCENARIOS.activeNewsrooms.orgs)
  })

  it('serves one release by id, and 404s an unknown id or route', async () => {
    const one = await api.get(`/press/releases/${MOCK_PUBLISHED_RELEASE_AUTHOR.id}`, mock)
    expect(isReleaseAuthorDto(one.data)).toBe(true)
    await expect(api.get('/press/releases/nope', mock)).rejects.toSatisfy(e => statusOf(e) === 404)
    await expect(api.get('/press/other', mock)).rejects.toSatisfy(e => statusOf(e) === 404)
    await expect(api.post('/press/releases', {}, mock)).rejects.toSatisfy(e => statusOf(e) === 404)
  })

  it('serves the selected scenario', async () => {
    setPressMockScenario('noOrgs')
    expect((await api.get('/press/orgs', mock)).data).toEqual([])
    expect((await api.get('/press/releases', mock)).data).toEqual([])
  })

  it('hands out a copy, so a consumer cannot mutate the fixtures', async () => {
    const { data } = await api.get<{ headline: string }>(
      `/press/releases/${MOCK_PUBLISHED_RELEASE_AUTHOR.id}`, mock,
    )
    data.headline = 'changed'
    expect(MOCK_PUBLISHED_RELEASE_AUTHOR.headline).not.toBe('changed')
  })
})

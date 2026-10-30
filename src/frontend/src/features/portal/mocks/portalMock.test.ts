import { afterEach, describe, expect, it } from 'vitest'
import { api } from '@/core/services/api'
import { isPortalDto, isPortalResourceDto, isPortalResourceList } from '../contract/guards'
import { MOCK_PORTAL_RESOURCES, PORTAL_SCENARIOS } from './fixtures'
import {
  USE_MOCK_PORTAL,
  getPortalMockScenario,
  portalMockAdapter,
  resetPortalMockScenario,
  setPortalMockScenario,
  withPortalMock,
} from './portalMock'

/**
 * Exercise-portal story 02 (#768), AC "Fixtures": the scenarios ship behind
 * the shared axios client, answering the PC-4 participant routes.
 */

const mock = { adapter: portalMockAdapter }

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } }).response?.status
}

afterEach(() => {
  resetPortalMockScenario()
})

describe('portal mock adapter', () => {
  it('is on in the test build, and withPortalMock attaches it', () => {
    expect(USE_MOCK_PORTAL).toBe(true)
    const config = withPortalMock({ params: { a: 1 } })
    expect(config).toEqual({ params: { a: 1 }, adapter: portalMockAdapter })
  })

  it('serves the normal-day portal by default, in shape', async () => {
    expect(getPortalMockScenario()).toBe('normalDay')
    const { data } = await api.get('/portal', mock)
    expect(isPortalDto(data)).toBe(true)
    expect(data).toEqual(PORTAL_SCENARIOS.normalDay.portal)
  })

  it('serves the resources list and one resource', async () => {
    const list = await api.get('/portal/resources', mock)
    expect(isPortalResourceList(list.data)).toBe(true)
    expect(list.data).toEqual(MOCK_PORTAL_RESOURCES)

    const first = MOCK_PORTAL_RESOURCES[0]
    const one = await api.get(`/portal/resources/${first?.id ?? ''}`, mock)
    expect(isPortalResourceDto(one.data)).toBe(true)
    expect(one.data).toEqual(first)
  })

  it('serves the selected scenario', async () => {
    setPortalMockScenario('noResources')
    const portal = await api.get('/portal', mock)
    const list = await api.get('/portal/resources', mock)
    expect(portal.data).toEqual(PORTAL_SCENARIOS.noResources.portal)
    expect(list.data).toEqual([])
  })

  it.each([
    ['an unknown resource id', '/portal/resources/not-a-resource'],
    ['a resource of another scenario', '/portal/resources/3e9a7c10-52d4-4b1e-9f2a-6c8d0e1f2a01', 'noResources'],
    ['an unknown portal route', '/portal/displays'],
    ['a deferred display route', '/display/state'],
    ['a nested resource path', `/portal/resources/${MOCK_PORTAL_RESOURCES[0]?.id ?? ''}/extra`],
  ] as const)('404s %s', async (_, path, scenario?: 'noResources') => {
    if (scenario) setPortalMockScenario(scenario)
    await expect(api.get(path, mock)).rejects.toSatisfy(e => statusOf(e) === 404)
  })

  it('404s a write: the participant routes are read-only', async () => {
    await expect(api.post('/portal', {}, mock)).rejects.toSatisfy(e => statusOf(e) === 404)
  })

  it('hands out a copy, so a consumer cannot mutate the fixtures', async () => {
    const { data } = await api.get<{ masthead: { name: string } }>('/portal', mock)
    data.masthead.name = 'Mutated'
    expect(PORTAL_SCENARIOS.normalDay.portal.masthead.name).toBe('Fairhaven Today')
  })
})

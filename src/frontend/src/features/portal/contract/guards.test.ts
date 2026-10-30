import { describe, expect, it } from 'vitest'
import {
  isPortalConfigStaffDto,
  isPortalDto,
  isPortalMastheadDto,
  isPortalModuleDto,
  isPortalResourceDto,
  isPortalResourceList,
  isPortalResourceStaffDto,
  isPortalResourceStaffList,
} from './guards'
import type { PortalConfigStaffDto, PortalDto, PortalResourceDto, PortalResourceStaffDto } from './types'

/**
 * Exercise-portal story 02 (#768), AC "Records and types": the guards reject
 * (fail closed) an out-of-shape or unknown-enum response, so a consuming
 * module renders nothing rather than a broken box. Extra keys are tolerated.
 */

const media = {
  id: 'm-1', kind: 'image', role: 'hero', url: '/media/m-1', posterUrl: null, contentType: 'image/png',
  width: 200, height: 80, durationSec: null, alt: 'Fairhaven Today logo', caption: null,
}

const portal: PortalDto = {
  masthead: { name: 'Fairhaven Today', tagline: null, logo: null },
  layoutKey: 'anchor',
  modules: [{ id: 'topStories', channelId: 'news' }, { id: 'trending', channelId: 'social' }],
  skinOverrides: null,
  hasResources: false,
}

const resource: PortalResourceDto = { id: 'r-1', title: 'Contacts', summary: null, bodyHtml: null, media: null }

const staffConfig: PortalConfigStaffDto = {
  portalName: null, cityName: 'Fairhaven', tagline: null, logo: null, layoutKey: 'anchor',
  modules: [{ id: 'topStories', enabled: true }, { id: 'weather', enabled: false }],
  skinOverrides: { schemaVersion: 1 }, resolvedName: 'Fairhaven Today', version: 0,
}

const staffResource: PortalResourceStaffDto = {
  ...resource, sortOrder: 0, visible: false, version: 3,
}

function without(value: object, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value }
  delete copy[key]
  return copy
}

describe('portal guards', () => {
  describe('isPortalDto', () => {
    it('accepts a well-formed portal, with a logo and skin overrides', () => {
      expect(isPortalDto(portal)).toBe(true)
      const masthead = { ...portal.masthead, logo: media }
      const branded = { ...portal, masthead, skinOverrides: { a: 1 } }
      expect(isPortalDto(branded)).toBe(true)
    })

    it('accepts an empty module list (every source channel disabled)', () => {
      expect(isPortalDto({ ...portal, modules: [] })).toBe(true)
    })

    it('tolerates extra keys (additive evolution)', () => {
      expect(isPortalDto({ ...portal, futureField: 1 })).toBe(true)
    })

    it.each(['masthead', 'layoutKey', 'modules', 'skinOverrides', 'hasResources'])('rejects a body missing %s', key => {
      expect(isPortalDto(without(portal, key))).toBe(false)
    })

    it.each([
      ['an unknown layout key', { layoutKey: 'band' }],
      ['an unknown module id', { modules: [{ id: 'radio', channelId: 'news' }] }],
      ['a module on the wrong channel', { modules: [{ id: 'topStories', channelId: 'press' }] }],
      ['a duplicated module', { modules: [{ id: 'weather', channelId: 'weather' }, { id: 'weather', channelId: 'weather' }] }],
      ['modules that are not an array', { modules: { id: 'weather', channelId: 'weather' } }],
      ['an empty masthead name', { masthead: { name: '', tagline: null, logo: null } }],
      ['an out-of-shape logo', { masthead: { name: 'X', tagline: null, logo: { id: 'm-1' } } }],
      ['skin overrides that are an array', { skinOverrides: [] }],
      ['hasResources as a string', { hasResources: 'true' }],
    ])('rejects %s', (_, patch) => {
      expect(isPortalDto({ ...portal, ...patch })).toBe(false)
    })

    it.each([null, undefined, 'portal', 42, []])('rejects %j', value => {
      expect(isPortalDto(value)).toBe(false)
    })
  })

  it('isPortalMastheadDto requires a nullable tagline key', () => {
    expect(isPortalMastheadDto({ name: 'X', tagline: 'T', logo: null })).toBe(true)
    expect(isPortalMastheadDto({ name: 'X', logo: null })).toBe(false)
  })

  it('isPortalModuleDto pins each module to its source channel', () => {
    expect(isPortalModuleDto({ id: 'socialStream', channelId: 'social' })).toBe(true)
    expect(isPortalModuleDto({ id: 'pressLatest', channelId: 'press' })).toBe(true)
    expect(isPortalModuleDto({ id: 'pressLatest', channelId: 'portal' })).toBe(false)
  })

  describe('resources', () => {
    it('accept a resource and a list', () => {
      expect(isPortalResourceDto({ ...resource, summary: 'S', bodyHtml: '<p>b</p>', media })).toBe(true)
      expect(isPortalResourceList([resource, { ...resource, id: 'r-2' }])).toBe(true)
      expect(isPortalResourceList([])).toBe(true)
    })

    it.each(['id', 'title', 'summary', 'bodyHtml', 'media'])('reject a resource missing %s', key => {
      expect(isPortalResourceDto(without(resource, key))).toBe(false)
    })

    it('reject an empty title, a bad media item, a duplicated id and a non-array list', () => {
      expect(isPortalResourceDto({ ...resource, title: '' })).toBe(false)
      expect(isPortalResourceDto({ ...resource, media: { ...media, kind: 'audio' } })).toBe(false)
      expect(isPortalResourceList([resource, resource])).toBe(false)
      expect(isPortalResourceList({ items: [resource] })).toBe(false)
    })
  })

  describe('staff shapes', () => {
    it('accept the staff config and staff resources', () => {
      expect(isPortalConfigStaffDto(staffConfig)).toBe(true)
      expect(isPortalResourceStaffDto(staffResource)).toBe(true)
      expect(isPortalResourceStaffList([staffResource])).toBe(true)
    })

    it('reject a config with an unknown module, a duplicate, a negative version or no resolved name', () => {
      expect(isPortalConfigStaffDto({ ...staffConfig, modules: [{ id: 'radio', enabled: true }] })).toBe(false)
      expect(isPortalConfigStaffDto({
        ...staffConfig, modules: [{ id: 'weather', enabled: true }, { id: 'weather', enabled: false }],
      })).toBe(false)
      expect(isPortalConfigStaffDto({ ...staffConfig, version: -1 })).toBe(false)
      expect(isPortalConfigStaffDto({ ...staffConfig, resolvedName: '' })).toBe(false)
    })

    it('reject a staff resource without visible, version or an integer sortOrder', () => {
      expect(isPortalResourceStaffDto(without(staffResource, 'visible'))).toBe(false)
      expect(isPortalResourceStaffDto(without(staffResource, 'version'))).toBe(false)
      expect(isPortalResourceStaffDto({ ...staffResource, sortOrder: 1.5 })).toBe(false)
    })
  })
})

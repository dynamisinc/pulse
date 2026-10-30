/**
 * features/portal/contract/guards.ts
 * ---------------------------------------------------------------------------
 * Runtime guards for every PC-3 shape a portal client READS (exercise-portal
 * story 02, #768). Same discipline as the FC-3 guards they build on
 * (`features/channels/contract/guards.ts`): an out-of-shape body or an
 * unknown enum value fails CLOSED (the guard returns false, the caller throws
 * or renders nothing), never a blind cast, so a consuming module renders
 * nothing rather than a broken box. EXTRA keys are tolerated, so the contract
 * can evolve additively without breaking deployed clients.
 *
 * Portal-specific rules on top of FC-3: a module's `channelId` must be its
 * PC-1 source channel, and a module may appear at most once.
 *
 * Request bodies are produced by the client, so they have no guard.
 *
 * World: both. No React, no MUI.
 */

import { isContentMediaDto } from '@/features/channels/contract'
import type { ContentMediaDto, JsonObject } from '@/features/channels/contract'
import { PORTAL_MODULE_CHANNELS, isPortalLayoutKey, isPortalModuleId } from './vocabulary'
import type {
  PortalConfigStaffDto,
  PortalDto,
  PortalMastheadDto,
  PortalModuleDto,
  PortalModuleSettingDto,
  PortalResourceDto,
  PortalResourceStaffDto,
} from './types'

type Candidate = Record<string, unknown>

function asRecord(value: unknown): Candidate | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Candidate) : null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableMedia(value: unknown): value is ContentMediaDto | null {
  return value === null || isContentMediaDto(value)
}

function isNullableJsonObject(value: unknown): value is JsonObject | null {
  return value === null || asRecord(value) !== null
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function hasUniqueIds(items: readonly { readonly id: string }[]): boolean {
  return new Set(items.map(i => i.id)).size === items.length
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is readonly T[] {
  return Array.isArray(value) && value.every(guard)
}

export function isPortalMastheadDto(value: unknown): value is PortalMastheadDto {
  const c = asRecord(value)
  return !!c && isNonEmptyString(c.name) && isNullableString(c.tagline) && isNullableMedia(c.logo)
}

export function isPortalModuleDto(value: unknown): value is PortalModuleDto {
  const c = asRecord(value)
  return !!c && isPortalModuleId(c.id) && c.channelId === PORTAL_MODULE_CHANNELS[c.id]
}

export function isPortalDto(value: unknown): value is PortalDto {
  const c = asRecord(value)
  return (
    !!c &&
    isPortalMastheadDto(c.masthead) &&
    isPortalLayoutKey(c.layoutKey) &&
    isArrayOf(c.modules, isPortalModuleDto) &&
    hasUniqueIds(c.modules) &&
    isNullableJsonObject(c.skinOverrides) &&
    typeof c.hasResources === 'boolean'
  )
}

export function isPortalResourceDto(value: unknown): value is PortalResourceDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNonEmptyString(c.id) &&
    isNonEmptyString(c.title) &&
    isNullableString(c.summary) &&
    isNullableString(c.bodyHtml) &&
    isNullableMedia(c.media)
  )
}

/** `GET /api/portal/resources`: an array of resources, each id once. */
export function isPortalResourceList(value: unknown): value is readonly PortalResourceDto[] {
  return isArrayOf(value, isPortalResourceDto) && hasUniqueIds(value)
}

export function isPortalModuleSettingDto(value: unknown): value is PortalModuleSettingDto {
  const c = asRecord(value)
  return !!c && isPortalModuleId(c.id) && typeof c.enabled === 'boolean'
}

export function isPortalConfigStaffDto(value: unknown): value is PortalConfigStaffDto {
  const c = asRecord(value)
  return (
    !!c &&
    isNullableString(c.portalName) &&
    isNullableString(c.cityName) &&
    isNullableString(c.tagline) &&
    isNullableMedia(c.logo) &&
    isPortalLayoutKey(c.layoutKey) &&
    isArrayOf(c.modules, isPortalModuleSettingDto) &&
    hasUniqueIds(c.modules) &&
    isNullableJsonObject(c.skinOverrides) &&
    isNonEmptyString(c.resolvedName) &&
    isCount(c.version)
  )
}

export function isPortalResourceStaffDto(value: unknown): value is PortalResourceStaffDto {
  const c = asRecord(value)
  return (
    !!c &&
    isPortalResourceDto(c) &&
    typeof c.sortOrder === 'number' &&
    Number.isInteger(c.sortOrder) &&
    typeof c.visible === 'boolean' &&
    isCount(c.version)
  )
}

/** Staff `GET /api/portal/resources`: an array of staff rows, each id once. */
export function isPortalResourceStaffList(
  value: unknown,
): value is readonly PortalResourceStaffDto[] {
  return isArrayOf(value, isPortalResourceStaffDto) && hasUniqueIds(value)
}

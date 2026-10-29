/**
 * features/portal/contract/types.ts
 * ---------------------------------------------------------------------------
 * PC-3 wire shapes (exercise-portal story 02, #768). The TS twin of
 * `Features/Portal/Contracts/PortalDtos.cs` + `PortalStaffDtos.cs`, field for
 * field. Each type has a `*_KEYS` list checked EXHAUSTIVE against the type at
 * compile time (`wireKeys`, from the channels contract), and every list is
 * pinned to `portalWireContract.json`, which the C# suite also reads.
 *
 * Same conventions as FC-3: camelCase keys, string ids, nullable fields
 * present and `null`, every URL host-relative (FC-9.3). Media is FC-3's
 * `ContentMediaDto`, imported, never copied.
 *
 * XC-002: the participant shapes (`PortalDto`, `PortalMastheadDto`,
 * `PortalModuleDto`, `PortalResourceDto`) never carry a token, hash,
 * `version`, `actingHumanId`, `lastSeen`, wall clock or `exerciseId`. The
 * staff shapes below them are staff-world only. `DisplayStateDto` /
 * `DisplayStaffDto` are Deferred post-December (Q-35) and absent.
 *
 * World: both (types only). No React, no MUI.
 */

import { wireKeys } from '@/features/channels/contract'
import type { ContentMediaDto, JsonObject } from '@/features/channels/contract'
import type { PortalLayoutKey, PortalModuleChannelId, PortalModuleId } from './vocabulary'

// --- participant (PC-3) ------------------------------------------------------

/** The portal masthead a participant sees. */
export interface PortalMastheadDto {
  /** Resolved: `PortalName`, else `"{CityName} Today"`, else `"Local Today"`. */
  readonly name: string
  readonly tagline: string | null
  readonly logo: ContentMediaDto | null
}
export const PORTAL_MASTHEAD_KEYS = wireKeys<PortalMastheadDto>()(['name', 'tagline', 'logo'])

/** One module entry; `channelId` is always the module's PC-1 source channel. */
export type PortalModuleDto = {
  readonly [M in PortalModuleId]: { readonly id: M; readonly channelId: PortalModuleChannelId<M> }
}[PortalModuleId]
export const PORTAL_MODULE_KEYS = wireKeys<PortalModuleDto>()(['id', 'channelId'])

/** `GET /api/portal` (participant; behind `RequireChannelEnabled('portal')`). */
export interface PortalDto {
  readonly masthead: PortalMastheadDto
  readonly layoutKey: PortalLayoutKey
  /** Ordered; enabled in config AND source channel enabled; nothing else. */
  readonly modules: readonly PortalModuleDto[]
  /** A partial `OutletSkinTokens` (FC-3b), validated server-side. */
  readonly skinOverrides: JsonObject | null
  /** Whether a visible resource exists (no count, no ids). */
  readonly hasResources: boolean
}
export const PORTAL_KEYS = wireKeys<PortalDto>()(['masthead', 'layoutKey', 'modules', 'skinOverrides', 'hasResources'])

/**
 * `GET /api/portal/resources` (an array, in shelf order) and
 * `GET /api/portal/resources/{id}`: a visible resource.
 */
export interface PortalResourceDto {
  readonly id: string
  readonly title: string
  readonly summary: string | null
  /** Sanitized once at write (F04 rich-body profile); render via `SanitizedBody`. */
  readonly bodyHtml: string | null
  readonly media: ContentMediaDto | null
}
export const PORTAL_RESOURCE_KEYS = wireKeys<PortalResourceDto>()(['id', 'title', 'summary', 'bodyHtml', 'media'])

// --- staff world (PC-4 staff routes) -----------------------------------------

/** One stored module setting (the full ordered list, disabled entries included). */
export interface PortalModuleSettingDto {
  readonly id: PortalModuleId
  readonly enabled: boolean
}
export const PORTAL_MODULE_SETTING_KEYS = wireKeys<PortalModuleSettingDto>()(['id', 'enabled'])

/** Staff `GET /api/portal/config` (and the `PUT` response). */
export interface PortalConfigStaffDto {
  readonly portalName: string | null
  readonly cityName: string | null
  readonly tagline: string | null
  readonly logo: ContentMediaDto | null
  readonly layoutKey: PortalLayoutKey
  readonly modules: readonly PortalModuleSettingDto[]
  readonly skinOverrides: JsonObject | null
  /** The masthead name participants see now (defaults applied). */
  readonly resolvedName: string
  /** `0` when no row exists yet. */
  readonly version: number
}
export const PORTAL_CONFIG_STAFF_KEYS = wireKeys<PortalConfigStaffDto>()([
  'portalName', 'cityName', 'tagline', 'logo', 'layoutKey', 'modules', 'skinOverrides', 'resolvedName', 'version',
])

/** Staff `PUT /api/portal/config` body. Never an exercise id. */
export interface PortalConfigWriteRequest {
  readonly portalName: string | null
  readonly cityName: string | null
  readonly tagline: string | null
  readonly logoMediaId: string | null
  readonly layoutKey: PortalLayoutKey
  readonly modules: readonly PortalModuleSettingDto[]
  readonly skinOverrides: JsonObject | null
  readonly version: number
}
export const PORTAL_CONFIG_WRITE_KEYS = wireKeys<PortalConfigWriteRequest>()([
  'portalName', 'cityName', 'tagline', 'logoMediaId', 'layoutKey', 'modules', 'skinOverrides', 'version',
])

/** Staff `GET /api/portal/resources[/{id}]` row (hidden rows included). */
export interface PortalResourceStaffDto {
  readonly id: string
  readonly title: string
  readonly summary: string | null
  readonly bodyHtml: string | null
  readonly media: ContentMediaDto | null
  readonly sortOrder: number
  readonly visible: boolean
  readonly version: number
}
export const PORTAL_RESOURCE_STAFF_KEYS = wireKeys<PortalResourceStaffDto>()([
  'id', 'title', 'summary', 'bodyHtml', 'media', 'sortOrder', 'visible', 'version',
])

/** Staff `POST /api/portal/resources` and `PUT /api/portal/resources/{id}` body. */
export interface PortalResourceWriteRequest {
  readonly title: string
  readonly summary: string | null
  readonly bodyHtml: string | null
  readonly mediaAssetId: string | null
  readonly visible: boolean
  /** Ignored on create. */
  readonly version: number
}
export const PORTAL_RESOURCE_WRITE_KEYS = wireKeys<PortalResourceWriteRequest>()([
  'title', 'summary', 'bodyHtml', 'mediaAssetId', 'visible', 'version',
])

/** Staff `POST /api/portal/resources/reorder` body. */
export interface PortalResourceReorderRequest {
  /** Every non-deleted resource id, exactly once, in the new order. */
  readonly orderedIds: readonly string[]
}
export const PORTAL_RESOURCE_REORDER_KEYS = wireKeys<PortalResourceReorderRequest>()(['orderedIds'])

/** Every pinned shape, by its golden-file name. */
export const PORTAL_WIRE_SHAPE_KEYS = {
  PortalDto: PORTAL_KEYS,
  PortalMastheadDto: PORTAL_MASTHEAD_KEYS,
  PortalModuleDto: PORTAL_MODULE_KEYS,
  PortalResourceDto: PORTAL_RESOURCE_KEYS,
  PortalModuleSettingDto: PORTAL_MODULE_SETTING_KEYS,
  PortalConfigStaffDto: PORTAL_CONFIG_STAFF_KEYS,
  PortalConfigWriteRequest: PORTAL_CONFIG_WRITE_KEYS,
  PortalResourceStaffDto: PORTAL_RESOURCE_STAFF_KEYS,
  PortalResourceWriteRequest: PORTAL_RESOURCE_WRITE_KEYS,
  PortalResourceReorderRequest: PORTAL_RESOURCE_REORDER_KEYS,
} as const

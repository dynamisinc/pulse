/**
 * features/portal/contract/vocabulary.ts
 * ---------------------------------------------------------------------------
 * PC-1, the frozen portal vocabulary (exercise-portal story 02, #768; see
 * docs/features/exercise-portal/implementation.md). The TS twin of
 * `Features/Portal/Contracts/PortalVocabulary.cs`: every list here equals the
 * C# list, both pinned by `portalWireContract.json`.
 *
 * Additive-only after E3 Wave 1, through the orchestrator. The guards are
 * CLOSED over these lists (fail-closed): a module id the client does not know
 * makes the whole portal response out of shape. `DisplayMode` and
 * `DisplayTargetKind` are Deferred post-December (Q-35) and absent.
 *
 * World: both (types only). No React, no MUI.
 */

import type { ChannelId } from '@/features/channels/contract'

/** Every portal module id, in PC-1 order (an additive registry, PC-5). */
export const PORTAL_MODULE_IDS = ['topStories', 'socialStream', 'trending', 'pressLatest', 'weather'] as const
export type PortalModuleId = (typeof PORTAL_MODULE_IDS)[number]

/**
 * Each module's ONE source channel (FC-1). A module is available only while
 * its source channel is enabled (F08).
 */
export const PORTAL_MODULE_CHANNELS = {
  topStories: 'news',
  socialStream: 'social',
  trending: 'social',
  pressLatest: 'press',
  weather: 'weather',
} as const satisfies Record<PortalModuleId, ChannelId>

/** The source channel of each module, typed per module id. */
export type PortalModuleChannelId<M extends PortalModuleId = PortalModuleId> =
  (typeof PORTAL_MODULE_CHANNELS)[M]

/** The module order an exercise without a config row gets (story 03). */
export const PORTAL_DEFAULT_MODULE_ORDER = [
  'topStories',
  'socialStream',
  'pressLatest',
  'weather',
  'trending',
] as const satisfies readonly PortalModuleId[]

/** Every layout key. `band` / `grid` are parked (D2-003). */
export const PORTAL_LAYOUT_KEYS = ['anchor'] as const
export type PortalLayoutKey = (typeof PORTAL_LAYOUT_KEYS)[number]

/** The layout an exercise without a config row gets. */
export const PORTAL_DEFAULT_LAYOUT_KEY: PortalLayoutKey = 'anchor'

/**
 * PC-1 limits: the single source for story 01's `PortalLimits` guard, the
 * APIs (03, 04) and the console form (16). Title / summary are story 04's.
 */
export const PORTAL_LIMITS = {
  maxResources: 25,
  mastheadNameMaxLength: 60,
  modulesJsonMaxBytes: 4096,
  skinOverridesJsonMaxBytes: 4096,
  resourceTitleMaxLength: 120,
  resourceSummaryMaxLength: 300,
} as const

export function isPortalModuleId(value: unknown): value is PortalModuleId {
  return typeof value === 'string' && (PORTAL_MODULE_IDS as readonly string[]).includes(value)
}

export function isPortalLayoutKey(value: unknown): value is PortalLayoutKey {
  return typeof value === 'string' && (PORTAL_LAYOUT_KEYS as readonly string[]).includes(value)
}

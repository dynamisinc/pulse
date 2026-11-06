/**
 * features/portal/layout/testing/renderPortalSubset.tsx
 * ---------------------------------------------------------------------------
 * TEST-ONLY. The subset harness (exercise-portal story 07, #772), exported
 * for module stories 09-15 and the conformance story 23. Never import it from
 * app code (it pulls in Testing Library).
 *
 * `renderPortalSubset(subset, fixtures)` renders `PortalLayout` with exactly
 * the modules in `subset`, in an isolated registry, behind a fake frame
 * environment that records every `trackClick` instead of emitting telemetry.
 * A module without a real registration in `fixtures.registrations` gets a stub
 * that renders through `ModuleFrame` with one content link.
 */

import type { ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ChannelId } from '@/features/channels/contract'
import {
  PORTAL_MODULE_CHANNELS,
  PORTAL_MODULE_IDS,
  type PortalLayoutKey,
  type PortalModuleDto,
  type PortalModuleId,
} from '../../contract'
import { PortalFrameEnvironmentProvider } from '../frameEnvironment'
import type { PortalFrameEnvironment } from '../frameEnvironmentContext'
import { ModuleFrame } from '../ModuleFrame'
import { ModuleLink } from '../ModuleLink'
import { PortalLayout } from '../PortalLayout'
import { createPortalModuleRegistry, type PortalModuleRegistry } from '../registry'
import type {
  ModuleFrameStatus,
  PortalModuleClickTarget,
  PortalModuleProps,
  PortalModuleRegistration,
  PortalRegion,
} from '../types'

/** The four content modules; Trending varies on its own (story 07 AC). */
export const PORTAL_CONTENT_MODULE_IDS = ['topStories', 'socialStream', 'pressLatest', 'weather'] as const

/** All 2^4 content-module subsets, each with Trending absent and present (32), smallest first. */
export const PORTAL_LAYOUT_SUBSETS: readonly (readonly PortalModuleId[])[] = Array.from(
  { length: 1 << PORTAL_CONTENT_MODULE_IDS.length },
  (_, mask) => PORTAL_CONTENT_MODULE_IDS.filter((_, bit) => (mask & (1 << bit)) !== 0),
)
  .flatMap(content => [content as readonly PortalModuleId[], [...content, 'trending'] as const])
  .sort((a, b) => a.length - b.length)

/** The D2 placement the stubs use: lead = stories + press; rail = social, weather, trending. */
type StubPlacement = { readonly region: PortalRegion; readonly order: number }

export const STUB_MODULE_PLACEMENT: Readonly<Record<PortalModuleId, StubPlacement>> = {
  topStories: { region: 'lead', order: 10 },
  pressLatest: { region: 'lead', order: 20 },
  socialStream: { region: 'rail', order: 30 },
  weather: { region: 'rail', order: 40 },
  trending: { region: 'rail', order: 50 },
}

export const STUB_MODULE_TITLES: Readonly<Record<PortalModuleId, string>> = {
  topStories: 'Top Stories',
  socialStream: 'Latest from Pulse',
  trending: 'Trending',
  pressLatest: 'Official Releases',
  weather: 'Weather',
}

export interface PortalSubsetFixtures {
  /** Real registrations to mount instead of stubs (their ids must be in the subset to render). */
  readonly registrations?: readonly PortalModuleRegistration[]
  /** The status each stub hands `ModuleFrame`. Default `ready`. */
  readonly statuses?: Partial<Record<PortalModuleId, ModuleFrameStatus>>
  /** The enabled channels. Default: the source channels of the subset. */
  readonly enabledChannels?: readonly ChannelId[]
  /** `false` models the enabled set still loading. Default `true`. */
  readonly channelsKnown?: boolean
  readonly layoutKey?: PortalLayoutKey
  /** Extra content inside `main` above the grid (for example a masthead stand-in). */
  readonly before?: ReactNode
}

export interface PortalModuleClickRecord {
  readonly moduleId: PortalModuleId
  readonly target: PortalModuleClickTarget | undefined
}

export interface PortalSubsetRender extends RenderResult {
  /** Every `trackClick` call, in order. */
  readonly clicks: PortalModuleClickRecord[]
  readonly registry: PortalModuleRegistry
  /** The `PortalDto.modules` the layout was given. */
  readonly modules: readonly PortalModuleDto[]
}

function stubRegistration(id: PortalModuleId, status: ModuleFrameStatus): PortalModuleRegistration {
  function StubModule({ moduleId }: PortalModuleProps) {
    return (
      <ModuleFrame moduleId={moduleId} title={STUB_MODULE_TITLES[moduleId]} status={status}>
        <ModuleLink
          moduleId={moduleId}
          to={`/news/fixture/${moduleId.toLowerCase()}-1`}
          clickTarget={{ contentId: `${moduleId}-1` }}
        >
          {`${STUB_MODULE_TITLES[moduleId]} item`}
        </ModuleLink>
      </ModuleFrame>
    )
  }
  return {
    id,
    channelId: PORTAL_MODULE_CHANNELS[id],
    ...STUB_MODULE_PLACEMENT[id],
    Component: StubModule,
  } as PortalModuleRegistration
}

/** Renders `PortalLayout` with exactly `subset` (see module header). */
export function renderPortalSubset(
  subset: readonly PortalModuleId[],
  fixtures: PortalSubsetFixtures = {},
): PortalSubsetRender {
  const registry = createPortalModuleRegistry()
  const real = new Map(
    (fixtures.registrations ?? []).map(registration => [registration.id, registration]),
  )
  for (const id of PORTAL_MODULE_IDS) {
    registry.register(real.get(id) ?? stubRegistration(id, fixtures.statuses?.[id] ?? 'ready'))
  }

  // Stored order = each registration's `order` (a real module's own), filtered to the subset.
  const orderOf = (id: PortalModuleId) => registry.get(id)?.order ?? STUB_MODULE_PLACEMENT[id].order
  const modules = PORTAL_MODULE_IDS
    .filter(id => subset.includes(id))
    .sort((a, b) => orderOf(a) - orderOf(b))
    .map(id => ({ id, channelId: PORTAL_MODULE_CHANNELS[id] }) as PortalModuleDto)

  const enabled = new Set<string>(
    fixtures.enabledChannels ?? modules.map(module => module.channelId),
  )
  const clicks: PortalModuleClickRecord[] = []
  const environment: PortalFrameEnvironment = {
    isChannelEnabled: channelId => (fixtures.channelsKnown ?? true) && enabled.has(channelId),
    channelsKnown: fixtures.channelsKnown ?? true,
    trackClick: (moduleId, target) => { clicks.push({ moduleId, target }) },
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PortalFrameEnvironmentProvider value={environment}>
          <PortalLayout
            layoutKey={fixtures.layoutKey ?? 'anchor'}
            modules={modules}
            registry={registry}
            before={fixtures.before}
          />
        </PortalFrameEnvironmentProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return Object.assign(result, { clicks, registry, modules })
}

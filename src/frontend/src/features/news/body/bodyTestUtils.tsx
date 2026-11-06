/* eslint-disable react-refresh/only-export-components -- test-only fixtures beside the providers */
/**
 * features/news/body/bodyTestUtils.tsx
 * ---------------------------------------------------------------------------
 * Test fixtures for news-network 06: the four outlet skins (stand-ins built from the
 * neutral tokens, so this story does not depend on the skin stories' token files), the
 * participant providers an embedded post needs, and a stub of the ONE exercise-scoped
 * read an embed makes (`GET /threads/{id}`), leaving every other read (the persona cast)
 * on its normal mock path.
 */

import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { api } from '@/core/services/api'
import {
  NEUTRAL_SKIN_TOKENS,
  SkinScope,
  type ContentMediaDto,
  type OutletSkinTokens,
} from '@/features/channels'
import { BrandTokensContext, type BrandTokens } from '@/features/participant-shell/brandTokens'
import type { Post } from '@/features/social'

/** The mock exercise `ExerciseContextProvider` resolves to. */
export const EXERCISE = 'ex-mock-0001'

export const BRAND: BrandTokens = {
  name: 'Test Exercise',
  colors: { primary: '#2b5f75', accent: '#1d4ed8', surface: '#ffffff', onSurface: '#1c1c1c' },
}

function skin(
  type: Partial<OutletSkinTokens['type']>,
  palette: Partial<OutletSkinTokens['palette']>,
  captionStyle: OutletSkinTokens['media']['captionStyle'],
): OutletSkinTokens {
  return {
    ...NEUTRAL_SKIN_TOKENS,
    type: { ...NEUTRAL_SKIN_TOKENS.type, ...type },
    palette: { ...NEUTRAL_SKIN_TOKENS.palette, ...palette },
    media: { ...NEUTRAL_SKIN_TOKENS.media, captionStyle },
  }
}

/** The four December outlets' looks, loud enough that a leak would show. */
export const OUTLET_SKINS: readonly (readonly [string, OutletSkinTokens])[] = [
  ['newsline7', skin(
    { hedFamily: 'Oswald, sans-serif', bodyFamily: "'Source Sans 3', sans-serif", hedCase: 'uppercase' },
    { accent: '#c8102e', link: '#0f2749', breaking: '#c8102e' },
    'plain',
  )],
  ['courier-ledger', skin(
    { hedFamily: 'Newsreader, serif', bodyFamily: 'Newsreader, serif', hedCase: 'none' },
    { bg: '#faf7f0', accent: '#5b5b5b', text: '#1a1a1a' },
    'italic-serif',
  )],
  ['national-wire', skin(
    { hedFamily: "'IBM Plex Sans', sans-serif", kickerFamily: "'IBM Plex Mono', monospace" },
    { accent: '#9a3412', link: '#9a3412' },
    'small-caps',
  )],
  ['the-scoop', skin(
    { hedFamily: 'Anton, sans-serif', bodyFamily: 'Figtree, sans-serif', hedCase: 'uppercase' },
    { accent: '#e6007e', bg: '#ffd400', link: '#000000', text: '#000000', breaking: '#e6007e' },
    'shouty',
  )],
]

export function buildPost(id: string, extra: Partial<Post> = {}): Post {
  return {
    id,
    exerciseId: EXERCISE,
    authorPersonaId: 'persona-fairhavenwater',
    actingHumanId: 'human-simcell-1',
    text: `Boil-water notice for Zone 3 (${id}). #WaterIssues`,
    counts: { reply: 4, repost: 120, like: 980 },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: '2033-09-04T14:00:00.000Z',
    origin: 'inject',
    injectId: '042',
    ...extra,
  }
}

export function media(id: string, extra: Partial<ContentMediaDto> = {}): ContentMediaDto {
  return {
    id,
    kind: 'image',
    role: 'inline',
    url: `https://media.example.test/${id}.jpg`,
    posterUrl: null,
    contentType: 'image/jpeg',
    width: 1200,
    height: 800,
    durationSec: null,
    alt: `Alt for ${id}`,
    caption: `Caption for ${id}`,
    ...extra,
  }
}

/**
 * Stubs ONLY the thread read: `posts` answers by id; any other id is the server's
 * unknown / cross-exercise answer (`focused: null`). Returns the spy for URL assertions.
 */
export function stubThreadRead(posts: Readonly<Record<string, Post>>) {
  const original = api.get.bind(api)
  return vi.spyOn(api, 'get').mockImplementation(((url: string, config?: unknown) => {
    const match = /^\/threads\/([^/?#]+)$/.exec(url)
    if (match === null) return original(url, config as never)
    const id = decodeURIComponent(match[1] ?? '')
    return Promise.resolve({
      data: { ancestors: [], focused: posts[id] ?? null, replies: [] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    })
  }) as typeof api.get)
}

function Where() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

export function Providers({ children }: { readonly children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <ExerciseContextProvider>
        <SessionProvider>
          <BrandTokensContext.Provider value={BRAND}>
            <MemoryRouter initialEntries={['/news/metro-desk-9/story']}>
              <Routes>
                <Route path="*" element={<>{children}<Where /></>} />
              </Routes>
            </MemoryRouter>
          </BrandTokensContext.Provider>
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>
  )
}

/** Renders `node` inside an outlet skin scope (the article page's own setup). */
export function renderInSkin(node: ReactNode, tokens: OutletSkinTokens, skinKey: string) {
  return render(
    <Providers>
      <SkinScope scopeId={`outlet-${skinKey}`} tokens={tokens} skinKey={skinKey}>
        {node}
      </SkinScope>
    </Providers>,
  )
}

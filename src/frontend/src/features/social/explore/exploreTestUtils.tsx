/**
 * features/social/explore/exploreTestUtils.tsx
 * ---------------------------------------------------------------------------
 * Shared helpers for the Explore component tests (demo-polish F6). TEST-ONLY —
 * imported by `*.test.tsx` files in this directory, never by product code.
 *
 *  - `renderExplore` mounts a component under the provider stack the Social channel
 *    gives it: the mock exercise + viewer session, F1's navigation adapter (in-memory,
 *    with a `data-testid="where"` span showing the channel location) and
 *    the persona directory. The shared Explore baseline is reset afterwards by
 *    `resetExplore()`, which every Explore test file calls in `afterEach`.
 *  - `seedPost` appends a participant-visible post to the mock `postStore` (the
 *    store `useFeed` reads in mock mode), authored by a seeded persona handle.
 *  - `structureSignature` serialises an element's STRUCTURE — tag names, the SET
 *    of attribute names, class strings and the shape of text nodes, but not
 *    attribute VALUES or text — so a test can assert two rows differ only by a
 *    known subtree (the verified seal) and carry no extra attribute that could
 *    tell a lookalike apart (SOC-052 / D1-008).
 */

import type { ReactElement } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock } from '@/core/clock'
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import { SocialDirectoryProvider } from '../layout/SocialDirectoryProvider'
import { MemorySocialNavigationProvider } from '../layout/SocialNavigationProvider'
import { postStore } from '../services/postStore'
import { exploreFeedStore } from './exploreFeedStore'
import { Where } from './Where.testUtils'

/** `items[index]`, or a clear failure — a lint-clean stand-in for `items[index]!`. */
export function nth<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`expected an item at index ${index} of ${items.length}`)
  return item
}

export interface RenderExploreOptions {
  /** Memory-adapter history, oldest first. Default `['/explore']`. */
  readonly initialEntries?: readonly string[]
}

/** Renders `ui` inside the channel's providers (see the module header). */
export function renderExplore(
  ui: ReactElement,
  options: RenderExploreOptions = {},
): RenderResult {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <MemorySocialNavigationProvider initialEntries={options.initialEntries ?? ['/explore']}>
          <SocialDirectoryProvider>
            {ui}
            <Where />
          </SocialDirectoryProvider>
        </MemorySocialNavigationProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

/** Call in `afterEach`: empties the post store and the Explore baseline, restores the clock. */
export function resetExplore(): void {
  exploreFeedStore.reset()
  postStore.resetForTests()
  resetExerciseClock()
}

export interface SeedPostInput {
  readonly id: string
  readonly text: string
  /** ISO scenario instant. */
  readonly at: string
  /** A seeded persona handle (default `FairhavenWater`). */
  readonly handle?: string
  readonly counts?: Partial<Post['counts']>
}

/** Appends a visible, top-level post to the mock post store. */
export function seedPost(input: SeedPostInput): void {
  postStore.appendPost({
    id: input.id,
    exerciseId: 'ex-mock-0001',
    authorPersonaId: personaIdForHandle(input.handle ?? 'FairhavenWater'),
    actingHumanId: 'human-simcell-test',
    text: input.text,
    counts: { reply: 0, repost: 0, like: 0, ...input.counts },
    createdWallClock: '2026-07-01T00:00:00.000Z',
    scenarioTime: input.at,
    origin: 'controller-as-persona',
  })
}

/**
 * The structure of `node` (see the module header). `skip` omits a subtree — pass
 * the verified seal's wrapper to compare a verified row with an unverified one.
 */
export function structureSignature(node: Element, skip?: Element): string {
  if (node === skip) return ''
  const attributes = node
    .getAttributeNames()
    .sort()
    .map(name => (name === 'class' ? `class=${node.getAttribute('class') ?? ''}` : name))
    .join(',')
  const children = Array.from(node.childNodes)
    .map(child => {
      if (child.nodeType === Node.TEXT_NODE) return '#text'
      return child instanceof Element ? structureSignature(child, skip) : ''
    })
    .join('')
  return `<${node.tagName.toLowerCase()} ${attributes}>${children}</${node.tagName.toLowerCase()}>`
}

/** Every attribute name used anywhere in `node`'s subtree, except inside `skip`. */
export function attributeNames(node: Element, skip?: Element): Set<string> {
  const names = new Set<string>()
  const visit = (element: Element) => {
    if (element === skip) return
    for (const name of element.getAttributeNames()) names.add(name)
    for (const child of Array.from(element.children)) visit(child)
  }
  visit(node)
  return names
}

/** Every attribute VALUE used anywhere in `node`'s subtree, except inside `skip`. */
export function attributeValues(node: Element, skip?: Element): string[] {
  const values: string[] = []
  const visit = (element: Element) => {
    if (element === skip) return
    for (const name of element.getAttributeNames()) values.push(element.getAttribute(name) ?? '')
    for (const child of Array.from(element.children)) visit(child)
  }
  visit(node)
  return values
}

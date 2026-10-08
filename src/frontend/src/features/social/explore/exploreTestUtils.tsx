/**
 * features/social/explore/exploreTestUtils.tsx
 * ---------------------------------------------------------------------------
 * Shared helpers for the Explore component tests (demo-polish F6). TEST-ONLY —
 * imported by `*.test.tsx` files in this directory, never by product code.
 *
 *  - `renderExplore` mounts a component under the real provider stack the
 *    participant surface uses (`ExerciseContextProvider` + `SessionProvider`;
 *    the mock exercise + the mock viewer session).
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
import { personaIdForHandle } from '@/features/personas'
import type { Post } from '@/features/social'
import { postStore } from '../services/postStore'

/** `items[index]`, or a clear failure — a lint-clean stand-in for `items[index]!`. */
export function nth<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`expected an item at index ${index} of ${items.length}`)
  return item
}

/** Renders `ui` inside the exercise-context + session providers. */
export function renderExplore(ui: ReactElement): RenderResult {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>{ui}</SessionProvider>
    </ExerciseContextProvider>,
  )
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

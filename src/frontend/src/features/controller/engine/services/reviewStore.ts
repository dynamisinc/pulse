/**
 * features/controller/engine/services/reviewStore.ts
 * ---------------------------------------------------------------------------
 * The exercise-scoped MOCK review store (feature: engine-review-cockpit, story
 * 01; ADP-040, COR-001, XC-002). A same-tab, in-memory MODULE-SINGLETON of
 * `EngineReviewItem[]` — the Phase-1 stand-in for the E8 engine (Phase 2), which
 * will produce these items for real. Deliberately mirrors
 * `features/social/services/postStore.ts`'s module-singleton shape
 * (`getItems`/`appendItem`/`updateDisposition`/`subscribe`/`resetForTests`) so
 * `useReviewQueue` can subscribe to it with a `useSyncExternalStore`-style read.
 *
 * STAFF world — pure data/service module, no UI, no COBRA, never a participant
 * surface (XC-002). The published OUTPUT of an approved draft lands in the
 * participant world via `reviewActions` → the shipped `createPost` pipeline; this
 * store never renders and never narrows.
 *
 * ISOLATION (COR-001) — exercise-scoped BY CONSTRUCTION / STAMPING-ONLY. Like
 * `postStore`, this store introduces NO client `exerciseId` query-scoping
 * parameter: every seeded/appended item already carries its stamped `exerciseId`,
 * the session binds the exercise, and query scoping stays server-side when the
 * real engine lands. The seed resolves the ONE mock exercise's bursts.
 *
 * SNAPSHOT IDENTITY — `getItems()` returns a referentially-stable array until the
 * next mutation swaps it (never mutated in place), so a subscriber can memoize on
 * it and a `useSyncExternalStore` read never loops.
 *
 * SEED — a few mock Fairhaven bursts of `GeneratedPost` drafts tied to the seeded
 * personas + a mocked storyline brief string, exercising every review state:
 * Delayed-auto counting down (comfortable + sub-60s), a Suggest queue item, and an
 * auto-HELD (expired) priority item. Re-seeded on `resetForTests` off the CURRENT
 * scenario clock, so a test controlling the clock gets deterministic countdowns.
 */

import { scenarioNow } from '@/core/clock'
import {
  AutonomyLevel,
  DelayedAutoCountdown,
  DraftDisposition,
  EngineReviewItem,
  scenarioMinuteOf,
  type DraftDisposition as DraftDispositionType,
} from '../models/reviewContracts'

/** Matches the shipped mock exercise id so review items, posts, and personas
 * all resolve to the same exercise scope (COR-001). */
const MOCK_EXERCISE_ID = 'ex-mock-0001'

/**
 * Builds the seeded mock bursts against a scenario-minute anchor. Deriving the
 * anchor from the passed-in `nowMinute` (not a fresh clock read) keeps seeding
 * pure + deterministic for a given clock, so `resetForTests` under a fixed clock
 * yields stable countdowns.
 */
function seedItems(nowMinute: number): EngineReviewItem[] {
  const countdown = (
    draftId: string,
    startedScenarioMinute: number,
    countdownMinutes: number,
  ): DelayedAutoCountdown =>
    new DelayedAutoCountdown({
      exerciseId: MOCK_EXERCISE_ID,
      storylineId: 'storyline-water-advisory',
      draftId,
      startedScenarioMinute,
      countdownMinutes,
    })

  return [
    // 1. Delayed-auto, comfortably counting down (~3 scenario minutes left). County
    //    EM reassurance reply to an anxious resident.
    new EngineReviewItem({
      exerciseId: MOCK_EXERCISE_ID,
      storylineId: 'storyline-water-advisory',
      draftId: 'draft-fulco-reassure',
      routedAtLevel: AutonomyLevel.DelayedAuto,
      disposition: DraftDisposition.CountingDown,
      countdown: countdown('draft-fulco-reassure', nowMinute, 3),
      posts: [
        {
          personaHandle: 'FulcoEM',
          text:
            '@mvega_fh We hear you. Zones 2-4 remain under a boil-water advisory as a precaution ' +
            'while testing continues. Bottled or boiled water only for drinking/cooking. Updates ' +
            'the moment results are confirmed. #WaterIssues',
          sentiment: -0.1,
          hashtags: ['#WaterIssues'],
        },
      ],
      storylineTag: '#WaterIssues',
      storylineBrief:
        'Boil-water advisory · residents anxious, county EM quiet for ~12 scenario minutes.',
      actionLabel: 'reply → @mvega_fh',
    }),

    // 2. Delayed-auto, under 60 seconds left (deadline is the next scenario minute).
    //    A broadcast-outlet follow-up chasing the advisory.
    new EngineReviewItem({
      exerciseId: MOCK_EXERCISE_ID,
      storylineId: 'storyline-water-advisory',
      draftId: 'draft-newsline7-followup',
      routedAtLevel: AutonomyLevel.DelayedAuto,
      disposition: DraftDisposition.CountingDown,
      countdown: countdown('draft-newsline7-followup', nowMinute, 1),
      posts: [
        {
          personaHandle: 'Newsline7',
          text:
            'UPDATE: Fairhaven Water says boil-water advisory for Zones 2-4 stays in effect pending ' +
            'test results. County EM: no shelters needed. Newsline 7 will bring you results live.',
          sentiment: 0.0,
          hashtags: ['#WaterIssues'],
        },
      ],
      storylineTag: '#WaterIssues',
      storylineBrief:
        'Boil-water advisory · outlet ready to run a confirmed-facts update alongside officials.',
      actionLabel: 'post → #WaterIssues',
    }),

    // 3. Suggest — queued, awaiting an explicit approve. Sensational outlet
    //    amplifying the impersonator's overstated claim (a burst worth a hard look).
    new EngineReviewItem({
      exerciseId: MOCK_EXERCISE_ID,
      storylineId: 'storyline-rumor-contamination',
      draftId: 'draft-scoop-amplify',
      routedAtLevel: AutonomyLevel.Suggest,
      disposition: DraftDisposition.Queued,
      countdown: null,
      posts: [
        {
          personaHandle: 'TheScoopHQ',
          text:
            'People are saying the Fairhaven contamination is way worse than officials admit. ' +
            'Why the silence?? Screenshots incoming. 👀 #Fairhaven',
          sentiment: -0.6,
          hashtags: ['#Fairhaven'],
        },
      ],
      storylineTag: '#Fairhaven',
      storylineBrief:
        'Rumor spread · unverified lookalike overstating contamination; amplification rising.',
      actionLabel: 'post → #Fairhaven',
    }),

    // 4. Auto-HELD — its timer expired with no decision, so it holds for the
    //    controller (priority). Anxious resident post; surfaces in NEEDS YOU.
    new EngineReviewItem({
      exerciseId: MOCK_EXERCISE_ID,
      storylineId: 'storyline-water-advisory',
      draftId: 'draft-mvega-anxious',
      routedAtLevel: AutonomyLevel.DelayedAuto,
      disposition: DraftDisposition.Held,
      countdown: countdown('draft-mvega-anxious', Math.max(0, nowMinute - 5), 2),
      posts: [
        {
          personaHandle: 'mvega_fh',
          text:
            'still no clear answer from anyone official?? my kids drank tap this morning. what do ' +
            'we actually do right now',
          sentiment: -0.7,
          hashtags: [],
        },
      ],
      storylineTag: '#WaterIssues',
      storylineBrief:
        'Boil-water advisory · timer expired with no decision — held for you (silence ≠ approval).',
      actionLabel: 'reply → @FairhavenWater',
    }),
  ]
}

/** The current item set. Identity is swapped (not mutated) on every mutation. */
let items: EngineReviewItem[] = seedItems(scenarioMinuteOf(scenarioNow().getTime()))

/** Active change listeners; notified on every mutation. */
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Returns the current review-item set (seeded baseline + anything appended). The
 * returned reference is STABLE until the next mutation — do not mutate it.
 */
function getItems(): readonly EngineReviewItem[] {
  return items
}

/** Appends a review item (e.g. a future engine burst) and notifies subscribers. */
function appendItem(item: EngineReviewItem): void {
  items = [...items, item]
  notify()
}

/**
 * Sets the disposition of the item with `draftId` (approve → Published, veto →
 * Vetoed, auto-HOLD → Held), swapping array identity and notifying. A no-op if the
 * draft is absent.
 */
function updateDisposition(draftId: string, disposition: DraftDispositionType): void {
  replaceItem(draftId, current => current.withDisposition(disposition))
}

/**
 * Replaces the item with `draftId` by applying `update` to it (used by re-roll,
 * which swaps posts + countdown, not just disposition). A no-op if absent.
 */
function replaceItem(
  draftId: string,
  update: (current: EngineReviewItem) => EngineReviewItem,
): void {
  const index = items.findIndex(item => item.draftId === draftId)
  if (index === -1) return
  const current = items[index]
  if (!current) return
  const next = [...items]
  next[index] = update(current)
  items = next
  notify()
}

/** Subscribes to store changes; returns an unsubscribe function. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Restores the seeded baseline (re-seeded off the CURRENT scenario clock, so a
 * test's fixed clock drives deterministic countdowns) and clears all listeners.
 * Test-only — prevents cross-test pollution.
 */
function resetForTests(): void {
  items = seedItems(scenarioMinuteOf(scenarioNow().getTime()))
  listeners.clear()
}

/** The module-singleton mock review store. See the module header for the contract. */
export const reviewStore = {
  getItems,
  appendItem,
  updateDisposition,
  replaceItem,
  subscribe,
  resetForTests,
}

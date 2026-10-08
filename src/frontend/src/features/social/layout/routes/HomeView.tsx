/**
 * features/social/layout/routes/HomeView.tsx
 * ---------------------------------------------------------------------------
 * The `/home` page: the inline composer, the All Posts / Following switch, and the
 * two feeds. This is the body of the old `SocialChannel` "feed region", lifted out
 * so the router can keep it MOUNTED while another route is showing (see
 * `SocialRoutes`). Moving it did not change it -- every behavior below predates
 * F1 and is covered by the existing `SocialChannel.*` tests.
 *
 * What changed is only what it NO LONGER does:
 *  - "Who to follow" is not here any more; it lives in the right rail
 *    (`RightRailContent`).
 *  - the "View my profile" button is gone; the nav rail's **Profile** pill is the
 *    way there.
 *  - opening a thread / profile / hashtag is a `navigate()` over the navigation
 *    adapter (`useSocialOpeners`), not local view state.
 *
 * COMPOSER. Rendered inline at the top only when the shell variant grants
 * interactive affordances (`affordancesAvailable(variant)`; COR-015/D1-011). In an
 * observer / read-only / preview mount it is ABSENT (the component also self-guards
 * on `session.isReadOnly`). Because this view stays mounted across navigations, an
 * unsent draft survives opening a thread and coming Back.
 *
 * ALL POSTS <-> FOLLOWING (SOC-080/SOC-081). A WAI-ARIA tablist switches the two
 * feeds. They are mounted as SEPARATE `<Feed>` INSTANCES (not one instance whose
 * `scope` flips): each keeps its own frozen per-scope baseline (`useFeed` freezes
 * on mount), its own one-shot mount `view` telemetry, and its own scroll position
 * across a switch. The Following instance is mounted LAZILY -- on the first
 * switch to it, and kept mounted (hidden) afterwards -- so its telemetry fires
 * when the reader actually opens it, never at channel mount, and switching back
 * and forth costs no refetch and no duplicate event.
 *
 * COR-015: a read-only / no-persona session is served All Posts regardless --
 * `useFeed` enforces that itself, so it is NOT re-implemented here. What IS
 * decided here is the AFFORDANCE: such a session gets NO switch at all, because a
 * Following tab it is not allowed to be served would be a control that silently
 * does nothing (absent-not-inert, D1-011). The guard is deliberately BOTH axes --
 * the shell mount variant AND the session -- so an observer mount can never
 * surface it either.
 *
 * World: participant (Pulse skin). No COBRA, no MUI, FontAwesome-free (text tabs).
 */

import { useCallback, useState, type KeyboardEvent } from 'react'
import { useSession } from '@/core/auth'
import {
  useShellContext,
  affordancesAvailable,
} from '@/features/participant-shell/mountContract'
import { Composer } from '../../components/Composer'
import { Feed } from '../../pages/Feed'
import { useSocialOpeners } from '../useSocialOpeners'
import styles from './HomeView.module.css'

/** The two mountable feed scopes, and the tablist that switches them. */
type FeedTabId = 'all' | 'following'

interface FeedTabSpec {
  readonly id: FeedTabId
  readonly label: string
}

const FEED_TABS: readonly FeedTabSpec[] = [
  { id: 'all', label: 'All Posts' },
  { id: 'following', label: 'Following' },
]

export function HomeView() {
  const { variant } = useShellContext()
  const session = useSession()
  const canCompose = affordancesAvailable(variant)

  // Stable identities (memoized in the hook) so the feed's memoized rows still
  // skip re-render under burst even though callbacks are threaded down
  // (NFR-002/SOC-071).
  const { openThread, openHashtag, openProfile } = useSocialOpeners()

  // Whether the switch is OFFERED at all. See the module header: guarded on BOTH the
  // shell mount variant and the session, mirroring `<Feed>`/`useFeed`'s own
  // `!isReadOnly && personaId !== undefined` predicate.
  const canUseFollowing = canCompose && !session.isReadOnly && session.personaId !== undefined

  const [feedTab, setFeedTab] = useState<FeedTabId>('all')
  // The Following feed is mounted on FIRST switch and kept mounted after that
  // (hidden when inactive) -- so its one-shot mount telemetry fires when the reader
  // opens it, and its frozen baseline + scroll position survive a switch back.
  const [followingMounted, setFollowingMounted] = useState(false)

  const selectFeedTab = useCallback((tab: FeedTabId) => {
    if (tab === 'following') setFollowingMounted(true)
    setFeedTab(tab)
  }, [])

  // Roving arrow-key navigation across the tablist (NFR-001) -- mirrors
  // `HashtagFeed`/`Profile`'s tablists.
  const handleFeedTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return
    event.preventDefault()
    if (key === 'Home') {
      selectFeedTab('all')
      return
    }
    if (key === 'End') {
      selectFeedTab('following')
      return
    }
    selectFeedTab(feedTab === 'all' ? 'following' : 'all')
  }

  return (
    <div className={styles.home}>
      {canCompose && <Composer />}

      {/* All Posts <-> Following (SOC-081). Absent entirely for an observer /
          read-only / no-persona session -- see `canUseFollowing`. */}
      {canUseFollowing && (
        <div className={styles.feedTabs} role="tablist" aria-label="Feed">
          {FEED_TABS.map(tab => {
            const selected = tab.id === feedTab
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`social-feed-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`social-feed-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                className={
                  selected ? `${styles.feedTab} ${styles.feedTabActive}` : styles.feedTab
                }
                onClick={() => selectFeedTab(tab.id)}
                onKeyDown={handleFeedTabKeyDown}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      )}

      {/* TWO SEPARATE `<Feed>` INSTANCES, not one with a flipping `scope` (module
          header). The wrappers carry NO class, so the `hidden` attribute's
          `display:none` is authoritative. */}
      <div
        role={canUseFollowing ? 'tabpanel' : undefined}
        id="social-feed-panel-all"
        aria-labelledby={canUseFollowing ? 'social-feed-tab-all' : undefined}
        hidden={feedTab !== 'all'}
        data-testid="social-feed-panel-all"
      >
        <Feed
          key="feed-all"
          scope="all"
          onOpenThread={openThread}
          onHashtagOpen={openHashtag}
          onOpenProfile={openProfile}
        />
      </div>

      {followingMounted && (
        <div
          role="tabpanel"
          id="social-feed-panel-following"
          aria-labelledby="social-feed-tab-following"
          hidden={feedTab !== 'following'}
          data-testid="social-feed-panel-following"
        >
          <Feed
            key="feed-following"
            scope="following"
            onOpenThread={openThread}
            onHashtagOpen={openHashtag}
            onOpenProfile={openProfile}
          />
        </div>
      )}
    </div>
  )
}

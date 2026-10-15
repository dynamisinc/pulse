/**
 * features/social/notifications/notificationText.test.ts
 * ---------------------------------------------------------------------------
 * The words of a row (demo-polish F7, story 16 "Page"; NFR-001) and the unread badge's two
 * strings: what is SEEN ("3", "99+") and what is HEARD ("Notifications, 3 unread") must agree.
 */
import { describe, expect, it } from 'vitest'
import { actorsLabel, describeItem, UNKNOWN_ACTOR } from './notificationText'
import type { NotificationItem } from './notificationTypes'
import { formatUnreadBadge, notificationsLinkName } from './unreadBadge'

function item(over: Partial<NotificationItem>): NotificationItem {
  return {
    id: 'reply:m1',
    type: 'reply',
    subjectPostId: 'm1',
    subjectHandle: 'dreyes_fh',
    at: '2033-09-04T14:00:00.000Z',
    unread: true,
    count: 1,
    actorIds: ['a'],
    actorCount: 1,
    excerpt: '',
    ...over,
  }
}

describe('actorsLabel', () => {
  it('names one, two, or "N others"', () => {
    expect(actorsLabel(['Alex Kim'], 1)).toBe('Alex Kim')
    expect(actorsLabel(['Alex Kim', 'Sam Lee'], 2)).toBe('Alex Kim and Sam Lee')
    expect(actorsLabel(['Alex Kim', 'Sam Lee'], 3)).toBe('Alex Kim and 2 others')
    expect(actorsLabel(['Alex Kim', 'Sam Lee'], 50)).toBe('Alex Kim and 49 others')
  })

  it('never invents a name: an unlisted person is "Someone"', () => {
    expect(actorsLabel([], 1)).toBe(UNKNOWN_ACTOR)
    expect(actorsLabel([UNKNOWN_ACTOR], 1)).toBe('Someone')
  })
})

describe('describeItem', () => {
  it('reply', () => {
    expect(describeItem(item({}), ['Alex Kim'])).toBe('Alex Kim replied to your post')
    expect(describeItem(item({ actorCount: 4 }), ['Alex Kim', 'Sam Lee']))
      .toBe('Alex Kim and 3 others replied to your post')
  })

  it('mention', () => {
    expect(describeItem(item({ type: 'mention' }), ['Dana'])).toBe('Dana mentioned you')
  })

  it('like: singular and plural, no actor (likes are anonymous)', () => {
    expect(describeItem(item({ type: 'like', count: 1, actorIds: [], actorCount: 0 }), []))
      .toBe('Your post got 1 new like')
    expect(describeItem(item({ type: 'like', count: 3, actorIds: [], actorCount: 0 }), []))
      .toBe('Your post got 3 new likes')
  })

  it('repost (DF-19): built like a like row, anonymous, never an invented name', () => {
    const repost = (over: Partial<NotificationItem>) =>
      item({ id: 'repost:m1', type: 'repost', actorIds: [], actorCount: 0, ...over })
    expect(describeItem(repost({ count: 1 }), [])).toBe('Your post got 1 new repost')
    expect(describeItem(repost({ count: 4 }), [])).toBe('Your post got 4 new reposts')
    // Should a repost row ever carry its actors, it names them: "@x reposted your post".
    expect(describeItem(repost({ actorIds: ['a'], actorCount: 1 }), ['Alex Kim']))
      .toBe('Alex Kim reposted your post')
    expect(describeItem(repost({ actorIds: ['a', 'b'], actorCount: 3 }), ['Alex Kim', 'Sam Lee']))
      .toBe('Alex Kim and 2 others reposted your post')
  })
})

describe('the unread badge', () => {
  it('shows the count as text, capped at 99+', () => {
    expect(formatUnreadBadge(1)).toBe('1')
    expect(formatUnreadBadge(99)).toBe('99')
    expect(formatUnreadBadge(100)).toBe('99+')
    expect(formatUnreadBadge(5000)).toBe('99+')
  })

  it('names the link "Notifications, N unread" with the same capped text', () => {
    expect(notificationsLinkName(3)).toBe('Notifications, 3 unread')
    expect(notificationsLinkName(99)).toBe('Notifications, 99 unread')
    expect(notificationsLinkName(250)).toBe('Notifications, 99+ unread')
  })

  it('is just "Notifications" when nothing is unread (and then no badge is drawn)', () => {
    expect(notificationsLinkName(0)).toBe('Notifications')
  })
})

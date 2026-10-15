/**
 * features/social/notifications/notificationText.ts
 * ---------------------------------------------------------------------------
 * The words of a notification row (demo-polish F7, story 16; NFR-001). Two pure functions,
 * kept out of the row component so they are unit-testable and so the component file exports
 * only a component (fast refresh). Participant world -- no UI.
 *
 * A like or a repost row is anonymous: nothing the client receives says WHO liked or reposted, so
 * those rows say what happened to the post and never invent a name ("Your post got 2 new reposts").
 * Should a repost row ever carry its actors, it names them ("Alex reposted your post").
 *
 * The sentence is plain text built from persona DISPLAY NAMES the caller already resolved
 * through the shared directory; nothing here reads a cast, a clock or the network. A person
 * the cast does not list is {@link UNKNOWN_ACTOR}, never a raw persona id.
 */

import type { NotificationItem } from './notificationTypes'

/** What to call someone the cast does not list. */
export const UNKNOWN_ACTOR = 'Someone'

/**
 * "Alex", "Alex and Sam", "Alex and 3 others" -- from the previewed names (the newest
 * actors, at most two) and the TRUE count of distinct actors in the group.
 */
export function actorsLabel(names: readonly string[], actorCount: number): string {
  const [first = UNKNOWN_ACTOR, second] = names
  if (actorCount <= 1) return first
  if (actorCount === 2 && second !== undefined) return `${first} and ${second}`
  const others = actorCount - 1
  return `${first} and ${others} ${others === 1 ? 'other' : 'others'}`
}

/** The row's sentence: who did what, in plain words. */
export function describeItem(item: NotificationItem, names: readonly string[]): string {
  switch (item.type) {
    case 'reply':
      return `${actorsLabel(names, item.actorCount)} replied to your post`
    case 'mention':
      return `${actorsLabel(names, item.actorCount)} mentioned you`
    case 'like':
      return `Your post got ${item.count} new ${item.count === 1 ? 'like' : 'likes'}`
    case 'repost':
      return item.actorCount > 0
        ? `${actorsLabel(names, item.actorCount)} reposted your post`
        : `Your post got ${item.count} new ${item.count === 1 ? 'repost' : 'reposts'}`
  }
}

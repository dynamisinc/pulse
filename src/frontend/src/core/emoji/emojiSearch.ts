/**
 * core/emoji/emojiSearch.ts
 * ---------------------------------------------------------------------------
 * Pure search over the bundled emoji set (demo-feedback story 12). No I/O.
 *
 * A query matches an emoji when EVERY whitespace-separated term occurs somewhere in
 * its name or keywords (case-insensitive substring), so "heart" finds every heart,
 * "red heart" narrows to one, and "rain" finds the rain cloud and the umbrella.
 * Pasting the emoji itself also finds it. Results keep browse order. An empty or
 * blank query means "browse": the caller shows the categories instead.
 */

import { ALL_EMOJI, type EmojiEntry } from './emojiData'

/** Lower-cased, trimmed query terms; empty when the query is blank. */
function terms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(term => term.length > 0)
}

/** True when the query has something to search for (otherwise: browse). */
export function isSearching(query: string): boolean {
  return terms(query).length > 0
}

/** Emoji matching `query`, in browse order. A blank query returns every emoji. */
export function searchEmoji(
  query: string,
  source: readonly EmojiEntry[] = ALL_EMOJI,
): readonly EmojiEntry[] {
  const wanted = terms(query)
  if (wanted.length === 0) return source
  return source.filter(entry => {
    const haystack = `${entry.name} ${entry.keywords.join(' ')}`
    return wanted.every(term => haystack.includes(term) || entry.emoji === term)
  })
}

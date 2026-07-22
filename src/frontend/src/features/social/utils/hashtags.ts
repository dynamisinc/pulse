/**
 * features/social/utils/hashtags.ts
 * ---------------------------------------------------------------------------
 * Hashtag parsing for the Pulse "Social" surface (feature: hashtags-trending,
 * story 01 — "Hashtags: parse / linkify / feed"; SOC-040). Participant world
 * (Pulse Social skin) — a PURE, UI-free, COBRA-free string module.
 *
 * WHY A PURE PARSER (no JSX here). This module deliberately produces DATA, not
 * React nodes: `parseHashtags` returns an ordered token stream and
 * `extractHashtags` returns the distinct normalized tags. The two consumers
 * each render/use that data their own way — `PostCard` maps the token stream to
 * text + linkified `<a>` nodes (the linkify edit), and `HashtagFeed` uses the
 * extracted tags to filter the feed to one hashtag. Keeping the regex + tokenof
 * logic here (rather than inline in a component) is also what the later
 * search surface (feeds-discovery SOC-082 — OUT OF SCOPE for this story) will
 * reuse to index hashtags, so there is exactly one definition of "what a
 * hashtag is" in the product.
 *
 * WHAT COUNTS AS A HASHTAG. A `#` that (a) is NOT preceded by a word char, `#`,
 * or `&` — so `C#`, `foo#bar`, `##x`, and HTML entities like `&#38;` never
 * match — followed by a run of `[A-Za-z0-9_]` that contains AT LEAST ONE ASCII
 * letter — so a pure-number `#2024` or an underscore-only `#__` is NOT a
 * hashtag (mirrors X/Twitter's "can't be all digits" rule). Case-insensitive:
 * the display form (`raw`) preserves the author's casing, while `tag` is
 * lowercased so `#Water` and `#water` route to and group under one feed.
 *
 * TIME / ISOLATION / SECURITY. This module reads only its input string — no
 * clock, no exercise scope, no network. Post text has already been sanitized
 * upstream (`services/sanitize.ts`, NFR-004) before it ever reaches here; this
 * parser adds no HTML and never itself renders, so it cannot reintroduce
 * markup.
 */

/** One segment of a parsed post: literal text, or a recognized hashtag. */
export type HashtagToken =
  | { readonly type: 'text'; readonly value: string }
  | {
    readonly type: 'hashtag'
    /** Normalized (lowercased, no leading `#`) — the routing/grouping key. */
    readonly tag: string
    /** As authored, including the leading `#` — the display form. */
    readonly raw: string
  }

/**
 * The canonical hashtag pattern (see module header). A fresh `RegExp` is built
 * per call from this source so the stateful global-flag `lastIndex` can never
 * leak between calls. Kept as a bare source string (no flags) for that reason.
 */
const HASHTAG_SOURCE = '(?<![\\w#&])#(\\w*[A-Za-z]\\w*)'

/** Normalizes a captured hashtag body to its routing/grouping key. */
function normalizeTag(body: string): string {
  return body.toLowerCase()
}

/**
 * Splits post text into an ordered stream of text and hashtag tokens, covering
 * the WHOLE input (concatenating every token's text/`raw` reproduces the
 * original string exactly). A string with no hashtags yields a single text
 * token; an empty string yields an empty stream.
 *
 * The caller renders this — `PostCard` maps text tokens to plain React text
 * children (so a script-like string stays inert, NFR-004) and hashtag tokens to
 * linkified anchors.
 */
export function parseHashtags(text: string): HashtagToken[] {
  const tokens: HashtagToken[] = []
  const re = new RegExp(HASHTAG_SOURCE, 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    const raw = match[0] // e.g. '#Water' — lookbehind is zero-width, so this starts at '#'
    const body = match[1] // e.g. 'Water'
    // Unreachable (group 1 always captures) — the guard narrows for strict indexing.
    if (body === undefined) continue
    const start = match.index

    if (start > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, start) })
    }
    tokens.push({ type: 'hashtag', tag: normalizeTag(body), raw })
    lastIndex = start + raw.length
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return tokens
}

/**
 * Returns the DISTINCT normalized hashtags in `text`, in first-seen order.
 * Used by `HashtagFeed` to test whether a post belongs to a hashtag's feed and
 * (later) by search to index a post's tags (SOC-082, out of scope here).
 */
export function extractHashtags(text: string): string[] {
  const seen = new Set<string>()
  const re = new RegExp(HASHTAG_SOURCE, 'g')
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    const body = match[1]
    if (body !== undefined) seen.add(normalizeTag(body))
  }

  return [...seen]
}

/** True when `text` contains the (already-normalized) hashtag `tag`. */
export function textHasHashtag(text: string, tag: string): boolean {
  return extractHashtags(text).includes(normalizeTag(tag))
}

/**
 * features/social/services/sanitize.ts
 * ---------------------------------------------------------------------------
 * Minimal free-text sanitizer for the post ingest path (NFR-004).
 *
 * Pulse's composer is plain text (story 01 "Post composition" is out of scope
 * here) — the risk this guards against is STORED XSS: a participant
 * types/pastes raw HTML (`<script>...</script>`, `<img onerror=...>`, a
 * `<a href="javascript:...">`, ...) that some surface later renders.
 *
 * Approach: STRIP HTML markup, leaving inert plain text. `<script>`/`<style>`
 * blocks are removed with their contents; every other tag is removed, keeping
 * the human-readable inner text. It deliberately does NOT HTML-entity-encode
 * the text: the participant render path is a React text node
 * (`{post.text}`), which already escapes `& < > " '` at render — entity-
 * encoding at ingest on top of that would DOUBLE-encode ordinary text
 * (`don't` → `don&#39;t`, `Tom & Jerry` → `Tom &amp; Jerry`) and break the
 * fiction (the cardinal rule). Stripping keeps `& " '` and stray `<`/`>` as the
 * literal characters the author typed, while removing anything that could parse
 * as executable markup in a non-React consumer too (an AAR export, a console
 * replay) — so a stored script can't execute ANYWHERE (NFR-004), not just on
 * the React path.
 *
 * Applied exactly once, at `createPost`'s ingest boundary (`postService.ts`).
 * Safe rendering downstream is still React's `{text}` default — never
 * `dangerouslySetInnerHTML`.
 */

/** `<script>`/`<style>` element plus its contents (the highest-risk vectors). */
const SCRIPT_STYLE_BLOCK_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
/** Any remaining HTML tag: opening, closing, or self-closing. */
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g

/**
 * Strips HTML markup from `input` so the stored text can never parse as
 * executable markup, while preserving the author's literal characters
 * (ampersands, quotes, apostrophes, and stray `<`/`>` that don't form a tag).
 * A stored `<script>…</script>` or `<img onerror=…>` is removed entirely. Call
 * exactly once, at ingest.
 */
export function sanitizeText(input: string): string {
  return input
    .replace(SCRIPT_STYLE_BLOCK_RE, '')
    .replace(HTML_TAG_RE, '')
}

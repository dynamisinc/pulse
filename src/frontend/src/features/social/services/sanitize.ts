/**
 * features/social/services/sanitize.ts
 * ---------------------------------------------------------------------------
 * Minimal free-text sanitizer for the post ingest path (NFR-004).
 *
 * Pulse's composer is plain text (story 01 "Post composition" is out of scope
 * here) — the risk this guards against is STORED XSS: a participant
 * types/pastes raw HTML (`<script>...</script>`, `<img onerror=...>`, a
 * `<a href="javascript:...">`, ...) that some future surface (a feed, a
 * controller console replay, an AAR export) later renders verbatim and
 * executes.
 *
 * Approach: HTML-entity-escape the five characters that can open a tag or an
 * attribute (`& < > " '`). Deliberately NOT a tag-stripping pass — it
 * preserves the participant's literal text (typing "I saw <script> mentioned"
 * still reads as typed) while making the result IMPOSSIBLE to parse as markup,
 * even if some future surface naively used `dangerouslySetInnerHTML` (it
 * should not — React's default `{text}` rendering is already safe; this is
 * defense-in-depth at the ingest boundary, not a substitute for safe
 * rendering downstream).
 *
 * Applied exactly once, at `createPost`'s ingest boundary
 * (`postService.ts`) — never re-applied at render time (re-escaping an
 * already-escaped string would corrupt legitimate `&amp;`s into `&amp;amp;`).
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;',
}

const UNSAFE_CHARS_RE = /[&<>"']/g

/**
 * Escapes HTML-significant characters in `input` so the result can never be
 * parsed as markup — a stored `<script>…</script>` or `<img onerror=…>`
 * string becomes inert literal text. Call exactly once, at ingest.
 */
export function sanitizeText(input: string): string {
  return input.replace(UNSAFE_CHARS_RE, char => HTML_ESCAPES[char] ?? char)
}

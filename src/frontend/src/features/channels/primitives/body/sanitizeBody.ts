/**
 * features/channels/primitives/body/sanitizeBody.ts
 * ---------------------------------------------------------------------------
 * The client's defense-in-depth pass over `bodyHtml` (channels-foundation 14; NFR-004,
 * FC-9 rule 6). The server sanitizes once, at write, by the kind's named profile; this is
 * ONE more DOMPurify pass with the same allowlist before the HTML reaches the DOM, so a
 * server-side gap still never executes in a participant's browser.
 *
 * THE ALLOWLIST is the union of the rich body profiles (`rich-basic` + `rich-tables`)
 * plus the `<pulse-post data-id>` embed placeholder. It must stay in step with the
 * server's `ISanitizerProfileRegistry` (story 04): `BODY_ALLOWED_TAGS` /
 * `BODY_ALLOWED_ATTRIBUTES` are exported so a parity test can compare them.
 * Deliberately absent: `<img>` / `<video>` / `<iframe>` (body media goes through
 * `ContentMedia`, which carries the EXERCISE bands), `style` / `class` (skins style the
 * body; authors do not), every `on*` handler, and any URL scheme but https, http, mailto,
 * tel and host-relative paths.
 *
 * LINKS: every `<a>` gets `rel="noopener noreferrer"`. A host-relative href (`/news/...`,
 * an in-sim permalink, COR-008) is marked `data-insim-link` so `SanitizedBody` routes it
 * client-side; any other href opens in a new tab.
 */

import createDOMPurify from 'dompurify'

/** The embed placeholder E4 uses to place a Pulse post in an article (D1 anatomy). */
export const PULSE_POST_TAG = 'pulse-post'

/** Marks an in-sim (host-relative) link for client-side routing. */
export const INSIM_LINK_ATTR = 'data-insim-link'

export const BODY_ALLOWED_TAGS: readonly string[] = [
  // rich-basic
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark',
  'a', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'h4', 'code', 'pre', 'span',
  'figure', 'figcaption',
  // rich-tables
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  // the embed placeholder
  PULSE_POST_TAG,
]

export const BODY_ALLOWED_ATTRIBUTES: readonly string[] = [
  'href', 'title', 'lang', 'dir', 'colspan', 'rowspan', 'scope', 'data-id',
]

/** https, http, mailto, tel, or a host-relative path / fragment / query. Nothing else. */
const ALLOWED_URI = /^(?:(?:https?|mailto|tel):|[/#?])/i

/** Whitespace and control characters a browser ignores inside a URL (`java\tscript:`). */
// eslint-disable-next-line no-control-regex
const URI_WHITESPACE = /[\u0000-\u0020\u00a0\u1680\u180e\u2000-\u2029\u205f\u3000]/g

/** A host-relative path that stays on this host (not `//host` or `/\host`). */
export function isInSimHref(href: string): boolean {
  // Browsers drop tabs / newlines inside a URL, so `/\t/evil.example` IS `//evil.example`.
  const normalised = href.replace(URI_WHITESPACE, '')
  return normalised.startsWith('/') && !normalised.startsWith('//') && !normalised.startsWith('/\\')
}

/** http(s) links open in a new tab; mailto / tel / fragments never do. */
const NEW_TAB_HREF = /^https?:/i

/** Marks the visually hidden "(opens in new tab)" note the hook appends to such links. */
export const NEW_TAB_NOTE_ATTR = 'data-new-tab-note'

const purifier = createDOMPurify(window)

/** The "(opens in new tab)" notes created by the `afterSanitizeAttributes` hook, and only those. */
const ownNotes = new WeakSet<Node>()

// The scheme allowlist applies to `href` only. (DOMPurify's ALLOWED_URI_REGEXP would also
// test every non-URI attribute value, which drops `scope="col"` and `colspan="2"`.)
purifier.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'href' && !ALLOWED_URI.test(data.attrValue.replace(URI_WHITESPACE, ''))) {
    data.keepAttr = false
  }
  // The new-tab notes this module appends are visited by the same pass; keep THEIR marker
  // (an author-written one is not in the set, so it is stripped like any other attribute).
  if (data.attrName === NEW_TAB_NOTE_ATTR && ownNotes.has(node)) data.forceKeepAttr = true
})

// Runs AFTER the allowlist check, so the attributes it sets are the only `rel` / `target` /
// `data-insim-link` in the output: an author-supplied one was already stripped.
purifier.addHook('afterSanitizeAttributes', node => {
  if (node.nodeName === 'A') {
    // Store the href exactly as the browser will resolve it (no tabs / newlines), so what
    // was classified below is what gets followed.
    const href = (node.getAttribute('href') ?? '').replace(URI_WHITESPACE, '')
    if (node.hasAttribute('href')) node.setAttribute('href', href)
    node.setAttribute('rel', 'noopener noreferrer')
    if (isInSimHref(href)) {
      node.setAttribute(INSIM_LINK_ATTR, '')
    } else if (NEW_TAB_HREF.test(href)) {
      node.setAttribute('target', '_blank')
      const note = node.ownerDocument.createElement('span')
      note.setAttribute(NEW_TAB_NOTE_ATTR, '')
      note.textContent = ' (opens in new tab)'
      ownNotes.add(note)
      node.appendChild(note)
    }
  }
  // Author text inside an embed placeholder would show beside the embedded post.
  if (node.nodeName.toLowerCase() === PULSE_POST_TAG) node.replaceChildren()
  // `data-id` only means something on the embed placeholder.
  if (node.nodeName.toLowerCase() !== PULSE_POST_TAG) node.removeAttribute('data-id')
})

/** Sanitizes `bodyHtml` with the body allowlist. Pure apart from DOMPurify's own DOM. */
export function sanitizeBodyHtml(bodyHtml: string): string {
  return purifier.sanitize(bodyHtml, {
    ALLOWED_TAGS: [...BODY_ALLOWED_TAGS],
    ALLOWED_ATTR: [...BODY_ALLOWED_ATTRIBUTES],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    CUSTOM_ELEMENT_HANDLING: {
      tagNameCheck: name => name === PULSE_POST_TAG,
      attributeNameCheck: name => name === 'data-id',
      allowCustomizedBuiltInElements: false,
    },
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  })
}

/**
 * features/participantAdmin/shared/copyToClipboard.ts
 * ---------------------------------------------------------------------------
 * Copies a string to the clipboard. The ONE copy helper for the staff participant-admin
 * surface (feature: easy-login): the roster's "Copy link" action (story 10, gotcha 10) and
 * the day-word panel's "Copy" (story 11, Gate-2 S-5) both use it, so the Safari-gesture
 * rule and the `execCommand` fallback are written, and tested, once. It started in
 * `components/people/` for the roster alone; the day-word panel had its own bare
 * `navigator.clipboard.writeText` with no fallback, which simply failed on an insecure
 * origin or an old webview. It lives in `shared/` (not in either story's folder) so neither
 * story imports the other's files and the separation guard stays meaningful.
 *
 * ## It must be called INSIDE the click handler
 * Safari only allows a clipboard write while the user gesture is still active.
 * So the caller passes text it ALREADY HOLDS (the `joinUrl` in the list data) —
 * never "await a fetch, then copy" — and this function calls
 * `navigator.clipboard.writeText` on its first, synchronous line. No `await`
 * precedes it.
 *
 * ## Fallback
 * `document.execCommand('copy')` goes through a transient, off-screen, read-only
 * `<textarea>` that is removed immediately. The text goes in as the textarea's VALUE,
 * not as DOM text content, and the element lives for a single synchronous call: the
 * secret is never rendered.
 *
 * The fallback runs in two situations, and they are NOT equally reliable:
 *  - SYNCHRONOUSLY, in the click, when `navigator.clipboard` is missing (an insecure
 *    origin, an old webview) or `writeText` throws before returning. This is inside
 *    the gesture, so even Safari allows it.
 *  - ASYNCHRONOUSLY, after `writeText` has REJECTED (permission denied, document not
 *    focused). By then the click handler has returned; Safari may refuse
 *    `execCommand('copy')` outside the gesture. It is a best effort, and when it is
 *    refused the function returns `false` so the screen says "Could not copy"
 *    instead of pretending.
 *
 * Returns whether a copy succeeded. It never throws, never logs, and never
 * includes the text in anything it returns. The text may be a secret (a join URL, the day
 * word), so the caller must keep it out of the DOM, a toast and a log itself.
 *
 * World: STAFF. No UI.
 */

function copyWithExecCommand(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false

  const previouslyFocused = document.activeElement
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.tabIndex = -1
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '-9999px'
  area.style.opacity = '0'
  document.body.appendChild(area)

  try {
    area.focus()
    area.select()
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
  }
}

/** Copies `text`. Call from a click handler; see the module header. */
export function copyToClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (clipboard !== undefined && typeof clipboard.writeText === 'function') {
    let write: Promise<void>
    try {
      // The write is started synchronously, in the gesture.
      write = clipboard.writeText(text)
    } catch {
      // A synchronous throw is still inside the gesture: the fallback is reliable here.
      return Promise.resolve(copyWithExecCommand(text))
    }
    return write.then(
      () => true,
      () => copyWithExecCommand(text),
    )
  }
  return Promise.resolve(copyWithExecCommand(text))
}

/**
 * features/participantAdmin/components/people/copyToClipboard.ts
 * ---------------------------------------------------------------------------
 * Copies a string to the clipboard for the roster's "Copy link" action
 * (feature: easy-login, story 10; gotcha 10).
 *
 * ## It must be called INSIDE the click handler
 * Safari only allows a clipboard write while the user gesture is still active.
 * So the caller passes text it ALREADY HOLDS (the `joinUrl` in the list data) —
 * never "await a fetch, then copy" — and this function calls
 * `navigator.clipboard.writeText` on its first, synchronous line. No `await`
 * precedes it.
 *
 * ## Fallback
 * Where `navigator.clipboard` is missing (an insecure origin, an old webview) or
 * rejects the write, it falls back to `document.execCommand('copy')` through a
 * transient, off-screen, read-only `<textarea>` that is removed immediately.
 * The text goes in as the textarea's VALUE, not as DOM text content, and the
 * element lives for a single synchronous call: the secret is never rendered.
 *
 * Returns whether a copy succeeded. It never throws, never logs, and never
 * includes the text in anything it returns.
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
    // The write is started synchronously, in the gesture.
    return clipboard.writeText(text).then(
      () => true,
      () => copyWithExecCommand(text),
    )
  }
  return Promise.resolve(copyWithExecCommand(text))
}

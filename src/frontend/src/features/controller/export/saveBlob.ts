/**
 * features/controller/export/saveBlob.ts
 * ---------------------------------------------------------------------------
 * Hands a downloaded file to the browser to save under a given name (demo-feedback story 09).
 * STAFF world, no UI. A temporary object URL on a hidden `<a download>` that is clicked and
 * removed; the URL is revoked a little later (revoking at once can cancel the save in some
 * browsers).
 */

/** How long the object URL lives after the click. */
const REVOKE_AFTER_MS = 10_000

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
  }
}

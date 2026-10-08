/**
 * features/controller/runSheet/runSheetFileIO.ts
 * ---------------------------------------------------------------------------
 * The browser file plumbing for run-sheet import / export (demo-polish C3, story 19).
 * STAFF world; no React. Kept apart from the schema (`runSheetSchema.ts`, pure) so the
 * DOM-only parts - an object-URL download and reading a picked `File` - are small, named
 * and easy to stub in tests.
 */

/** A download name for a sheet: `<slug>.runsheet.json` (the slug is ASCII, lower-case). */
export function runSheetFilename(sheetName: string): string {
  const slug = sheetName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return `${slug === '' ? 'run-sheet' : slug}.runsheet.json`
}

/** Saves `text` to the user's machine as `filename` (an object URL and a synthetic click). */
export function downloadTextFile(filename: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // The click has been dispatched; the browser has taken its own reference to the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Reads a picked file as text. Rejects if the browser cannot read it. */
export function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsText(file)
  })
}

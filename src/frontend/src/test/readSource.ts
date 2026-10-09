/**
 * src/test/readSource.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY helper: read a real file from disk, synchronously, as UTF-8.
 *
 * WHY IT EXISTS. Several guards must assert on the actual TEXT of a stylesheet
 * (forced light, accent wiring, skeleton geometry, `index.css`). Under Vitest every
 * CSS import is STUBBED — `import.meta.glob('*.css', { query: '?raw' })` / `?inline`
 * yield `{}` or `""` (`vitest:css-empty-post`) — so a guard built on them passes
 * vacuously. The text therefore has to come straight off disk.
 *
 * WHY IT LOOKS LIKE THIS. The app TS program's `types` is `["vite/client"]` only (no
 * Node typings, and a `/// <reference types="node" />` would leak Node's globals into
 * the whole program). So `node:fs` is loaded through a VARIABLE specifier (Vite does
 * not try to bundle it, TypeScript does not try to resolve it) and cast to the one
 * method used, {@link FsLike} — no `any`. Top-level `await` is fine: tests are ESM.
 *
 * Paths are anchored on this file's own directory (`src/test/`), via
 * `import.meta.dirname` (jsdom rewrites `import.meta.url`, so that is not usable).
 *
 * Never import this from non-test code.
 */

/** The single `node:fs` method the guards need. */
interface FsLike {
  readFileSync(path: string, encoding: 'utf8'): string
}

const nodeFsSpecifier = 'node:fs'
const fs = (await import(/* @vite-ignore */ nodeFsSpecifier)) as FsLike

const testDir = (import.meta as unknown as { dirname?: string }).dirname
if (testDir === undefined) {
  throw new Error('readSource: import.meta.dirname is unavailable in this runtime')
}

/** The text of `src/<pathFromSrc>` (e.g. `'features/social/theme/social.module.css'`). */
export function readSrcFile(pathFromSrc: string): string {
  return fs.readFileSync(`${testDir}/../${pathFromSrc}`, 'utf8')
}

/** The text of `<frontend root>/<pathFromFrontendRoot>` (e.g. `'index.html'`). */
export function readFrontendFile(pathFromFrontendRoot: string): string {
  return fs.readFileSync(`${testDir}/../../${pathFromFrontendRoot}`, 'utf8')
}

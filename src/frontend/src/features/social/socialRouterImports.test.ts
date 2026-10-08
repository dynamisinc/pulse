/**
 * features/social/socialRouterImports.test.ts
 * ---------------------------------------------------------------------------
 * A structural guard for the navigation adapter (demo-polish F1, L2): inside
 * `features/social/**`, only the navigation providers and the account card may
 * touch React Router's router-reading API.
 *
 * WHY. The channel is mounted in two hosts (`layout/socialNavigation.ts`): the
 * participant app, where the real router IS the channel's location, and C6's staff
 * "preview as participant", where the channel runs under the memory provider and the
 * real router belongs to the STAFF app. Every one of `Link` / `NavLink` /
 * `Navigate` / `useNavigate` / `useLocation` / `useHref` (and `useSearchParams`,
 * `useMatch`, `useResolvedPath`, ...) reads or writes the REAL router. A single
 * `<Link to="/explore">` in a participant component would, inside the preview,
 * move the staff app's address bar -- exactly what the adapter exists to prevent --
 * and nothing in the type system would notice. So the ban is mechanical.
 *
 * ALLOWED (everything else in the package imports none of the banned names):
 *   - `layout/SocialNavigationProvider.tsx`  -- IS the adapter's React Router side;
 *   - `layout/AccountCard.tsx`               -- Sign out leaves the channel for
 *                                               `/login` (see its header);
 *   - `*.test.*` and `*.testUtils.*`         -- test scaffolding.
 * `Routes`, `Route`, `useParams`, `matchPath`, `parsePath`, `MemoryRouter`,
 * `useInRouterContext` and `UNSAFE_RouteContext` are NOT banned: they take their
 * location from the adapter (`<Routes location>`) or read no location at all.
 *
 * Same technique as `staffShell/twoWorldsSeparation.test.ts`: the REAL source text
 * through Vite's eager `?raw` glob (no `node:fs`), import clauses parsed rather than
 * grepped, so prose in a comment never trips it. NON-VACUITY: the scan must cover a
 * real number of files, the two allow-listed files must genuinely contain banned
 * names (an allowlist entry that guards nothing is dead weight), and the detector
 * must flag a synthetic offender.
 */
import { describe, expect, it } from 'vitest'

const BANNED_NAMES: readonly string[] = [
  'Link',
  'NavLink',
  'Navigate',
  'useNavigate',
  'useLocation',
  'useHref',
  'useSearchParams',
  'useMatch',
  'useMatches',
  'useResolvedPath',
  'useNavigationType',
  'useLinkClickHandler',
  'useBlocker',
  'BrowserRouter',
  'HashRouter',
  'createBrowserRouter',
  'createHashRouter',
  'RouterProvider',
]

/** Files that may import banned names, with the reason. */
const ALLOWED_FILES: Readonly<Record<string, string>> = {
  './layout/SocialNavigationProvider.tsx': 'the adapter\'s React Router side',
  './layout/AccountCard.tsx': 'sign-out leaves the channel for /login',
}

interface RouterImport {
  readonly names: string[]
  /** True for `import * as RR from 'react-router-dom'` -- cannot be checked name by name. */
  readonly namespace: boolean
}

/** Strips comments so a file that merely DOCUMENTS an import does not trip the ban. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Every import clause that comes from `react-router` / `react-router-dom`. */
function routerImports(rawSource: string): RouterImport[] {
  const source = stripComments(rawSource)
  const found: RouterImport[] = []
  // The clause may not cross a quote or `;`, so it can never swallow an earlier import.
  const specifier = 'react-router(?:-dom)?(?:\\/[^\'"]*)?'
  const pattern = new RegExp(`import\\s+(?:type\\s+)?([^'";]*?)\\s+from\\s+['"]${specifier}['"]`, 'g')
  for (const match of source.matchAll(pattern)) {
    const clause = match[1] ?? ''
    const namespace = /\*\s+as\s+\w+/.test(clause)
    const braces = /\{([\s\S]*)\}/.exec(clause)
    const names = (braces?.[1] ?? '')
      .split(',')
      .map(part => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0] ?? '')
      .filter(name => name !== '')
    found.push({ names, namespace })
  }
  return found
}

function bannedIn(source: string): string[] {
  const hits: string[] = []
  for (const entry of routerImports(source)) {
    if (entry.namespace) hits.push('* (namespace import)')
    for (const name of entry.names) if (BANNED_NAMES.includes(name)) hits.push(name)
  }
  return hits
}

const sources = import.meta.glob(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./**/*.testUtils.{ts,tsx}'],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>

describe('only the providers and the account card read the real router (L2)', () => {
  it('scans a real set of production files (cannot pass vacuously)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(60)
    expect(Object.keys(sources)).toContain('./layout/SocialRoutes.tsx')
  })

  it('no other production file imports a router-reading name', () => {
    const violations = Object.entries(sources)
      .filter(([file]) => !(file in ALLOWED_FILES))
      .map(([file, source]) => ({ file, hits: bannedIn(source) }))
      .filter(entry => entry.hits.length > 0)
    expect(violations).toEqual([])
  })

  it.each(Object.keys(ALLOWED_FILES))('the allowlisted %s really does use a banned name', file => {
    expect(bannedIn(sources[file] ?? '').length).toBeGreaterThan(0)
  })

  it('the matcher side stays allowed: SocialRoutes imports Routes / Route only', () => {
    const imported = routerImports(sources['./layout/SocialRoutes.tsx'] ?? '').flatMap(e => e.names)
    expect(imported).toEqual(expect.arrayContaining(['Routes', 'Route']))
    expect(bannedIn(sources['./layout/SocialRoutes.tsx'] ?? '')).toEqual([])
  })

  it('the detector bites: aliases, type modifiers, multiline clauses and namespaces', () => {
    const offender = [
      "import { Link } from 'react-router-dom'",
      "import { useNavigate as go, Route } from 'react-router'",
      'import {',
      '  type Location,',
      '  useLocation,',
      "} from 'react-router-dom'",
      "import * as RR from 'react-router-dom'",
    ].join('\n')
    expect(bannedIn(offender)).toEqual(['Link', 'useNavigate', 'useLocation', '* (namespace import)'])
  })

  it('does not flag allowed names, other packages, or prose', () => {
    const fine = [
      "import { Routes, Route, useParams, matchPath } from 'react-router-dom'",
      "import { Link } from './MyLinkComponent'",
      '// import { Link } from "react-router-dom"  (documentation only)',
    ].join('\n')
    expect(bannedIn(fine)).toEqual([])
  })
})

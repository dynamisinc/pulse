/**
 * features/controller/media/staffWorldBoundary.test.ts
 * ---------------------------------------------------------------------------
 * The two-worlds guard for the CONTROLLER (staff) world (demo-polish C1, story 17
 * "Staff world only"; D0 two-worlds rule, CLAUDE.md). The composer's preview shows
 * participant CONTENT inside staff CHROME, so the easy mistake is to reach for the
 * participant `PostCard` to draw it - which would make a staff screen look like a
 * participant one (and, worse, the other way round). This reads the REAL source of
 * every non-test `.ts`/`.tsx` file under `features/controller/` and fails if any of
 * them imports:
 *
 *   - the participant post card or its parts (`PostCard`, `PostHeader`, `PostBody`,
 *     `PostActions`, `PostMediaSlot`, ...), the participant composers / thread / feed
 *     / channel, or the participant media players;
 *   - anything under `features/social/**` that is a stylesheet or a theme, the
 *     participant shell, or a brand theme provider (no participant skin);
 *   - `@mui/icons-material` (icons are FontAwesome only);
 *   - a raw MUI `Button` / `TextField` (staff surfaces use the COBRA components).
 *
 * Cross-surface PRIMITIVES the controller deliberately shares - `Avatar`,
 * `VerifiedMark`, the post MODEL and its pure services - are allowed: a trust signal is
 * never re-themed per world (R-001/R-004).
 *
 * Like `staffShell/twoWorldsSeparation.test.ts` it reads source text through Vite's
 * eager `import.meta.glob(?raw)` (no `node:fs` in the browser app program), parses the
 * import SPECIFIERS and clause names (not prose, so a comment that merely names
 * `PostCard` is not flagged), and asserts it scanned a non-trivial number of files.
 */
import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Specifier patterns a staff file must never import. */
const FORBIDDEN_SPECIFIERS: ReadonlyArray<{ readonly pattern: RegExp; readonly why: string }> = [
  { pattern: /(^|\/)PostCard(\/|$|\.)/, why: 'the participant post card' },
  {
    pattern: /features\/social\/components\/post\//,
    why: 'a participant post part (PostHeader / PostBody / PostActions / PostMediaSlot ...)',
  },
  {
    pattern: /features\/social\/components\/(Composer|Reply|Quote|Thread)/,
    why: 'a participant composer or thread view',
  },
  { pattern: /features\/social\/components\/media\/(?!safeMediaUrl)/, why: 'a participant media player' },
  { pattern: /features\/social\/(pages|layout|explore|notifications)\//, why: 'a participant page' },
  { pattern: /features\/social\/SocialChannel/, why: 'the participant channel' },
  { pattern: /features\/social\/theme\//, why: 'the participant theme' },
  { pattern: /features\/social\/.*\.css$/, why: 'a participant stylesheet' },
  { pattern: /features\/participant-shell/, why: 'the participant shell' },
  { pattern: /BrandThemeProvider|brandTokens/, why: 'a per-brand participant skin' },
  { pattern: /^@mui\/icons-material/, why: '@mui/icons-material (icons are FontAwesome only)' },
]

/** Names a staff file must never import from the social barrel or MUI. */
const FORBIDDEN_NAMES: ReadonlyArray<{ readonly name: string; readonly from: RegExp }> = [
  { name: 'PostCard', from: /./ },
  { name: 'PostHeader', from: /./ },
  { name: 'PostBody', from: /./ },
  { name: 'PostActions', from: /./ },
  { name: 'PostMediaSlot', from: /./ },
  { name: 'Composer', from: /features\/social/ },
  { name: 'ThreadView', from: /features\/social/ },
  { name: 'Feed', from: /features\/social/ },
  { name: 'SocialChannel', from: /features\/social/ },
  { name: 'Button', from: /^@mui\/material/ },
  { name: 'TextField', from: /^@mui\/material/ },
]

function stripComments(source: string): string {
  return source.replace(
    /('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, stringLiteral: string | undefined) => (stringLiteral === undefined ? '' : match),
  )
}

interface ImportRecord {
  readonly specifier: string
  readonly names: readonly string[]
}

function importsOf(source: string): ImportRecord[] {
  const code = stripComments(source)
  const records: ImportRecord[] = []
  for (const match of code.matchAll(/import\s+(?:type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    const clause = match[1] ?? ''
    const specifier = match[2] ?? ''
    const braces = /\{([^}]*)\}/.exec(clause)?.[1] ?? ''
    const names = braces
      .split(',')
      .map(part => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim() ?? '')
      .filter(name => name !== '')
    const defaultName = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim()
    if (defaultName !== '' && !defaultName.startsWith('*')) names.push(defaultName)
    records.push({ specifier, names })
  }
  for (const match of code.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    records.push({ specifier: match[1] ?? '', names: [] })
  }
  for (const match of code.matchAll(/import\s+['"]([^'"]+)['"]/g)) {
    records.push({ specifier: match[1] ?? '', names: [] })
  }
  return records
}

function violationsIn(files: Record<string, string>): string[] {
  const found: string[] = []
  for (const [file, source] of Object.entries(files)) {
    for (const record of importsOf(source)) {
      for (const { pattern, why } of FORBIDDEN_SPECIFIERS) {
        if (pattern.test(record.specifier)) found.push(`${file}: imports ${record.specifier} (${why})`)
      }
      for (const { name, from } of FORBIDDEN_NAMES) {
        if (record.names.includes(name) && from.test(record.specifier)) {
          found.push(`${file}: imports ${name} from ${record.specifier}`)
        }
      }
    }
  }
  return found
}

describe('the controller (staff) world imports no participant skin', () => {
  it('scanned a real set of files (the guard is not vacuous)', () => {
    const files = Object.keys(SOURCES)
    expect(files.length).toBeGreaterThan(40)
    expect(files.some(file => file.endsWith('components/PersonaComposer.tsx'))).toBe(true)
    expect(files.some(file => file.endsWith('/MediaLibraryPicker.tsx'))).toBe(true)
    expect(files.some(file => file.includes('.test.'))).toBe(false)
  })

  it('no controller source imports PostCard, a participant part / page / theme, MUI icons, or a raw MUI Button / TextField', () => {
    expect(violationsIn(SOURCES)).toEqual([])
  })

  describe('the guard itself catches what it claims to', () => {
    const catches = (source: string) => violationsIn({ 'fixture.tsx': source }).length > 0

    it('flags the post card by path and by name', () => {
      expect(catches("import { PostCard } from '@/features/social'")).toBe(true)
      expect(catches("import { PostCard } from '@/features/social/components/PostCard'")).toBe(true)
      expect(catches("import { PostHeader } from '@/features/social/components/post/PostHeader'"))
        .toBe(true)
    })

    it('flags a participant theme / stylesheet / shell / brand skin', () => {
      expect(catches("import s from '@/features/social/theme/social.module.css'")).toBe(true)
      expect(catches("import { x } from '@/features/participant-shell/mountContract'")).toBe(true)
      expect(catches("import { BrandThemeProvider } from '../BrandThemeProvider'")).toBe(true)
    })

    it('flags MUI icons and a raw MUI Button / TextField', () => {
      expect(catches("import AddIcon from '@mui/icons-material/Add'")).toBe(true)
      expect(catches("import { Box, Button } from '@mui/material'")).toBe(true)
      expect(catches("import { TextField } from '@mui/material'")).toBe(true)
    })

    it('allows the shared primitives and the pure model / services', () => {
      expect(catches("import { Avatar, VerifiedMark, createPost } from '@/features/social'")).toBe(false)
      expect(catches("import { safeImageUrl } from '@/features/social/utils/safeImageUrl'")).toBe(false)
      expect(catches("import { IconButton, Box } from '@mui/material'")).toBe(false)
      expect(catches("import { CobraPrimaryButton } from '@/theme/styledComponents'")).toBe(false)
    })

    it('ignores prose in comments that merely names a forbidden thing', () => {
      expect(catches("// import { PostCard } from '@/features/social'\nconst x = 1")).toBe(false)
      expect(catches("/* never use PostCard */\nimport { Avatar } from '@/features/social'")).toBe(false)
    })
  })
})

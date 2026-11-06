/**
 * Story 13 source guards: the skin system imports no COBRA and no MUI icons
 * (two worlds), names no third-party font host, and authors no fiction-
 * breaking copy (no "exercise" / "preview" / "breaking" string in its output).
 * It also carries no channel's skin: only the neutral fallback and the two
 * replaceable stubs live under `tokens/`.
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SKIN_DIR = path.resolve(__dirname)

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

/** String literals only (comments stripped), so docs may still name the rules. */
function stringLiterals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return Array.from(code.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`]*)`|"([^"\\]*)"/g), m => m[1] ?? m[2] ?? m[3] ?? '')
}

const FILES = sourceFiles(SKIN_DIR)

describe('skin system source guards', () => {
  it('finds the skin sources', () => {
    expect(FILES.map(f => path.basename(f))).toEqual(expect.arrayContaining([
      'schema.ts', 'registry.ts', 'SkinScope.tsx', 'OutletSkinScope.tsx', 'SkinResetBoundary.tsx',
      'useOutletSkin.ts', 'contrast.ts', 'fonts.ts',
    ]))
  })

  it.each(FILES.map(f => [path.relative(SKIN_DIR, f), f]))('%s imports no COBRA and no MUI icons', (_n, file) => {
    const imports = fs.readFileSync(file, 'utf8').match(/^import[\s\S]*?from ['"][^'"]+['"]/gm) ?? []
    for (const statement of imports) {
      expect(statement).not.toMatch(/['"]@\/theme|cobra|styledComponents/i)
      expect(statement).not.toMatch(/@mui\/icons-material/)
    }
  })

  it.each(FILES.map(f => [path.relative(SKIN_DIR, f), f]))('%s names no third-party font host', (_n, file) => {
    expect(fs.readFileSync(file, 'utf8')).not.toMatch(/fonts\.googleapis|fonts\.gstatic|use\.typekit|fonts\.bunny/)
  })

  it.each(FILES.map(f => [path.relative(SKIN_DIR, f), f]))('%s authors no fiction-breaking string', (_n, file) => {
    for (const literal of stringLiterals(fs.readFileSync(file, 'utf8'))) {
      // Label-cased only: lowercase `breaking` is a token key (`palette.breaking`), not copy.
      expect(literal).not.toMatch(/\b(EXERCISE|PREVIEW|BREAKING|Exercise|Preview|Breaking)\b/)
    }
  })

  it('ships only the neutral fallback and the two replaceable stubs as token files', () => {
    expect(fs.readdirSync(path.join(SKIN_DIR, 'tokens')).sort()).toEqual(['neutral.ts', 'weather-desk.ts', 'wire-room.ts'])
  })
})

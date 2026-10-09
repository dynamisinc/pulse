/**
 * features/controller/runSheet/seedRunSheet.golden.test.ts
 * ---------------------------------------------------------------------------
 * The seed script's run-sheet export is importable by THIS importer, unedited
 * (demo-polish S1, story 24, AC "Run-sheet export"; Gate-1 M-4).
 *
 * `scripts/uat/test-fixtures/runsheet.demo.golden.json` is exactly what
 * `scripts/uat/Seed-DemoContent.ps1` writes for its fixture pack (fixed ids in
 * place of the live asset and post ids). The Pester suite regenerates it and
 * asserts it is byte-identical, so the seeder and this check cannot drift: if
 * the seeder's output changes, the golden file changes with it and must still
 * pass the real `parseRunSheetFile` here.
 *
 * The file is read off disk with the test-only `readFrontendFile` helper: it sits
 * outside the frontend root, where Vite's `server.fs.allow` refuses a `?raw` (or
 * JSON) import ("Denied ID"), and widening that for one fixture is not worth it.
 */
import { describe, expect, it } from 'vitest'
import { readFrontendFile } from '../../../test/readSource'
import { RUN_SHEET_SCHEMA_ID, parseRunSheetFile, serializeRunSheetFile } from './runSheetSchema'

const golden = readFrontendFile('../../scripts/uat/test-fixtures/runsheet.demo.golden.json')

describe('seed script run-sheet export (golden file)', () => {
  it('is the real export text, not an empty stub', () => {
    expect(golden).toContain(`"schema": "${RUN_SHEET_SCHEMA_ID}"`)
    expect(golden.endsWith('\n')).toBe(true)
  })

  it('is accepted by the console importer as it is', () => {
    const result = parseRunSheetFile(golden)
    if (!result.ok) throw new Error(`the importer refused the seeder's export: ${result.message}`)
    expect(result.sheet.name).toBe('Seed fixture run sheet')
    expect(result.exportedAt).toBe('2026-10-19T14:00:00.000Z')
    expect(result.sheet.beats).toHaveLength(1)
    const [beat] = result.sheet.beats
    if (beat === undefined) throw new Error('the golden run sheet has no beat')
    expect(beat.persona.handle).toBe('Newsline7')
    expect(beat.media).toEqual([
      {
        mediaId: '5eed0000-0000-4000-8000-00000000a001',
        alt: 'Test pattern standing in for a photo of standing water on a harbor road.',
      },
    ])
    expect(beat.replyTo).toEqual({ postId: '5eed0000-0000-4000-8000-00000000b002' })
  })

  it('round-trips: import(export(x)) deep-equals x', () => {
    const first = parseRunSheetFile(golden)
    if (!first.ok) throw new Error(first.message)
    const again = parseRunSheetFile(serializeRunSheetFile(first.sheet))
    if (!again.ok) throw new Error(again.message)
    expect(again.sheet).toEqual(first.sheet)
  })
})

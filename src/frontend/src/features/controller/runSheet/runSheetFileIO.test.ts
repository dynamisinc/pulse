/**
 * features/controller/runSheet/runSheetFileIO.test.ts
 * ---------------------------------------------------------------------------
 * The browser file plumbing for import / export (demo-polish C3): download names, the
 * object-URL download, and reading a picked file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadTextFile, readFileText, runSheetFilename } from './runSheetFileIO'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('runSheetFilename', () => {
  it('slugs the sheet name into <slug>.runsheet.json', () => {
    expect(runSheetFilename('Water Crisis - Demo!')).toBe('water-crisis-demo.runsheet.json')
    expect(runSheetFilename('  Ünïcode  ')).toBe('n-code.runsheet.json')
  })

  it('falls back to run-sheet for a name with no usable characters', () => {
    expect(runSheetFilename('!!!')).toBe('run-sheet.runsheet.json')
    expect(runSheetFilename('')).toBe('run-sheet.runsheet.json')
  })

  it('keeps the slug bounded', () => {
    expect(runSheetFilename('a'.repeat(200)).length).toBeLessThanOrEqual(60 + '.runsheet.json'.length)
  })
})

describe('downloadTextFile', () => {
  it('clicks a download anchor with the file name and revokes the object URL after', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => 'blob:test-url')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const seen: { download: string; href: string }[] = []
    click.mockImplementation(function (this: HTMLAnchorElement) {
      seen.push({ download: this.download, href: this.href })
    })

    downloadTextFile('sheet.runsheet.json', '{"a":1}\n')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0]
    expect(blob.type).toBe('application/json;charset=utf-8')
    expect(seen).toEqual([{ download: 'sheet.runsheet.json', href: 'blob:test-url' }])
    expect(document.querySelector('a[download]')).toBeNull()
    // Some browsers read the blob a moment after the click: the URL lives for a full second.
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(999)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url')
  })
})

describe('readFileText', () => {
  it('reads a picked file as text', async () => {
    await expect(readFileText(new File(['{"x":1}'], 'a.json'))).resolves.toBe('{"x":1}')
  })
})

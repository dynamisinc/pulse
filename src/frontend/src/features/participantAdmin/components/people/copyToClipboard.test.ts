/**
 * "Copy link" clipboard path and fallback (easy-login story 10, gotcha 10).
 * The secret must go to the clipboard without ever being rendered as DOM text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from './copyToClipboard'

const SECRET = 'https://pulse.example.test/join/FAKE-SECRET-TOKEN'

function stubClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

beforeEach(() => {
  // jsdom has no execCommand; tests that need it install one.
  Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true, writable: true })
})

afterEach(() => {
  stubClipboard(undefined)
  Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true, writable: true })
})

describe('copyToClipboard', () => {
  it('uses navigator.clipboard.writeText, called synchronously (inside the gesture)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })

    const pending = copyToClipboard(SECRET)
    // The write has ALREADY started before the first await resolves.
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(SECRET)
    await expect(pending).resolves.toBe(true)
  })

  it('falls back to execCommand("copy") through a transient textarea when there is no clipboard API', async () => {
    stubClipboard(undefined)
    let copiedValue: string | undefined
    let textContentAtCopy: string | null | undefined
    const execCommand = vi.fn((command: string) => {
      const active = document.activeElement
      if (active instanceof HTMLTextAreaElement) {
        copiedValue = active.value
        textContentAtCopy = active.textContent
      }
      return command === 'copy'
    })
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true })

    await expect(copyToClipboard(SECRET)).resolves.toBe(true)

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(copiedValue).toBe(SECRET)
    // The secret was the textarea's VALUE, never DOM text content.
    expect(textContentAtCopy).toBe('')
    // And the element is gone straight after: nothing renders the secret.
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.body.textContent).not.toContain(SECRET)
  })

  it('falls back to execCommand when writeText rejects (permission denied)', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true })

    await expect(copyToClipboard(SECRET)).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('a SYNCHRONOUS writeText throw is caught and falls back in the same turn (inside the gesture)', async () => {
    stubClipboard({ writeText: vi.fn(() => { throw new Error('boom') }) })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true })

    const pending = copyToClipboard(SECRET)

    // The fallback has ALREADY run, before any await: it was not deferred out of the click.
    expect(execCommand).toHaveBeenCalledWith('copy')
    await expect(pending).resolves.toBe(true)
  })

  it('a synchronous throw with no working fallback reports false rather than throwing', async () => {
    stubClipboard({ writeText: vi.fn(() => { throw new Error('boom') }) })
    await expect(copyToClipboard(SECRET)).resolves.toBe(false)
  })

  it('reports failure (false), never throwing, when nothing can copy', async () => {
    stubClipboard(undefined)
    await expect(copyToClipboard(SECRET)).resolves.toBe(false)

    const execCommand = vi.fn().mockReturnValue(false)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true })
    await expect(copyToClipboard(SECRET)).resolves.toBe(false)

    execCommand.mockImplementation(() => { throw new Error('nope') })
    await expect(copyToClipboard(SECRET)).resolves.toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('returns focus to the element that had it', async () => {
    stubClipboard(undefined)
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
      writable: true,
    })
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()

    await copyToClipboard(SECRET)

    expect(document.activeElement).toBe(button)
    button.remove()
  })
})

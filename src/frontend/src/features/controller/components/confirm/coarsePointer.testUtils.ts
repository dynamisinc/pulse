/**
 * features/controller/components/confirm/coarsePointer.testUtils.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY. Swaps `window.matchMedia` so `(pointer: coarse)` reads as `coarse`, and can fake a
 * `window.visualViewport` (the on-screen keyboard). Never imported by app code.
 * Call `restoreMatchMedia()` in `afterEach`.
 */

const realMatchMedia = window.matchMedia

export function mockPointer(coarse: boolean): void {
  window.matchMedia = ((query: string): MediaQueryList => ({
    matches: coarse && query.includes('pointer: coarse'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

export function restoreMatchMedia(): void {
  window.matchMedia = realMatchMedia
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
}

/** A fake visual viewport `height` px tall (the keyboard covers the rest of `innerHeight`). */
export function mockVisualViewport(height: number, offsetTop = 0): void {
  const target = new EventTarget() as EventTarget & { height: number, offsetTop: number }
  target.height = height
  target.offsetTop = offsetTop
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: target })
}

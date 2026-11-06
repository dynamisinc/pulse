/**
 * features/channels/primitives/announcer/arrivalCoalescer.ts
 * ---------------------------------------------------------------------------
 * The rate limit behind `LiveRegionAnnouncer` (channels-foundation 14; NFR-001,
 * NFR-002 burst legibility): at most ONE announcement per window (5 s), with every
 * arrival inside the window folded into the next one.
 *
 *   arrivals:  1 . . 2 . 1 . . . . | . . . . .
 *   speaks:    "1 new story"       | "3 new stories"   (window closes with 3 pending)
 *
 * The first arrival after a quiet window speaks at once; arrivals during an open window
 * accumulate and speak when it closes (which opens the next window). Uses timers only
 * (no clock reads), so it cannot leak wall-clock time into the fiction.
 */

export const ANNOUNCE_WINDOW_MS = 5_000

export interface ArrivalCoalescer {
  /** Records `count` new arrivals. */
  readonly add: (count: number) => void
  /** Stops the timer; pending arrivals are dropped. */
  readonly dispose: () => void
}

export function createArrivalCoalescer(
  announce: (count: number) => void,
  windowMs: number = ANNOUNCE_WINDOW_MS,
): ArrivalCoalescer {
  let pending = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const openWindow = () => {
    timer = setTimeout(() => {
      timer = undefined
      if (pending > 0) flush()
    }, windowMs)
  }

  const flush = () => {
    const count = pending
    pending = 0
    announce(count)
    openWindow()
  }

  return {
    add: count => {
      const whole = Math.floor(count)
      if (!Number.isFinite(whole) || whole <= 0) return
      pending += whole
      if (timer === undefined) flush()
    },
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      pending = 0
    },
  }
}

/** "1 new story" / "3 new stories". */
export function arrivalMessage(
  count: number,
  noun: { readonly one: string; readonly other: string },
): string {
  return `${count} new ${count === 1 ? noun.one : noun.other}`
}

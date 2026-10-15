/**
 * features/participantAdmin/test/userEvents.ts
 * ---------------------------------------------------------------------------
 * `user-event` helpers for the roster tests. The default `userEvent.setup()`
 * yields a macrotask between every keystroke, and each keystroke re-renders a
 * MUI form (or the whole page); under a loaded CI box that turned a ten-letter
 * name into seconds. `delay: null` removes the yield, and `fill` enters text as
 * ONE input event (click, then paste), which is what these tests mean by "the
 * user typed a value" — none of them asserts per-keystroke behaviour.
 */
import userEvent from '@testing-library/user-event'

export type RosterUser = ReturnType<typeof userEvent.setup>

/** A `user-event` instance with no per-keystroke yield. */
export function setupUser(): RosterUser {
  return userEvent.setup({ delay: null })
}

/** Focuses `element` and enters `text` as a single input event. */
export async function fill(user: RosterUser, element: HTMLElement, text: string): Promise<void> {
  await user.click(element)
  await user.paste(text)
}

/** A promise a test settles by hand, to hold a request "in flight". */
export interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

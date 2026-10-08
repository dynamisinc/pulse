/**
 * features/social/pages/Feed.headingId.test.tsx
 * ---------------------------------------------------------------------------
 * Wave 2 Gate-2 low: the feed's sr-only `<h1>` used a literal `id="feed-heading"`, but
 * Home mounts TWO `<Feed>` instances (All Posts, then the lazily mounted Following), so
 * the document held a duplicate id and the second section's `aria-labelledby` could
 * resolve to the FIRST instance's heading. The id now comes from `useId()`: every
 * instance's heading id is unique and each section is labelled by its OWN heading.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { Feed } from './Feed'

afterEach(() => {
  resetTelemetryBuffer()
})

describe('Feed — heading id is per instance', () => {
  it('two mounted feeds share no id and each section is labelled by its own <h1>', async () => {
    render(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <Feed scope="all" />
            <Feed scope="following" />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(2))

    const ids = Array.from(document.querySelectorAll('[id]')).map(element => element.id)
    expect(new Set(ids).size).toBe(ids.length)

    const sections = Array.from(document.querySelectorAll('section'))
    expect(sections).toHaveLength(2)
    for (const section of sections) {
      const labelledBy = section.getAttribute('aria-labelledby')
      expect(labelledBy).not.toBeNull()
      const heading = document.getElementById(labelledBy ?? '')
      expect(heading).not.toBeNull()
      expect(section.contains(heading)).toBe(true)
    }
  })
})

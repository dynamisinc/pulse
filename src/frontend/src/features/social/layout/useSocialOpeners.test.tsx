/**
 * features/social/layout/useSocialOpeners.test.tsx
 * ---------------------------------------------------------------------------
 * The thread / profile / hashtag openers (demo-polish F1): each is a `navigate()`
 * over the adapter, with a STABLE identity (the feed's memoized rows depend on it
 * -- NFR-002/SOC-071), and a profile tap that races the persona directory's first
 * load is completed when the directory resolves instead of being dropped.
 */
import { useEffect, type ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { personaById, personaIdForHandle, type Persona } from '@/features/personas'
import { MemorySocialNavigationProvider } from './SocialNavigationProvider'
import { SocialDirectoryContext, type SocialDirectory } from './socialDirectory'
import { useSocialNavigation } from './socialNavigation'
import { useSocialOpeners, type SocialOpeners } from './useSocialOpeners'

function seeded(handle: string): Persona {
  const found = personaById(personaIdForHandle(handle))
  if (!found) throw new Error(`fixture missing seeded persona @${handle}`)
  return found
}

function directoryOf(personas: Persona[], loading = false): SocialDirectory {
  return {
    personas,
    loading,
    error: undefined,
    self: undefined,
    findByHandle: handle =>
      personas.find(p => p.handle.toLowerCase() === handle.toLowerCase()),
    findById: id => personas.find(p => p.id === id),
  }
}

function Where() {
  const { location } = useSocialNavigation()
  return <output data-testid="where">{location.pathname}</output>
}

function Probe({ onOpeners }: { onOpeners: (openers: SocialOpeners) => void }) {
  const openers = useSocialOpeners()
  useEffect(() => onOpeners(openers))
  return null
}

function Stack({ directory, children }: { directory: SocialDirectory; children: ReactNode }) {
  return (
    <MemorySocialNavigationProvider>
      <SocialDirectoryContext.Provider value={directory}>
        {children}
        <Where />
      </SocialDirectoryContext.Provider>
    </MemorySocialNavigationProvider>
  )
}

describe('useSocialOpeners', () => {
  it('opens a thread, a hashtag, and a profile (by persona id -> handle)', () => {
    const ref: { current: SocialOpeners | undefined } = { current: undefined }
    render(
      <Stack directory={directoryOf([seeded('FulcoEM')])}>
        <Probe onOpeners={o => { ref.current = o }} />
      </Stack>,
    )
    const openers = ref.current
    if (openers === undefined) throw new Error('openers not captured')

    act(() => openers.openThread('post-1'))
    expect(screen.getByTestId('where')).toHaveTextContent('/i/status/post-1')
    act(() => openers.openThread('post-2', 'FulcoEM'))
    expect(screen.getByTestId('where')).toHaveTextContent('/FulcoEM/status/post-2')
    act(() => openers.openHashtag('waterissues'))
    expect(screen.getByTestId('where')).toHaveTextContent('/hashtag/waterissues')
    act(() => openers.openProfile(seeded('FulcoEM').id))
    expect(screen.getByTestId('where')).toHaveTextContent('/FulcoEM')
  })

  it('keeps the same identity across navigations', () => {
    const seen: SocialOpeners[] = []
    render(
      <Stack directory={directoryOf([seeded('FulcoEM')])}>
        <Probe onOpeners={o => { seen.push(o) }} />
      </Stack>,
    )
    const first = seen[0]
    if (first === undefined) throw new Error('openers not captured')
    act(() => first.openHashtag('a'))
    act(() => first.openHashtag('b'))
    expect(new Set(seen).size).toBe(1)
  })

  it('ignores a persona the settled directory does not know (no invented URL)', () => {
    const ref: { current: SocialOpeners | undefined } = { current: undefined }
    render(
      <Stack directory={directoryOf([seeded('FulcoEM')])}>
        <Probe onOpeners={o => { ref.current = o }} />
      </Stack>,
    )
    act(() => ref.current?.openProfile('persona-nobody'))
    expect(screen.getByTestId('where')).toHaveTextContent('/home')
  })

  it('completes a profile tap that arrived while the directory was still loading', () => {
    const ref: { current: SocialOpeners | undefined } = { current: undefined }
    const probe = <Probe onOpeners={o => { ref.current = o }} />
    const { rerender } = render(<Stack directory={directoryOf([], true)}>{probe}</Stack>)

    act(() => ref.current?.openProfile(seeded('FulcoEM').id))
    // Directory still loading: nothing yet, but the tap is remembered.
    expect(screen.getByTestId('where')).toHaveTextContent('/home')

    rerender(<Stack directory={directoryOf([seeded('FulcoEM')])}>{probe}</Stack>)
    expect(screen.getByTestId('where')).toHaveTextContent('/FulcoEM')
  })
})

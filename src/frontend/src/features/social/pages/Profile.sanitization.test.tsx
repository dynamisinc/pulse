/**
 * features/social/pages/Profile.sanitization.test.tsx
 * ---------------------------------------------------------------------------
 * QA addendum to Profile.test.tsx (story 01) covering NFR-004 content
 * security on the profile identity hero: `displayName` and `bio` are
 * persona-authored free text (COR-020 `voiceNotes`/`backstory` neighbors) and
 * render directly in the hero (`persona.displayName`, `persona.bio`). This
 * mocks `usePersonas()` (same technique as
 * `PersonaPicker.exerciseScope.test.tsx`) to inject a persona whose fields
 * carry an HTML/script stored-XSS payload, and proves:
 *  - the payload is never parsed as markup (no injected element/handler
 *    attaches to the DOM — JSX text interpolation escapes it by construction,
 *    but this test guards against a future switch to `dangerouslySetInnerHTML`
 *    on this path);
 *  - the raw text is still visible to the participant, unescaped-looking, so
 *    a payload can't silently vanish either (an honest, inert render).
 *
 * `useFeed` is mocked too (isolated unit — no need to exercise the real feed
 * convergence here) so this authored-fields-only persona resolves with zero
 * posts, keeping the assertions scoped to the hero.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { api } from '@/core/services/api'
import type { Persona, UsePersonasResult } from '@/features/personas'
import type { UseFeedResult } from '../hooks/useFeed'
import { Profile } from './Profile'

const SCRIPT_PAYLOAD = '<script>window.__xss = true</script>'
const IMG_PAYLOAD = '<img src=x onerror="window.__xss = true">'

const MALICIOUS_PERSONA: Persona = {
  id: 'persona-xss-hero',
  exerciseId: 'ex-mock-0001',
  templateId: 'tmpl-xss-hero',
  displayName: `Innocent Name ${IMG_PAYLOAD}`,
  handle: 'xsshero',
  kind: 'human',
  personaType: 'citizen',
  verified: false,
  avatarColor: '#334455',
  initials: 'IX',
  bio: `Just a resident. ${SCRIPT_PAYLOAD}`,
  audienceBand: 'nano',
  followerCount: 3,
  joinedAt: '2033-01-01T00:00:00.000Z',
}

const usePersonasMock = vi.fn<() => UsePersonasResult>(() => ({
  personas: [MALICIOUS_PERSONA],
  loading: false,
  error: undefined,
}))

const useFeedMock = vi.fn<() => UseFeedResult>(() => ({
  posts: [],
  loading: false,
  error: undefined,
}))

vi.mock('@/features/personas', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/personas')>()
  return {
    ...actual,
    usePersonas: () => usePersonasMock(),
  }
})

vi.mock('../hooks/useFeed', () => ({
  useFeed: () => useFeedMock(),
}))

function renderProfile() {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <Profile personaId={MALICIOUS_PERSONA.id} />
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

beforeEach(() => {
  resetTelemetryBuffer()
  vi.spyOn(api, 'post').mockResolvedValue({ data: {}, status: 200, statusText: 'OK', headers: {}, config: {} })
  ;(window as unknown as { __xss?: boolean }).__xss = false
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as unknown as { __xss?: boolean }).__xss
})

describe('Profile — content security on the identity hero (NFR-004)', () => {
  it('never executes a stored-XSS payload from displayName or bio', async () => {
    renderProfile()
    await screen.findByTestId('profile-identity')

    // No injected <script>/onerror handler ran.
    expect((window as unknown as { __xss?: boolean }).__xss).toBe(false)

    const hero = screen.getByTestId('profile-identity')
    // No stray <script> or <img> element made it into the DOM from the payload.
    expect(hero.querySelector('script')).toBeNull()
    expect(hero.querySelector('img[onerror]')).toBeNull()
  })

  it('renders the raw text inertly (visible, not silently dropped)', async () => {
    renderProfile()
    const hero = await screen.findByTestId('profile-identity')

    expect(within(hero).getByText(/Innocent Name/)).toBeInTheDocument()
    expect(hero.textContent).toContain('<img src=x onerror="window.__xss = true">')
    expect(screen.getByText(/Just a resident\./)).toHaveTextContent(SCRIPT_PAYLOAD)
  })
})

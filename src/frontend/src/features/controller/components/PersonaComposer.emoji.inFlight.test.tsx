/**
 * features/controller/components/PersonaComposer.emoji.inFlight.test.tsx
 * ---------------------------------------------------------------------------
 * Demo-feedback story 12b (#508): the persona composer's emoji button while a post is
 * IN FLIGHT. The composer hands `useEmojiPicker` `disabled: locked` (`compose.isPublishing`),
 * so while the request is out the text field is read-only AND the emoji button is
 * disabled, and a picker that was open when Post went out closes (it cannot splice an
 * emoji into a draft that is being sent). When the request settles the button is usable
 * again and the picker stays closed.
 *
 * Needs a request that stays PENDING, so this runs in LIVE mode against a hand-settled
 * `publishPost` mock - the harness of `PersonaComposer.inFlight.test.tsx`. Those module
 * mocks are file-wide, which is why this is not in `PersonaComposer.emoji.test.tsx`
 * (mock mode, the real exercise provider).
 */
import { useState, type ReactNode } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { useExerciseContext } from '@/core/exerciseContext'
import type { StaffPersona } from '@/features/personas'
import type { CreatedPostView } from '@/features/social'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { PersonaComposer } from './PersonaComposer'

// Demo-feedback story 11 (DF-14): the console's write controls render only for a controller
// session, and this suite mounts none, so the read-only gate is fixed to "controller" here.
vi.mock('@/features/controller/access/useCanControl', () => ({ useCanControl: () => true }))

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined), get: vi.fn() },
}))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('@/features/social/services/livePostActions', () => ({ publishPost: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

import { publishPost } from '@/features/social/services/livePostActions'

const POST_FIELD = 'Post as Fairhaven Water'
const DRAFT = 'Boil-water order lifted for zones 2-4.'

const PERSONA: StaffPersona = {
  id: 'persona-fairhavenwater',
  exerciseId: 'ex-live-0001',
  templateId: 'tmpl-fairhaven-water',
  displayName: 'Fairhaven Water',
  handle: 'FairhavenWater',
  kind: 'org',
  personaType: 'agency',
  verified: true,
  avatarColor: '#1d4ed8',
  initials: 'FW',
  audienceBand: 'mid',
  followerCount: 4200,
  joinedAt: '2030-01-01T00:00:00Z',
}

const CREATED: CreatedPostView = {
  id: '4f9c1f6e-0000-4000-8000-0000000000bb',
  authorPersonaId: 'persona-fairhavenwater',
  text: DRAFT,
  scenarioTime: '2033-09-04T15:30:00.0000000+00:00',
  counts: { reply: 0, repost: 0, like: 0 },
}

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return (
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  )
}

/** The next `publishPost` call, settled by hand. */
function pendingRequest() {
  let resolve: (view: CreatedPostView) => void = () => undefined
  const promise = new Promise<CreatedPostView>(res => {
    resolve = res
  })
  vi.mocked(publishPost).mockReturnValueOnce(promise)
  return { succeed: () => act(async () => { resolve(CREATED) }) }
}

const field = () => screen.getByLabelText<HTMLTextAreaElement>(POST_FIELD)
const emojiButton = () =>
  within(screen.getByTestId('persona-composer')).getByRole('button', { name: 'Add emoji' })
const picker = () => screen.queryByRole('dialog', { name: 'Emoji picker' })

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-live-0001',
    exerciseName: 'Coastal Surge (Live)',
    timeZone: 'America/New_York',
    status: 'active',
  })
  vi.mocked(publishPost).mockReset().mockResolvedValue(CREATED)
  composeAsPersonaDraftStore.resetForTests()
})

describe('PersonaComposer — emoji button while a post is in flight (story 12b)', () => {
  it('is disabled, and an open picker closes, until the request settles', async () => {
    const request = pendingRequest()
    const user = userEvent.setup()
    render(
      <Providers>
        <PersonaComposer activePersona={PERSONA} actingHumanId="human-ctl-7" callSign="SIMCELL-3" />
      </Providers>,
    )
    fireEvent.change(field(), { target: { value: DRAFT } })

    // The picker is open when Post goes out (Ctrl+Enter from the text field).
    await user.click(emojiButton())
    expect(picker()).toBeInTheDocument()
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
    expect(await screen.findByTestId('publishing')).toBeInTheDocument()
    expect(publishPost).toHaveBeenCalledTimes(1)

    expect(picker()).not.toBeInTheDocument()
    expect(emojiButton()).toBeDisabled()
    expect(emojiButton()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(emojiButton())
    expect(picker()).not.toBeInTheDocument()
    expect(field()).toHaveValue(DRAFT)

    // Settled: the button is usable again, and the picker did not pop back open.
    await request.succeed()
    expect(screen.getByTestId('publish-success')).toBeInTheDocument()
    expect(emojiButton()).toBeEnabled()
    expect(picker()).not.toBeInTheDocument()
    expect(publishPost).toHaveBeenCalledTimes(1)
  })
})

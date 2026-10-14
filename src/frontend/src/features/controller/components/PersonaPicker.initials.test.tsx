/**
 * features/controller/components/PersonaPicker.initials.test.tsx
 * ---------------------------------------------------------------------------
 * The staff picker's avatar disc when a persona has NO initials (Wave 3 Gate-2 B S-2). The
 * server computes `initials` as the first letter or digit of each word, so an org named only with
 * emoji or punctuation has `initials === ""`. The participant `Avatar` shows its silhouette then;
 * the picker used to draw an EMPTY coloured disc, which reads as a rendering bug. It now draws the
 * same silhouette (decorative, `aria-hidden`; the name beside it identifies the persona) and keeps
 * the initials for everyone else - including whitespace-only strings.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import type { StaffPersona } from '@/features/personas'
import { ActivePersonaProvider } from '../hooks/useActivePersona'
import { PersonaPicker } from './PersonaPicker'

function persona(id: string, initials: string): StaffPersona {
  return {
    id,
    exerciseId: 'ex-mock-0001',
    templateId: `tmpl-${id}`,
    displayName: `Persona ${id}`,
    handle: id,
    kind: 'org',
    personaType: 'agency',
    verified: false,
    avatarColor: '#334455',
    initials,
    audienceBand: 'micro',
    followerCount: 10,
    joinedAt: '2026-01-01T00:00:00.000Z',
  }
}

function renderPicker(personas: StaffPersona[]) {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ActivePersonaProvider>
        <PersonaPicker personas={personas} onSelect={vi.fn()} />
      </ActivePersonaProvider>
    </ThemeProvider>,
  )
}

describe('PersonaPicker - the avatar disc', () => {
  it('shows the initials when there are some', () => {
    renderPicker([persona('fw', 'FW')])
    const row = screen.getByTestId('persona-picker-option-fw')
    expect(row).toHaveTextContent('FW')
    expect(within(row).queryByTestId('persona-picker-silhouette-fw')).toBeNull()
  })

  it('shows a silhouette, never an empty disc, when initials are ""', () => {
    renderPicker([persona('emoji', '')])
    const row = screen.getByTestId('persona-picker-option-emoji')
    const silhouette = within(row).getByTestId('persona-picker-silhouette-emoji')
    expect(silhouette.tagName.toLowerCase()).toBe('svg')
    // Decorative: the disc is aria-hidden, the display name identifies the persona.
    expect(silhouette.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(row).toHaveTextContent('Persona emoji')
  })

  it('treats whitespace-only initials as none', () => {
    renderPicker([persona('blank', '  ')])
    expect(screen.getByTestId('persona-picker-silhouette-blank')).toBeInTheDocument()
  })
})

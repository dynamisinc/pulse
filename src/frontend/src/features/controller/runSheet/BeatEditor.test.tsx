/**
 * features/controller/runSheet/BeatEditor.test.tsx
 * ---------------------------------------------------------------------------
 * The beat editor in isolation (demo-polish C3, AC "Author beats"): what it hands C1's
 * `MediaLibraryPicker` (the FROZEN props), media that is not in the library, an existing
 * video beat editing as a video, thumbnail URL safety, and its keyboard (Ctrl/Cmd+Enter
 * saves, Esc closes - asking first when the beat has unsaved changes, Gate-2 A L-7). The
 * full add / edit flows are covered through the panel in
 * `RunSheetPanel.test.tsx`.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import type { MediaKind, StaffMediaAssetView } from '@/core/media'

// The frozen picker props (implementation.md §1.11), restated: these tests depend on the
// contract, not on how C1 declares its types.
interface PickerProps {
  kind?: MediaKind
  max: number
  selectedIds: string[]
  onChange(ids: string[]): void
}
const picker = vi.hoisted(() => ({ renders: [] as unknown[] }))
vi.mock('@/features/controller/media/MediaLibraryPicker', async () => {
  const React = await import('react')
  return {
    MediaLibraryPicker: (props: PickerProps) => {
      picker.renders.push(props)
      return React.createElement('div', { 'data-testid': 'mock-picker' })
    },
  }
})

import { BeatEditor, type BeatEditorProps } from './BeatEditor'
import { beatFixture, personaFixture, sheetFixture } from './runSheetTestKit'

const asset = (overrides: Partial<StaffMediaAssetView> & { id: string }): StaffMediaAssetView => ({
  kind: 'image',
  url: '/mock-media/photo.svg',
  fileName: `${overrides.id}.jpg`,
  uploadedAtScenario: '2033-09-04T12:00:00.000Z',
  ...overrides,
})

function renderEditor(props: Partial<BeatEditorProps> = {}) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  const utils = render(
    <ThemeProvider theme={cobraTheme}>
      <BeatEditor
        data={sheetFixture([])}
        personas={[personaFixture('FulcoEM'), personaFixture('tbrandt41')]}
        onSave={onSave}
        onCancel={onCancel}
        {...props}
      />
    </ThemeProvider>,
  )
  return { ...utils, onSave, onCancel, user: userEvent.setup({ delay: null }) }
}

// Full-panel renders (MUI + emotion + the exercise context) are slow on a loaded CI box:
// give each test a generous budget instead of the 10s default.
vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  picker.renders.length = 0
})

describe('BeatEditor', () => {
  it('hands the picker exactly the frozen props: kind, max, selectedIds, onChange', () => {
    renderEditor()
    const props = picker.renders.at(-1) as PickerProps
    expect(Object.keys(props).sort()).toEqual(['kind', 'max', 'onChange', 'selectedIds'])
    expect(props).toMatchObject({ kind: 'image', max: 4, selectedIds: [] })
  })

  it('edits an existing VIDEO beat as a video (max 1), using the library to tell the kind', () => {
    const beat = beatFixture({ media: [{ mediaId: 'vid-1', alt: 'A clip of the plant' }] })
    renderEditor({
      beat,
      data: sheetFixture([beat]),
      library: new Map([['vid-1', asset({ id: 'vid-1', kind: 'video', url: '/mock-media/c.mp4', posterUrl: '/mock-media/c.svg' })]]),
    })
    expect(picker.renders.at(-1)).toMatchObject({ kind: 'video', max: 1, selectedIds: ['vid-1'] })
    expect(screen.getByRole('radio', { name: 'One video' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Images (up to 4)' })).toBeDisabled()
  })

  it('flags media that is not in the library, without blocking the save', async () => {
    const beat = beatFixture({ media: [{ mediaId: 'ghost', alt: 'A photo' }] })
    const { user, onSave } = renderEditor({ beat, data: sheetFixture([beat]), library: new Map() })
    expect(screen.getByTestId('media-missing-note')).toHaveTextContent(
      "Not in this exercise's media library. You can still save, but firing may be refused.",
    )
    await user.click(screen.getByRole('button', { name: 'Save beat' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ media: [{ mediaId: 'ghost', alt: 'A photo' }] })
  })

  it('flags nothing while the library has not loaded', () => {
    const beat = beatFixture({ media: [{ mediaId: 'ghost', alt: 'A photo' }] })
    renderEditor({ beat, data: sheetFixture([beat]) })
    expect(screen.queryByTestId('media-missing-note')).toBeNull()
  })

  it('shows a thumbnail only for URLs the app-wide media allow-list accepts (M-3)', () => {
    const urls: Record<string, string> = {
      'ok-rel': '/mock-media/a.svg',
      'ok-https': 'https://cdn.example.test/b.jpg',
      'bad-js': 'javascript:alert(1)',
      'bad-proto-relative': '//evil.example.test/x.jpg',
      'bad-backslash': '/\\evil.example.test/x.jpg',
      'bad-credentials': 'https://user:pw@cdn.example.test/x.jpg',
      'bad-control': 'https://cdn.example.test/a\tb.jpg',
      'bad-data': 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'bad-http': 'http://cdn.example.test/x.jpg',
    }
    const beat = beatFixture({
      media: Object.keys(urls).map(mediaId => ({ mediaId, alt: mediaId })),
    })
    const { container } = renderEditor({
      beat,
      data: sheetFixture([beat]),
      library: new Map(Object.entries(urls).map(([id, url]) => [id, asset({ id, url })])),
    })
    const sources = [...container.ownerDocument.querySelectorAll('img')].map(img =>
      img.getAttribute('src'))
    expect(sources).toEqual(['/mock-media/a.svg', 'https://cdn.example.test/b.jpg'])
  })

  it('a video\'s thumbnail is its poster, put through the same allow-list', () => {
    const beat = beatFixture({
      media: [
        { mediaId: 'v-ok', alt: 'clip one' },
        { mediaId: 'v-bad', alt: 'clip two' },
      ],
    })
    const { container } = renderEditor({
      beat,
      data: sheetFixture([beat]),
      library: new Map([
        ['v-ok', asset({ id: 'v-ok', kind: 'video', url: '/v.mp4', posterUrl: '/mock-media/p.svg' })],
        ['v-bad', asset({ id: 'v-bad', kind: 'video', url: '/v2.mp4', posterUrl: 'javascript:alert(1)' })],
      ]),
    })
    const sources = [...container.ownerDocument.querySelectorAll('img')].map(img =>
      img.getAttribute('src'))
    expect(sources).toEqual(['/mock-media/p.svg'])
  })

  it('saves with Ctrl+Enter from a field and cancels (after asking) with Escape', async () => {
    const { user, onSave, onCancel } = renderEditor()
    const dialog = screen.getByRole('dialog', { name: 'New beat' })
    await user.type(within(dialog).getByLabelText(/^Title/), 'Quick save')
    await user.selectOptions(within(dialog).getByLabelText(/^Persona/), 'FulcoEM')
    await user.type(within(dialog).getByLabelText('Text'), 'Hello world{Control>}{Enter}{/Control}')
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      title: 'Quick save',
      persona: { handle: 'FulcoEM' },
      text: 'Hello world',
    })

    // The beat has unsaved changes, so Esc ASKS first (Gate-2 A L-7) instead of discarding.
    await user.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByTestId('beat-discard-question')).toHaveTextContent('Discard changes?')
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('keeps an unknown persona handle visible and selectable instead of dropping it', () => {
    const beat = beatFixture({ persona: { handle: 'retired_account' } })
    renderEditor({ beat, data: sheetFixture([beat]) })
    const select = screen.getByLabelText(/^Persona/)
    expect(select).toHaveValue('retired_account')
    expect(within(select).getByRole('option', { name: '@retired_account (not found in this exercise)' }))
      .toBeInTheDocument()
  })

  it('moves focus into the first field on open', () => {
    renderEditor()
    expect(screen.getByLabelText(/^Title/)).toHaveFocus()
  })
})

describe('BeatEditor - leaving with unsaved changes (Gate-2 A L-7)', () => {
  const question = () => screen.queryByTestId('beat-discard-question')
  const backdrop = () => document.querySelector<HTMLElement>('.MuiBackdrop-root')

  it('a CLEAN beat closes at once on Esc and on a backdrop click (as before)', async () => {
    const first = renderEditor()
    await first.user.keyboard('{Escape}')
    expect(first.onCancel).toHaveBeenCalledTimes(1)
    expect(question()).toBeNull()
    first.unmount()

    const second = renderEditor()
    const target = backdrop()
    if (target === null) throw new Error('no backdrop')
    await second.user.click(target)
    expect(second.onCancel).toHaveBeenCalledTimes(1)
    expect(question()).toBeNull()
  })

  it('a clean EXISTING beat also closes at once (opening it is not "changing" it)', async () => {
    const beat = beatFixture({ persona: { handle: 'FulcoEM' } })
    const { user, onCancel } = renderEditor({ beat, data: sheetFixture([beat]) })
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Esc on a DIRTY beat asks "Discard changes?" with focus on "Keep editing"', async () => {
    const { user, onCancel } = renderEditor()
    await user.type(screen.getByLabelText(/^Title/), 'Half-written')

    await user.keyboard('{Escape}')

    const asked = question()
    expect(asked).not.toBeNull()
    expect(asked).toHaveAttribute('role', 'alert')
    expect(asked).toHaveTextContent('Discard changes?')
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    expect(onCancel).not.toHaveBeenCalled()
    // Still the same editor, with the typed text intact.
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Half-written')
  })

  it('a backdrop click on a DIRTY beat asks too, and never discards by itself', async () => {
    const { user, onCancel } = renderEditor()
    await user.type(screen.getByLabelText(/^Title/), 'Half-written')
    const target = backdrop()
    if (target === null) throw new Error('no backdrop')

    await user.click(target)

    expect(question()).not.toBeNull()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('"Keep editing" (and Esc on the question) return to the work, which is intact', async () => {
    const { user, onCancel } = renderEditor()
    const title = screen.getByLabelText(/^Title/)
    await user.type(title, 'Half-written')
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(question()).toBeNull()
    await waitFor(() => expect(title).toHaveFocus())
    expect(title).toHaveValue('Half-written')

    await user.keyboard('{Escape}')
    expect(question()).not.toBeNull()
    await user.keyboard('{Escape}')
    expect(question()).toBeNull()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('"Discard changes" closes the editor', async () => {
    const { user, onCancel } = renderEditor()
    await user.type(screen.getByLabelText(/^Title/), 'Half-written')
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Discard changes' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('the Cancel button is an explicit decision: it closes without asking', async () => {
    const { user, onCancel } = renderEditor()
    await user.type(screen.getByLabelText(/^Title/), 'Half-written')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(question()).toBeNull()
  })

  it('undoing the edit makes the beat clean again (no question)', async () => {
    const { user, onCancel } = renderEditor()
    const title = screen.getByLabelText(/^Title/)
    await user.type(title, 'abc')
    await user.clear(title)

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(question()).toBeNull()
  })

  it('changing an existing beat counts as dirty', async () => {
    const beat = beatFixture({ persona: { handle: 'FulcoEM' } })
    const { user, onCancel } = renderEditor({ beat, data: sheetFixture([beat]) })
    await user.type(screen.getByLabelText(/^Title/), ' (edited)')

    await user.keyboard('{Escape}')

    expect(question()).not.toBeNull()
    expect(onCancel).not.toHaveBeenCalled()
  })
})

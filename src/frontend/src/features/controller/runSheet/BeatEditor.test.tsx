/**
 * features/controller/runSheet/BeatEditor.test.tsx
 * ---------------------------------------------------------------------------
 * The beat editor in isolation (demo-polish C3, AC "Author beats"): what it hands C1's
 * `MediaLibraryPicker` (the FROZEN props), media that is not in the library, an existing
 * video beat editing as a video, thumbnail URL safety, and its keyboard (Ctrl/Cmd+Enter
 * saves, Esc cancels). The full add / edit flows are covered through the panel in
 * `RunSheetPanel.test.tsx`.
 */
import { render, screen, within } from '@testing-library/react'
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

  it('shows a thumbnail only for safe URLs (https, blob, root-relative), never javascript:', () => {
    const beat = beatFixture({
      media: [
        { mediaId: 'ok-rel', alt: 'a' },
        { mediaId: 'ok-https', alt: 'b' },
        { mediaId: 'bad-js', alt: 'c' },
        { mediaId: 'bad-proto', alt: 'd' },
      ],
    })
    const { container } = renderEditor({
      beat,
      data: sheetFixture([beat]),
      library: new Map([
        ['ok-rel', asset({ id: 'ok-rel', url: '/mock-media/a.svg' })],
        ['ok-https', asset({ id: 'ok-https', url: 'https://cdn.example.test/b.jpg' })],
        ['bad-js', asset({ id: 'bad-js', url: 'javascript:alert(1)' })],
        ['bad-proto', asset({ id: 'bad-proto', url: '//evil.example.test/x.jpg' })],
      ]),
    })
    const sources = [...container.ownerDocument.querySelectorAll('img')].map(img => img.getAttribute('src'))
    expect(sources).toEqual(['/mock-media/a.svg', 'https://cdn.example.test/b.jpg'])
  })

  it('saves with Ctrl+Enter from a field and cancels with Escape', async () => {
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

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
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

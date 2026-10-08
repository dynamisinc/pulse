/**
 * features/controller/runSheet/media/InjectMediaField.test.tsx
 * ---------------------------------------------------------------------------
 * The ONE media adapter of the run-sheet editor (inject-queue story 07; C1's
 * `MediaLibraryPicker` will be imported in this module alone when it lands):
 *  - lists the attached media (id + a REQUIRED alt-text field + Remove);
 *  - "Add media id": paste an id, press Add or Enter; duplicates and the 4-image limit are refused;
 *  - alt text is never optional (NFR-001): its error shows on that entry's alt field + a counter;
 *  - removing one entry keeps the alt text of the others;
 *  - read-only (`disabled`) hides the adder and disables every field.
 */
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { InjectMediaField, type InjectMediaValue } from './InjectMediaField'

function Harness({
  initial = [],
  disabled,
  errors,
  onValue,
}: {
  initial?: InjectMediaValue[]
  disabled?: boolean
  errors?: Record<string, string>
  onValue?: (media: InjectMediaValue[]) => void
}) {
  const [media, setMedia] = useState<InjectMediaValue[]>(initial)
  return (
    <ThemeProvider theme={cobraTheme}>
      <InjectMediaField
        idPrefix="m"
        media={media}
        disabled={disabled}
        errors={errors}
        onChange={next => {
          setMedia(next)
          onValue?.(next)
        }}
      />
    </ThemeProvider>
  )
}

const add = (id: string): void => {
  fireEvent.change(screen.getByLabelText('Add media id'), { target: { value: id } })
  fireEvent.click(screen.getByRole('button', { name: 'Add media' }))
}

describe('InjectMediaField', () => {
  it('starts empty and states the rule (<= 4 images or 1 video, alt required)', () => {
    render(<Harness />)
    expect(screen.queryAllByTestId('media-entry')).toHaveLength(0)
    expect(screen.getByText(/up to 4 images or 1 video/)).toBeInTheDocument()
    expect(screen.getByText(/Alt text is required/)).toBeInTheDocument()
  })

  it('adds an id with an EMPTY alt that the controller must fill (alt is never defaulted)', () => {
    let latest: InjectMediaValue[] = []
    render(<Harness onValue={m => (latest = m)} />)
    add('media-1')
    expect(screen.getByTestId('media-id')).toHaveTextContent('media-1')
    expect(latest).toEqual([{ mediaId: 'media-1', alt: '' }])
    expect(screen.getByLabelText(/^Alt text for media-1/)).toHaveValue('')
    fireEvent.change(screen.getByLabelText(/^Alt text for media-1/), { target: { value: 'A glass' } })
    expect(latest).toEqual([{ mediaId: 'media-1', alt: 'A glass' }])
  })

  it('Enter in the id box adds it, trims it, and clears the box', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Add media id')
    fireEvent.change(input, { target: { value: '  m-7  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('media-id')).toHaveTextContent('m-7')
    expect(screen.getByLabelText('Add media id')).toHaveValue('')
  })

  it('an empty id cannot be added; a duplicate is refused with a message', () => {
    render(<Harness initial={[{ mediaId: 'm1', alt: 'x' }]} />)
    expect(screen.getByRole('button', { name: 'Add media' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Add media id'), { target: { value: 'm1' } })
    expect(screen.getByText('That media is already attached')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add media' })).toBeDisabled()
  })

  it('stops at 4 and says so', () => {
    render(<Harness initial={['a', 'b', 'c', 'd'].map(id => ({ mediaId: id, alt: id }))} />)
    expect(screen.getByLabelText('Add media id')).toBeDisabled()
    expect(screen.getByText('Limit of 4 reached')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add media' })).toBeDisabled()
  })

  it('removing one entry keeps the alt text of the others', () => {
    let latest: InjectMediaValue[] = []
    render(
      <Harness
        initial={[
          { mediaId: 'm1', alt: 'first alt' },
          { mediaId: 'm2', alt: 'second alt' },
        ]}
        onValue={m => (latest = m)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove media m1' }))
    expect(latest).toEqual([{ mediaId: 'm2', alt: 'second alt' }])
    expect(screen.getByLabelText(/^Alt text for m2/)).toHaveValue('second alt')
  })

  it('shows an alt error on that entry\'s alt field, and a list-level error', () => {
    render(
      <Harness
        initial={[{ mediaId: 'm1', alt: '' }]}
        errors={{ 'media.0.alt': 'Alt text is required', media: 'At most 4 media per post' }}
      />,
    )
    expect(screen.getByTestId('m-alt-0-error')).toHaveTextContent('Alt text is required')
    expect(screen.getByLabelText(/^Alt text for m1/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('m-media-error')).toHaveTextContent('At most 4 media per post')
  })

  it('counts the alt text in code points out of 1000', () => {
    render(<Harness initial={[{ mediaId: 'm1', alt: 'hi 😀' }]} />)
    expect(screen.getByText('4/1000')).toBeInTheDocument()
  })

  it('read-only: no adder, alt and remove are disabled', () => {
    render(<Harness disabled initial={[{ mediaId: 'm1', alt: 'x' }]} />)
    expect(screen.queryByLabelText('Add media id')).toBeNull()
    expect(screen.getByLabelText(/^Alt text for m1/)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove media m1' })).toBeDisabled()
  })
})

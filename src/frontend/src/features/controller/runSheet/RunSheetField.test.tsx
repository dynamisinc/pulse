/**
 * features/controller/runSheet/RunSheetField.test.tsx
 * ---------------------------------------------------------------------------
 * #493 (demo-feedback story 10): run-sheet field labels sat in the outlined border's notch,
 * over the input's white fill, in light `inkMuted` — the outline ran through the text and it
 * was barely readable. The fix lives in `RunSheetField`, so EVERY use is covered:
 *
 *  - the label is a real `<label for>` rendered BEFORE (above) the input's box, never inside
 *    the outlined input and never a floating MUI `InputLabel`;
 *  - the outline has no notch (its `legend` carries no label text);
 *  - the label's computed colour clears 4.5:1 against every dark surface a field sits on
 *    (`panel` — the editor, `card` — a burst post, `bg` — the media picker), at rest, focused
 *    and in error;
 *  - the "New scripted item" form (every `RunSheetField` it renders) has no notched label left.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { SEEDED_PERSONAS } from '@/features/personas'
import { consoleChrome as chrome } from '../consoleChrome'
import { RunSheetField } from './RunSheetField'
import { InjectItemEditor } from './InjectItemEditor'
import { MOCK_ASSIGNEES, MOCK_ME } from './injectMock'

// The editor's media field reads the library hook, which needs providers this test does not
// mount; an empty library is enough here (as in `InjectItemEditor.test.tsx`).
vi.mock('@/core/media', async () => {
  const actual = await vi.importActual<typeof import('@/core/media')>('@/core/media')
  return { ...actual, useMediaLibrary: () => ({ data: [], isPending: false, isError: false }) }
})

// ---- WCAG 2.1 relative luminance / contrast ------------------------------------------------

function parseColor(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (hex) {
    const n = Number.parseInt(hex[1] ?? '0', 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(value.trim())
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  throw new Error(`unparsable colour: ${value}`)
}

function luminance(value: string): number {
  const [r, g, b] = parseColor(value).map(channel => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The lowest contrast of `colour` against the dark console surfaces. */
const worstContrast = (colour: string): number =>
  Math.min(...[chrome.panel, chrome.card, chrome.bg].map(surface => contrast(colour, surface)))

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

function renderField(props: Partial<Parameters<typeof RunSheetField>[0]> = {}) {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <RunSheetField id="f-title" label="Title" value="" onChange={() => {}} {...props} />
    </ThemeProvider>,
  )
}

describe('RunSheetField — #493 label position', () => {
  it('renders a real label above the input box, not inside the outlined input', () => {
    renderField({ required: true })
    const input = screen.getByLabelText(/^Title/)
    const label = document.querySelector('label[for="f-title"]')
    expect(label).not.toBeNull()
    if (!label) return
    // Not a floating MUI label, and not inside the input's box.
    expect(label.classList.contains('MuiInputLabel-root')).toBe(false)
    expect(label.closest('.MuiInputBase-root')).toBeNull()
    expect(document.querySelector('.MuiInputLabel-root')).toBeNull()
    // DOM order: the label comes BEFORE the input's box (it sits above it in the column).
    const box = input.closest('.MuiInputBase-root')
    expect(box).not.toBeNull()
    if (!box) return
    expect(label.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The wrapper stacks label and field vertically.
    const field = screen.getByTestId('f-title-field')
    expect(field.firstElementChild).toBe(label)
    // Required stays on the input; the asterisk is decorative.
    expect(input).toBeRequired()
    expect(label).toHaveTextContent(/^Title\s\*$/)
  })

  it('leaves no notch in the outline (the legend carries no label text)', () => {
    renderField()
    const legend = document.querySelector('fieldset legend')
    // MUI keeps a zero-width space in an un-notched legend; no label text is in it.
    expect((legend?.textContent ?? '').replaceAll(String.fromCharCode(0x200b), '').trim()).toBe('')
  })

  it('labels selects and multiline fields the same way', () => {
    render(
      <ThemeProvider theme={cobraTheme}>
        <RunSheetField id="f-who" label="Assignee" value="" onChange={() => {}} select>
          <option value="">Unassigned</option>
        </RunSheetField>
        <RunSheetField id="f-notes" label="Notes" value="" onChange={() => {}} multiline rows={2} />
      </ThemeProvider>,
    )
    expect(screen.getByLabelText('Assignee').tagName).toBe('SELECT')
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA')
    expect(document.querySelectorAll('.MuiInputLabel-root')).toHaveLength(0)
  })
})

describe('RunSheetField — #493 label contrast (>= 4.5:1 on every dark surface)', () => {
  it('at rest: the computed label colour is readable on panel, card and bg', () => {
    renderField()
    const label = document.querySelector('label[for="f-title"]') as HTMLElement
    const colour = getComputedStyle(label).color
    expect(luminance(colour)).toBeCloseTo(luminance(chrome.inkMuted), 5)
    expect(worstContrast(colour)).toBeGreaterThanOrEqual(4.5)
  })

  it('in error: amber, still readable, and the message is text with an icon', () => {
    renderField({ error: 'Title is required' })
    const label = document.querySelector('label[for="f-title"]') as HTMLElement
    const colour = getComputedStyle(label).color
    expect(luminance(colour)).toBeCloseTo(luminance(chrome.amber), 5)
    expect(worstContrast(colour)).toBeGreaterThanOrEqual(4.5)
    expect(screen.getByTestId('f-title-error')).toHaveTextContent('Title is required')
  })

  it('the focus tint (blue) also clears 4.5:1 on every dark surface', () => {
    // :focus-within is not evaluated by jsdom, so the token itself is checked.
    expect(worstContrast(chrome.blue)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('RunSheetField — #493 in the "New scripted item" form', () => {
  it('every field label sits above its input; no notched label is left', () => {
    render(
      <ThemeProvider theme={cobraTheme}>
        <InjectItemEditor
          mode="create"
          items={[]}
          assignees={MOCK_ASSIGNEES}
          me={MOCK_ME}
          personas={SEEDED_PERSONAS}
          personasUnavailable={false}
          busy={false}
          onSubmit={async () => ({ ok: true })}
          onCancel={() => {}}
        />
      </ThemeProvider>,
    )
    const editor = screen.getByTestId('inject-editor')
    expect(editor.querySelectorAll('.MuiInputLabel-root')).toHaveLength(0)
    // The labels the report names: Title *, T+N (minutes), Assignee, Notes, Persona *, Text *.
    const reported = [/^Title/, /^T\+N \(minutes\)/, /^Assignee/, /^Notes/, /^Persona/, /^Text/]
    for (const name of reported) {
      const control = within(editor).getByLabelText(name)
      const label = editor.querySelector(`label[for="${control.id}"]`)
      expect(label, String(name)).not.toBeNull()
      const box = control.closest('.MuiInputBase-root')
      if (!label || !box) throw new Error(`no label/box for ${String(name)}`)
      expect(label.closest('.MuiInputBase-root')).toBeNull()
      expect(label.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // Typing still works through the label-associated input.
    fireEvent.change(within(editor).getByLabelText(/^Title/), { target: { value: 'Hello' } })
    expect(within(editor).getByLabelText(/^Title/)).toHaveValue('Hello')
  })
})

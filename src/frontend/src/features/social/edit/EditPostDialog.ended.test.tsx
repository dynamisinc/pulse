/**
 * EndEx while the Edit dialog is open: Save goes off and the ended text shows in place; a 403
 * save that races the flip shows the same copy instead of "not yours".
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EXERCISE_ENDED_WRITE_MESSAGE,
  ExerciseEndedProvider,
} from '@/features/participant-shell/writeGate'
import { EditPostDialog } from './EditPostDialog'
import { api } from '@/core/services/api'
import { noteMockPostCreated, resetMockEditsForTests, setMockEditForbidden } from './mockEdits'

function dialog(ended: boolean) {
  return (
    <ExerciseEndedProvider ended={ended}>
      <EditPostDialog
        postId="p1"
        initialText="before"
        onClose={() => {}}
        onSaved={() => {}}
        returnFocusTo={null}
      />
    </ExerciseEndedProvider>
  )
}

const patch = vi.spyOn(api, 'patch')

beforeEach(() => {
  patch.mockClear()
  resetMockEditsForTests()
})

describe('Edit dialog open at EndEx', () => {
  it('disables Save and shows the ended text in place (dialog stays open)', async () => {
    const view = render(dialog(false))
    fireEvent.change(screen.getByLabelText('Post text'), { target: { value: 'after' } })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).not.toHaveAttribute('aria-disabled')

    view.rerender(dialog(true))

    expect(screen.getByTestId('edit-post-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('edit-post-ended')).toHaveTextContent(EXERCISE_ENDED_WRITE_MESSAGE)
    expect(save).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(save)
    expect(patch).not.toHaveBeenCalled()
  })

  it('maps a 403 save that raced the flip to the ended copy', async () => {
    noteMockPostCreated('p1', 'before', '2033-09-04T13:15:00Z')
    setMockEditForbidden(true)
    const view = render(dialog(false))
    fireEvent.change(screen.getByLabelText('Post text'), { target: { value: 'after' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    view.rerender(dialog(true))

    await waitFor(() =>
      expect(screen.getByTestId('edit-post-error')).toHaveTextContent(EXERCISE_ENDED_WRITE_MESSAGE),
    )
  })
})

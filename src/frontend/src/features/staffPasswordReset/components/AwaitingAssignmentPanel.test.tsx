/** AwaitingAssignmentPanel (#575b): copy, status role, heading focus. */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AwaitingAssignmentPanel } from './AwaitingAssignmentPanel'

describe('AwaitingAssignmentPanel', () => {
  it('says the account is ready, explains the wait in text, and focuses the heading', () => {
    render(<AwaitingAssignmentPanel />)
    const heading = screen.getByRole('heading', { name: 'Your account is ready' })
    expect(heading).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent(
      'An administrator will add you to an exercise. You can sign in once you have been assigned.',
    )
  })
})

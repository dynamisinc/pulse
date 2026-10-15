/**
 * features/social/notifications/NotificationRow.repost.test.tsx
 * ---------------------------------------------------------------------------
 * Demo-feedback story 14 (DF-19): the `repost` row renders like the `like` row - its type as a
 * visible "Repost" label (never colour or icon alone, NFR-001), the anonymous sentence, the
 * excerpt of my post, and one link to my post's thread.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NotificationRow } from './NotificationRow'
import type { NotificationItem } from './notificationTypes'

const REPOST_ROW: NotificationItem = {
  id: 'repost:m1',
  type: 'repost',
  subjectPostId: 'm1',
  subjectHandle: 'dreyes_fh',
  at: '2033-09-04T15:00:00.000Z',
  unread: true,
  count: 2,
  actorIds: [],
  actorCount: 0,
  excerpt: 'Shelter at Lincoln High is open.',
}

describe('NotificationRow — repost (DF-19)', () => {
  it('shows the Repost label, the anonymous sentence and my post, linking to its thread', () => {
    render(
      <ul>
        <NotificationRow
          item={REPOST_ROW}
          findById={() => undefined}
          format={() => '5m'}
          onOpenThread={vi.fn()}
        />
      </ul>,
    )

    const row = screen.getByTestId('notification-row')
    expect(row).toHaveAttribute('data-type', 'repost')
    expect(row).toHaveAttribute('data-unread', 'true')
    expect(screen.getByText('Repost')).toBeInTheDocument()
    expect(screen.getByText('Your post got 2 new reposts')).toBeInTheDocument()
    expect(screen.getByText('Shelter at Lincoln High is open.')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', expect.stringContaining('m1'))
  })
})

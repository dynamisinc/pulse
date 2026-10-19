/**
 * Exercise ended (lifecycle `completed`): the social surfaces become a READ-ONLY review.
 *
 * Pins the write-check seam (`useCanWrite`, participant-shell/writeGate): every write affordance
 * (composer, Post, reply, like, repost, pin, edit, follow, media attach) is ABSENT or inert, while
 * feed, threads, profiles, notifications and the personal Following / Pinned tabs stay readable --
 * and the flip happens WITHOUT remounting the channel (scroll position survives EndEx).
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { renderChannel } from './renderChannel.testUtils'

const THREADABLE_POST_ID = 'post-seed-fw-advisory'

beforeEach(() => resetTelemetryBuffer())
afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
})

async function feedReady() {
  await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
}

const WRITE_BUTTONS = [/^Like,/, /^Repost,/, /^Reply,/, /^Pin$/, /^Edit post$/]

function expectNoWrites() {
  expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
  expect(screen.queryByTestId('nav-post-button')).not.toBeInTheDocument()
  for (const name of WRITE_BUTTONS) {
    expect(screen.queryAllByRole('button', { name })).toHaveLength(0)
  }
  expect(screen.queryByTestId('follow-button')).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/attach/i)).not.toBeInTheDocument()
}

describe('exercise ended: writes are off', () => {
  it('a live exercise offers the write controls (baseline for the assertions below)', async () => {
    renderChannel({ entries: ['/home'] })
    await feedReady()
    expect(screen.getByTestId('composer')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Like,/ }).length).toBeGreaterThan(0)
    expect(screen.getByTestId('nav-post-button')).toBeInTheDocument()
  })

  it('home: no composer, Post, like, repost, reply, pin, edit, follow or attach', async () => {
    renderChannel({ entries: ['/home'], ended: true })
    await feedReady()
    expectNoWrites()
  })

  it('home: the feed and the personal Following / Pinned tabs stay readable', async () => {
    renderChannel({ entries: ['/home'], ended: true })
    await feedReady()
    const tabs = screen.getByRole('tablist')
    expect(within(tabs).getByRole('tab', { name: 'All Posts' })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: 'Following' })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: 'Pinned' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Notifications/ })).toBeInTheDocument()
  })

  it('a thread is readable with no reply box and no action row controls', async () => {
    renderChannel({ entries: [`/i/status/${THREADABLE_POST_ID}`], ended: true })
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('reply-composer')).not.toBeInTheDocument()
    expectNoWrites()
  })

  it('a live profile shows the follow button (control for the ended case below)', async () => {
    renderChannel({ entries: ['/fairhavenwater'] })
    expect((await screen.findAllByTestId('follow-button')).length).toBeGreaterThan(0)
  })

  it('a profile is readable with no follow button', async () => {
    renderChannel({ entries: ['/fairhavenwater'], ended: true })
    await waitFor(() => expect(screen.getByTestId('profile-identity')).toBeInTheDocument())
    expect(screen.queryByTestId('follow-button')).not.toBeInTheDocument()
  })

  it('notifications stay reachable', async () => {
    renderChannel({ entries: ['/notifications'], ended: true })
    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument()
  })
})

describe('exercise ended: the flip', () => {
  it('removes the write controls without remounting the channel', async () => {
    const view = renderChannel({ entries: ['/home'] })
    await feedReady()
    const channel = screen.getByTestId('social-channel')
    const firstCard = screen.getAllByTestId('post-card')[0]
    expect(screen.getByTestId('composer')).toBeInTheDocument()

    act(() => view.setShellMount({ ended: true }))

    expect(screen.getByTestId('social-channel')).toBe(channel)
    expect(screen.getAllByTestId('post-card')[0]).toBe(firstCard)
    expectNoWrites()
    expect(screen.getByRole('tab', { name: 'Following' })).toBeInTheDocument()
  })
})

describe('exercise ended: a draft open at EndEx is kept (W-1)', () => {
  const NOT_BODY = () => expect(document.activeElement).not.toBe(document.body)

  it('keeps the inline composer draft readable, with submit and media off and the reason shown', async () => {
    const view = renderChannel({ entries: ['/home'] })
    await feedReady()
    const box = within(screen.getByTestId('composer')).getByLabelText('Post text')
    fireEvent.change(box, { target: { value: 'half-written thought' } })
    box.focus()

    act(() => view.setShellMount({ ended: true }))

    const kept = within(screen.getByTestId('composer')).getByLabelText('Post text')
    expect(kept).toBe(box)
    expect(kept).toHaveValue('half-written thought')
    expect(kept).toHaveAttribute('readonly')
    expect(within(screen.getByTestId('composer')).getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(screen.getByTestId('composer-ended')).toHaveTextContent(
      'This exercise has ended. Nothing new can be posted.',
    )
    NOT_BODY()
  })

  it('an EMPTY inline composer simply goes away', async () => {
    const view = renderChannel({ entries: ['/home'] })
    await feedReady()
    act(() => view.setShellMount({ ended: true }))
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
  })

  it('keeps a reply draft readable in a thread', async () => {
    const view = renderChannel({ entries: [`/i/status/${THREADABLE_POST_ID}`] })
    const box = within(await screen.findByTestId('reply-composer')).getByLabelText('Reply text')
    fireEvent.change(box, { target: { value: 'my reply' } })
    box.focus()

    act(() => view.setShellMount({ ended: true }))

    const kept = within(screen.getByTestId('reply-composer')).getByLabelText('Reply text')
    expect(kept).toBe(box)
    expect(kept).toHaveValue('my reply')
    expect(kept).toHaveAttribute('readonly')
    NOT_BODY()
  })

  it('keeps an open compose modal with a draft, and focus stays in it', async () => {
    const view = renderChannel({ entries: ['/home'] })
    await feedReady()
    fireEvent.click(screen.getByTestId('nav-post-button'))
    const dialog = await screen.findByRole('dialog')
    const box = within(dialog).getByLabelText('Post text')
    fireEvent.change(box, { target: { value: 'my draft' } })

    act(() => view.setShellMount({ ended: true }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByLabelText('Post text')).toHaveValue('my draft')
    expect(screen.getByTestId('composer-ended')).toBeInTheDocument()
    expect(screen.queryByTestId('nav-post-button')).not.toBeInTheDocument()
    NOT_BODY()
  })

  it('closes an open EMPTY compose modal and never leaves focus on <body>', async () => {
    const view = renderChannel({ entries: ['/home'] })
    await feedReady()
    fireEvent.click(screen.getByTestId('nav-post-button'))
    await screen.findByRole('dialog')

    act(() => view.setShellMount({ ended: true }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    NOT_BODY()
    expect(screen.getByTestId('social-main')).toHaveFocus()
  })
})

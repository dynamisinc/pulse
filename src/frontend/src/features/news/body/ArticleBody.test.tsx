/**
 * news-network 06: "Body renders safely", "Typography by skin", "Pull quote" and
 * "Inline media" (NWS-010, NFR-001, NFR-004, NFR-008), in all four outlet skins.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerSkinExtension, resetSkinRegistryForTests } from '@/features/channels/skin/registry'
import type { ContentMediaDto, OutletSkinTokens } from '@/features/channels'
import { ArticleBody } from './ArticleBody'
import { seriousAxeViolations } from '@/features/channels/primitives/primitivesTestUtils'
import { skinWantsDropCap } from './bodyModel'
import { OUTLET_SKINS, buildPost, media, renderInSkin, stubThreadRead } from './bodyTestUtils'

declare global {
  interface Window {
    __pwned?: number
  }
}

const PWN = 'window.__pwned=(window.__pwned||0)+1'

/** The AC's payload families: script, handler, javascript: URL, iframe, inline style. */
const PAYLOADS: readonly string[] = [
  `<script>${PWN}</script>`,
  `<p>x<script src="data:text/javascript,${PWN}"></script></p>`,
  `<img src=x onerror="${PWN}">`,
  `<p onclick="${PWN}" onmouseover="${PWN}">hover</p>`,
  `<a href="javascript:${PWN}">click</a>`,
  `<a href="  JaVaScRiPt:${PWN}">spaced</a>`,
  `<a href="java&#x09;script:${PWN}">encoded</a>`,
  `<iframe src="javascript:${PWN}"></iframe>`,
  `<iframe srcdoc="<script>${PWN}</script>"></iframe>`,
  `<p style="background:url(javascript:${PWN})">styled</p>`,
  `<blockquote class="pull-quote" style="position:fixed;inset:0" onclick="${PWN}">q</blockquote>`,
  `<figure data-media-id="m1" onerror="${PWN}"><figcaption onclick="${PWN}">c</figcaption></figure>`,
  `<pulse-post data-id="p-1" onclick="${PWN}"><script>${PWN}</script></pulse-post>`,
  `<svg><script>${PWN}</script></svg>`,
  `<math><mtext><table><mglyph><style><img src=x onerror="${PWN}">`,
  `<form action="javascript:${PWN}"><button>go</button></form>`,
]

const ITEM_MEDIA: readonly ContentMediaDto[] = [
  media('m1'),
  media('v1', {
    kind: 'video',
    url: 'https://media.example.test/v1.mp4',
    contentType: 'video/mp4',
    posterUrl: 'https://media.example.test/v1.jpg',
    durationSec: 42,
  }),
  media('doc1', { kind: 'document', url: 'https://media.example.test/a.pdf', contentType: 'application/pdf' }),
]

afterEach(() => {
  resetSkinRegistryForTests()
  vi.restoreAllMocks()
  delete window.__pwned
})

function renderBody(
  bodyHtml: string,
  tokens: OutletSkinTokens,
  key: string,
  extra: { watermarkMedia?: boolean } = {},
) {
  return renderInSkin(
    <ArticleBody item={{ bodyHtml, media: ITEM_MEDIA }} {...extra} />,
    tokens,
    key,
  )
}

describe.each(OUTLET_SKINS)('ArticleBody in %s', (key, tokens) => {
  it('never executes or injects any payload (NFR-004)', async () => {
    stubThreadRead({ 'p-1': buildPost('p-1') })
    const { container } = renderBody(PAYLOADS.join('\n'), tokens, key)
    const body = await screen.findByTestId('news-article-body')
    await screen.findByTestId('post-card')
    // jsdom loads no image and fires no `onerror`, so `__pwned` alone would pass against a
    // broken sanitizer; the DOM assertions below are the real check.
    expect(window.__pwned).toBeUndefined()
    expect(body.querySelector('script, iframe, form, math, style, img[src="x"]')).toBeNull()
    // An author svg never survives (the embed's own FontAwesome / seal icons are Social's).
    for (const svg of body.querySelectorAll('svg')) {
      expect(svg.closest('[data-testid="news-embedded-post"]')).not.toBeNull()
    }
    for (const element of body.querySelectorAll('*')) {
      for (const attr of element.getAttributeNames()) {
        expect(attr.startsWith('on')).toBe(false)
      }
      expect(element.getAttribute('href') ?? '').not.toMatch(/javascript:/i)
    }
    // No author `style` survived into the sanitized HTML. The only inline styles are React's
    // own, inside the portal hosts (the embed's scope wrappers, the media box's ratio).
    const authored = within(body).getByTestId('sanitized-body')
    for (const element of authored.querySelectorAll('[style]')) {
      expect(element.closest('pulse-post, [data-media-host]')).not.toBeNull()
    }
    expect(container.innerHTML).not.toContain(PWN)
  })

  it('renders a pull quote as a semantic blockquote with its cite, read once, inside the column', async () => {
    renderBody(
      '<p>Lead.</p><blockquote class="pull-quote"><p>"We are not out of the woods."</p><cite>Mayor Ruiz</cite></blockquote>',
      tokens,
      key,
    )
    const body = await screen.findByTestId('news-article-body')
    const quote = body.querySelector('blockquote.pull-quote')
    expect(quote).not.toBeNull()
    expect(quote?.querySelector('cite')).toHaveTextContent('Mayor Ruiz')
    // One copy only, and nothing hidden from assistive tech.
    expect(within(body).getAllByText(/not out of the woods/)).toHaveLength(1)
    expect(body.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('resolves inline media against item.media, with the skin\'s caption style', async () => {
    renderBody(
      '<figure data-media-id="m1"><figcaption>Crews flush mains on Elm St.</figcaption></figure>'
      + '<figure data-media-id="missing"><figcaption>orphan caption</figcaption></figure>'
      + '<figure data-media-id="doc1"></figure>',
      tokens,
      key,
    )
    const figures = await screen.findAllByTestId('news-inline-figure')
    expect(figures).toHaveLength(1)
    const figure = figures[0] as HTMLElement
    expect(figure).toHaveAttribute('data-caption-style', tokens.media.captionStyle)
    expect(within(figure).getByRole('img', { name: 'Alt for m1' })).toBeInTheDocument()
    expect(within(figure).getByTestId('exercise-bands')).toBeInTheDocument()
    expect(figure.querySelector('figcaption')).toHaveTextContent('Crews flush mains on Elm St.')
    // An id not in item.media (and a document) renders nothing: no broken image, no caption.
    expect(screen.queryByText('orphan caption')).toBeNull()
    expect(screen.getByTestId('news-article-body').querySelectorAll('img')).toHaveLength(1)
  })
})

describe('ArticleBody inline media', () => {
  const [key, tokens] = OUTLET_SKINS[0] ?? ['', undefined]
  if (tokens === undefined) throw new Error('fixture')

  it('falls back to the media caption when the author wrote none', async () => {
    renderBody('<figure data-media-id="m1"></figure>', tokens, key)
    const figure = await screen.findByTestId('news-inline-figure')
    expect(figure.querySelector('figcaption')).toHaveTextContent('Caption for m1')
  })

  it('an inline video uses the shared player, with the watermark chip on a high-risk article', async () => {
    renderBody('<figure data-media-id="v1"></figure>', tokens, key, { watermarkMedia: true })
    const figure = await screen.findByTestId('news-inline-figure')
    expect(within(figure).getByTestId('video-player')).toBeInTheDocument()
    expect(within(figure).getByTestId('watermark-slot')).toBeInTheDocument()
  })

  it('no watermark chip unless the article asks for one', async () => {
    renderBody('<figure data-media-id="m1"></figure>', tokens, key)
    const figure = await screen.findByTestId('news-inline-figure')
    expect(within(figure).queryByTestId('watermark-slot')).toBeNull()
  })
})

describe('ArticleBody typography by skin', () => {
  const [key, tokens] = OUTLET_SKINS[1] ?? ['', undefined]
  if (tokens === undefined) throw new Error('fixture')

  it('draws a drop cap only when the skin asks for one (ext.news.dropCap)', async () => {
    registerSkinExtension('news', { keys: { dropCap: { type: 'boolean' } } })
    const withCap: OutletSkinTokens = { ...tokens, ext: { news: { dropCap: true } } }
    const first = renderBody('<p>Lead.</p>', withCap, key)
    await waitFor(() => expect(screen.getByTestId('news-article-body')).toHaveAttribute('data-drop-cap'))
    first.unmount()
    renderBody('<p>Lead.</p>', tokens, key)
    expect(await screen.findByTestId('news-article-body')).not.toHaveAttribute('data-drop-cap')
  })

  it('skinWantsDropCap reads only a boolean true', () => {
    expect(skinWantsDropCap(undefined)).toBe(false)
    expect(skinWantsDropCap({ news: { dropCap: 'yes' } })).toBe(false)
    expect(skinWantsDropCap({ news: { dropCap: true } })).toBe(true)
  })
})

describe.each(OUTLET_SKINS)('ArticleBody accessibility in %s (NFR-001)', (key, tokens) => {
  it('a full body (headings, links, pull quote, media, embed) has no serious axe violation', async () => {
    stubThreadRead({ 'p-1': buildPost('p-1') })
    const { container } = renderBody(
      '<p>Lead with <a href="/news/metro-desk-9/earlier">an earlier story</a>.</p>'
      + '<h2>What residents should do</h2><ul><li>Boil water</li></ul>'
      + '<blockquote class="pull-quote"><p>"Stay calm."</p><cite>Mayor Ruiz</cite></blockquote>'
      + '<figure data-media-id="m1"></figure><pulse-post data-id="p-1"></pulse-post>',
      tokens,
      key,
    )
    await screen.findByTestId('post-card')
    await screen.findByTestId('news-inline-figure')
    expect(await seriousAxeViolations(container)).toEqual([])
  })
})

/**
 * features/social/hooks/useComposePost.ts
 * ---------------------------------------------------------------------------
 * The compose-post state machine behind the inline `<Composer>` (feature:
 * posts, story 01 — "Post composition"; SOC-001, D1-R5). Participant world
 * (Pulse Social skin) — pure hook + pure helpers, no UI, no COBRA.
 *
 * WHAT THIS OWNS
 *  - Draft state: `text` and validated `media` (0–4 images).
 *  - Derived counter state for the D1-R5 depleting ring: `length`,
 *    `remaining`, `showCount` (count text appears at ≤20 remaining),
 *    `isLow` (amber near the limit), `isOverLimit` (publish blocked).
 *  - Parsed `#hashtags` / `@mentions` for the model/telemetry (SOC-001). S2
 *    does NOT navigate/link them — it only parses + exposes them.
 *  - `publish()`, the single sanctioned publish path: it assembles a
 *    `CreatePostInput` and, behind the ONE `USE_MOCK_DATA` flip point
 *    (`@/core/config/mockData`, WAVE0-REVIEW precedent 15):
 *      - MOCK: calls `createPost` from `@/features/social` — the ONE place
 *        sanitization (NFR-004) and the `'post'` telemetry event (XC-004)
 *        happen — then fires `onPosted` with the created `Post` so the host
 *        can refresh its (in-tab) feed.
 *      - LIVE (UAT fix): fires `livePostActions.publishPost` — a fire-and-
 *        forget `POST /api/posts` (`.catch(() => {})`) — and does NOT call
 *        `createPost` or `onPosted`. The published post reaches every
 *        participant, INCLUDING the author, via the backend's `PostReceived`
 *        SignalR broadcast and the "▲ N new posts" pill (`useFeedStream`,
 *        feeds-discovery/04) once `useFeed`'s baseline resolve/the pill tap
 *        picks it up — never a client-side optimistic insert here (which the
 *        feed's persona-cast resolution would drop anyway, and which would
 *        double the XC-004 telemetry the backend now emits authoritatively).
 *    Either way the draft (`text`/`media`/`mediaError`) is cleared on publish.
 *
 * TWO-WORLDS / ISOLATION
 *  - `exerciseId`/`timeZone` come from `useExerciseContext()` and are used ONLY
 *    to STAMP the created post + its telemetry envelope — never as a fetch
 *    scoping param (COR-001/XC-002). `livePostActions.publishPost` drops
 *    `exerciseId` from the wire body entirely (COR-001) — the server stamps
 *    scope from the session.
 *  - `authorPersonaId`/`actingHumanId` come from `useSession()` (COR-018). If
 *    the session has no bound persona (`personaId` undefined) there is no
 *    identity to post as, so `canPost` is false and `publish()` is a no-op.
 *  - Observer/read-only (COR-015/D1-011): `isReadOnly` is surfaced so the
 *    `<Composer>` renders NOTHING at all (absent, not disabled). `publish()`
 *    additionally hard-guards on it (belt-and-braces).
 *
 * SCENARIO TIME (COR-053): `scenarioTime` is `scenarioNow().toISOString()` from
 * `@/core/clock` — never wall-clock (`new Date()`/`Date.now()` are lint-banned
 * on this path). `createPost` stamps the telemetry `wallClockTime` itself
 * (mock mode); the backend stamps its own wall-clock in live mode.
 *
 * MEDIA (story AC — minimal validated stub): Phase-1 `PostMedia` is image-only
 * (`{kind:'image',alt}`), so the attach affordance validates + accepts 0–4
 * images (count/MIME/size). Inline VIDEO (the 1-video "Utube replacement"
 * path in SOC-001) is recognized by the validator and DOCUMENTED as a
 * follow-up — it needs a `PostMedia` video kind (rich-media composer state,
 * D1 backlog) that this story deliberately does not add. No real upload /
 * storage is built (no backend); a selected image becomes a `PostMedia`
 * placeholder with its filename as interim `alt`.
 */

import { useCallback, useMemo, useState } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import { scenarioNow } from '@/core/clock'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { createPost, type CreatePostInput, type Post, type PostMedia } from '@/features/social'
import { publishPost } from '../services/livePostActions'
import { sanitizeText } from '../services/sanitize'

/** Default per-exercise character limit (SOC-001); overridable via a prop. */
export const DEFAULT_CHAR_LIMIT = 280

/** Remaining-character threshold at/under which the count text becomes visible
 * and the ring enters its amber "low" state (D1-R5). */
export const COUNT_VISIBLE_THRESHOLD = 20

/** Max images per post (SOC-001: "0–4 images OR 1 video"). */
export const MAX_IMAGES = 4

/** Max accepted image size, in bytes (5 MB) — validated before attach (NFR-004). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Accepted image MIME types (NFR-004 MIME validation). */
export const ACCEPTED_IMAGE_MIME: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]

/**
 * Parses distinct `#hashtags` from free text (deduped, order-preserved, the
 * leading `#` stripped). ASCII word chars only — S2 captures them for the
 * model/telemetry; it does not navigate/link them (SOC-001).
 */
export function parseHashtags(text: string): string[] {
  return dedupe(matchAll(text, /#(\w+)/g))
}

/**
 * Parses distinct `@mentions` from free text (deduped, order-preserved, the
 * leading `@` stripped). Same S2 caveat as {@link parseHashtags}.
 */
export function parseMentions(text: string): string[] {
  return dedupe(matchAll(text, /@(\w+)/g))
}

function matchAll(text: string, re: RegExp): string[] {
  const out: string[] = []
  for (const match of text.matchAll(re)) {
    if (match[1]) out.push(match[1])
  }
  return out
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

/** Outcome of validating a batch of picked files against the media rules. */
export interface ImageValidationResult {
  /** The accepted attachments (empty when any file failed validation). */
  readonly media: PostMedia[]
  /** A human-readable, in-fiction-safe reason the batch was rejected. */
  readonly error?: string
}

/**
 * Validates a batch of picked files for the image-attach affordance (NFR-004:
 * count/MIME/size). Rejects the WHOLE batch on the first failure so a partial,
 * surprising attach never happens. A video file is recognized and rejected
 * with a message pointing at the documented inline-video follow-up (Phase-1
 * `PostMedia` cannot represent a video yet).
 *
 * @param files         the newly-picked files
 * @param existingCount how many images are already attached (for the ≤4 cap)
 */
export function validateImageFiles(files: File[], existingCount: number): ImageValidationResult {
  const accepted: PostMedia[] = []
  for (const file of files) {
    if (file.type.startsWith('video/')) {
      return { media: [], error: 'Inline video is coming soon — attach up to 4 images for now.' }
    }
    if (!ACCEPTED_IMAGE_MIME.includes(file.type)) {
      return { media: [], error: `That file type isn't supported: ${file.name}` }
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { media: [], error: `${file.name} is too large (max 5 MB).` }
    }
    // Interim alt = filename, sanitized — NFR-004 keeps ALL free text on the
    // publish path cleaned (defense-in-depth; alt already renders inert) until
    // a real alt-authoring affordance lands.
    accepted.push({ kind: 'image', alt: sanitizeText(file.name) })
  }
  if (existingCount + accepted.length > MAX_IMAGES) {
    return { media: [], error: `You can attach up to ${MAX_IMAGES} images.` }
  }
  return { media: accepted }
}

/** Options for {@link useComposePost}. */
export interface UseComposePostOptions {
  /** Per-exercise character limit; defaults to {@link DEFAULT_CHAR_LIMIT}. */
  readonly charLimit?: number
  /** Called with the created `Post` after a successful publish, so the host
   * can refresh the feed. The composer never touches the feed itself. */
  readonly onPosted?: (post: Post) => void
}

/** The full compose surface the `<Composer>` binds to. */
export interface UseComposePostResult {
  readonly text: string
  readonly setText: (value: string) => void
  readonly media: readonly PostMedia[]
  /** Validates + appends picked image files; sets `mediaError` on rejection. */
  readonly attachImages: (files: File[]) => void
  readonly removeMedia: (index: number) => void
  readonly mediaError: string | undefined
  readonly hashtags: readonly string[]
  readonly mentions: readonly string[]
  readonly charLimit: number
  /** Code-point length of the current text (emoji-aware). */
  readonly length: number
  /** `charLimit - length` — negative when over the limit. */
  readonly remaining: number
  /** True once `remaining` ≤ {@link COUNT_VISIBLE_THRESHOLD} (count text shows). */
  readonly showCount: boolean
  /** Amber "near the limit" state (not yet over). */
  readonly isLow: boolean
  /** Text is longer than the limit — publish is blocked. */
  readonly isOverLimit: boolean
  /** The session has a persona to post as (else publish is unavailable). */
  readonly canPost: boolean
  /** Whether the composer must not render at all (observer mode, COR-015). */
  readonly isReadOnly: boolean
  /** All conditions met to publish (non-empty content, within limit, canPost). */
  readonly canPublish: boolean
  /** Sanitizes + publishes via `createPost`, then clears the draft + fires
   * `onPosted`. A no-op unless `canPublish`. */
  readonly publish: () => void
}

/**
 * The inline composer's state + publish machine. See the module header for the
 * full contract; the `<Composer>` component is its only intended consumer.
 */
export function useComposePost(options: UseComposePostOptions = {}): UseComposePostResult {
  const { charLimit = DEFAULT_CHAR_LIMIT, onPosted } = options
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()

  const [text, setText] = useState('')
  const [media, setMedia] = useState<PostMedia[]>([])
  const [mediaError, setMediaError] = useState<string | undefined>(undefined)

  const hashtags = useMemo(() => parseHashtags(text), [text])
  const mentions = useMemo(() => parseMentions(text), [text])

  // Code-point length so a multi-byte emoji counts as one character (X-style).
  const length = useMemo(() => [...text].length, [text])
  const remaining = charLimit - length
  const isOverLimit = remaining < 0
  const showCount = remaining <= COUNT_VISIBLE_THRESHOLD
  const isLow = showCount && !isOverLimit

  const isReadOnly = session.isReadOnly
  const canPost = session.personaId !== undefined
  const hasContent = text.trim().length > 0 || media.length > 0
  const canPublish = hasContent && !isOverLimit && canPost && !isReadOnly

  const attachImages = useCallback((files: File[]) => {
    const result = validateImageFiles(files, media.length)
    if (result.error !== undefined) {
      setMediaError(result.error)
      return
    }
    setMediaError(undefined)
    setMedia(prev => [...prev, ...result.media])
  }, [media.length])

  const removeMedia = useCallback((index: number) => {
    setMedia(prev => prev.filter((_, i) => i !== index))
    setMediaError(undefined)
  }, [])

  const publish = useCallback(() => {
    // Re-derive the guard locally rather than trusting a stale `canPublish`
    // closure, and narrow `personaId` to a string (no non-null assertion).
    const personaId = session.personaId
    if (session.isReadOnly || personaId === undefined) return
    if (text.trim().length === 0 && media.length === 0) return
    if ([...text].length > charLimit) return

    const input: CreatePostInput = {
      exerciseId,
      timeZone,
      scenarioTime: scenarioNow().toISOString(),
      authorPersonaId: personaId,
      actingHumanId: session.actingHumanId,
      text,
      ...(media.length > 0 ? { media: [...media] } : {}),
      origin: 'participant',
    }

    if (USE_MOCK_DATA) {
      const post = createPost(input)
      onPosted?.(post)
    } else {
      // LIVE (UAT fix): POST-only, fire-and-forget. NEVER call `createPost`
      // here (would double the XC-004 telemetry the backend now emits
      // authoritatively) and NEVER call `onPosted` (there is no locally-
      // created `Post` to hand back, and an optimistic insert would be
      // dropped by the feed's persona-cast resolution anyway) — the
      // SignalR "new posts" pill (`useFeedStream`) is what surfaces this
      // post, to every participant including the author, once the request
      // lands (see the module header).
      publishPost(input).catch(() => {})
    }

    setText('')
    setMedia([])
    setMediaError(undefined)
  }, [
    exerciseId,
    timeZone,
    session.personaId,
    session.actingHumanId,
    session.isReadOnly,
    text,
    media,
    charLimit,
    onPosted,
  ])

  return {
    text,
    setText,
    media,
    attachImages,
    removeMedia,
    mediaError,
    hashtags,
    mentions,
    charLimit,
    length,
    remaining,
    showCount,
    isLow,
    isOverLimit,
    canPost,
    isReadOnly,
    canPublish,
    publish,
  }
}

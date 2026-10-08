/**
 * features/social/hooks/useComposePost.ts
 * ---------------------------------------------------------------------------
 * The compose-post state machine behind the inline `<Composer>` AND the thread's
 * `<ReplyComposer>` (feature: posts, story 01 "Post composition"; SOC-001,
 * D1-R5 — and demo-polish F4, story 13 "Threads and composer"). Participant world
 * (Pulse Social skin) — pure hook + pure helpers, no UI, no COBRA.
 *
 * WHAT THIS OWNS
 *  - Draft state: `text` and the ATTACH TRAY (`attachments`: up to 4 images OR 1
 *    video, each uploading / ready / failed, each with its own alt text).
 *  - Derived counter state for the D1-R5 depleting ring: `length`, `remaining`,
 *    `showCount` (count text appears at ≤20 remaining), `isLow` (amber near the
 *    limit), `isOverLimit` (publish blocked).
 *  - Parsed `#hashtags` / `@mentions` for the model/telemetry (SOC-001).
 *  - `publish()`, the single sanctioned publish path (below).
 *
 * THE ATTACH TRAY (demo-polish F4). Picking files validates the whole batch up
 * front (`validateMediaFile`'s size/MIME messages, which carry the "MP4 (H.264)"
 * hint, plus the count rules below) and rejects the BATCH on the first failure, so
 * a partial, surprising attach never happens. Accepted files upload IMMEDIATELY and
 * in parallel through `@/core/media`'s `uploadPickedMedia` (image: size read +
 * upload; video: poster first, then the video) — each with its own
 * `AbortController`, progress fraction and cancel. (`useMediaUpload` is the
 * single-slot React wrapper over that same function; it aborts the first upload
 * when a second starts, so a four-image tray cannot be built on it — the tray owns
 * one controller per item instead.) The rules:
 *   - at most 4 images OR exactly 1 video, never mixed (clear in-fiction messages);
 *   - every item needs a NON-EMPTY alt text (NFR-001) — measured AFTER
 *     sanitization, so an alt of only markup counts as empty;
 *   - Post stays disabled while any item is uploading, failed, or missing its alt;
 *     a failed item must be removed (a photo is never silently dropped from a post).
 * A media-only post (no text) is allowed once everything is ready.
 *
 * `publish()`, behind the ONE `USE_MOCK_DATA` flip point (`@/core/config/mockData`):
 *   - MOCK: `createPost` — the one place the mock sanitizes and emits the `'post'`
 *     (or, with `parentPostId`, `'reply'`) telemetry event — then appends the post
 *     to `postStore` (the mock backend: it links a reply to its parent and bumps
 *     the parent's reply count, so the thread shows it) and registers a top-level
 *     post as the viewer's own.
 *   - LIVE: AWAITS `livePostActions.publishPost` (`POST /api/posts`); on success the
 *     201 body is narrowed to a participant-safe view (`narrowCreatedPost` — the
 *     union also admits the staff provenance shape) and registered as the viewer's
 *     own. No frontend telemetry: the server emits `post`/`reply` (§1.8).
 *   Either way, on success `onPosted(view)` fires with the participant-safe view
 *   (also in LIVE mode — it used to be mock-only) and the draft clears.
 *
 * A FAILED PUBLISH KEEPS THE DRAFT. `publishPost` rejections are no longer
 * swallowed: the text and the tray stay exactly as they were, `publishError` carries
 * an in-fiction message, and calling `publish()` again is the Retry. A 2xx body the
 * client could not parse (a plain `Error`, not an axios failure) is worded
 * differently — the post may already exist — so the author checks before retrying.
 * While a publish is in flight the form locks (`isPublishing`), so nothing typed
 * after pressing Post can be cleared by the success.
 *
 * CONTENT SECURITY (NFR-004). The body and every alt go through `sanitizeText`
 * before they leave the hook (the server sanitizes again — it is the authoritative
 * boundary; this is defence in depth and keeps `canPublish` honest about what would
 * actually be sent). Files are validated before upload.
 *
 * TWO-WORLDS / ISOLATION
 *  - `exerciseId`/`timeZone` come from `useExerciseContext()` and are used ONLY to
 *    STAMP the created post + its telemetry envelope — never as a fetch scoping
 *    param (COR-001/XC-002). `livePostActions.publishPost` and `core/media` drop /
 *    never send `exerciseId` — the server stamps scope from the session.
 *  - `authorPersonaId`/`actingHumanId` come from `useSession()` (COR-018). If the
 *    session has no bound persona there is no identity to post as, so `canPost` is
 *    false and `publish()` is a no-op.
 *  - Observer/read-only (COR-015/D1-011): `isReadOnly` is surfaced so the composers
 *    render NOTHING at all (absent, not disabled). `publish()` hard-guards on it too.
 *
 * SCENARIO TIME (COR-053): `scenarioTime` is `scenarioNow().toISOString()` from
 * `@/core/clock` — never wall-clock (`new Date()`/`Date.now()` are lint-banned on
 * this path).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import { scenarioNow } from '@/core/clock'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import {
  MEDIA_ERROR_TEXT,
  MediaUploadError,
  isAbortError,
  uploadPickedMedia,
  validateMediaFile,
} from '@/core/media'
import type { MediaAssetView, MediaKind } from '@/core/media'
import {
  createPost,
  toParticipantView,
  type CreatePostInput,
  type CreatePostMedia,
  type ParticipantPostView,
} from '@/features/social'
import { publishPost } from '../services/livePostActions'
import { postStore } from '../services/postStore'
import { narrowCreatedPost, ownPostStore } from '../services/ownPostStore'
import { sanitizeText } from '../services/sanitize'

/** Default per-exercise character limit (SOC-001); overridable via a prop. */
export const DEFAULT_CHAR_LIMIT = 280

/** Remaining-character threshold at/under which the count text becomes visible
 * and the ring enters its amber "low" state (D1-R5). */
export const COUNT_VISIBLE_THRESHOLD = 20

/** Max images per post (SOC-001: "0–4 images OR 1 video"). */
export const MAX_IMAGES = 4

/** Max videos per post. */
export const MAX_VIDEOS = 1

/** Longest accepted alt text (the server accepts 1..1000 after sanitization). */
export const ALT_MAX_LENGTH = 1000

/** In-fiction wording for the tray's count rules (never engineering vocabulary). */
export const MEDIA_MIXED_MESSAGE = 'Attach up to 4 photos or 1 video, not both.'
export const MEDIA_TOO_MANY_IMAGES_MESSAGE = `You can attach up to ${MAX_IMAGES} photos.`
export const MEDIA_TOO_MANY_VIDEOS_MESSAGE = 'You can attach only 1 video.'

/** Shown with Retry when the request itself failed (network down, refused, 5xx). */
export function publishFailedMessage(isReply: boolean): string {
  return `Your ${isReply ? 'reply' : 'post'} couldn't be sent. Check your connection and try again.`
}

/** Shown with Retry when the server answered 2xx but the body could not be read. */
export function publishUnconfirmedMessage(isReply: boolean): string {
  return `We couldn't confirm your ${isReply ? 'reply' : 'post'} went out. ` +
    'Check the feed before you try again.'
}

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

// -----------------------------------------------------------------------------
// The attach tray
// -----------------------------------------------------------------------------

/** Where one tray item is in its life. */
export type AttachmentStatus = 'uploading' | 'ready' | 'failed'

/** One picked file in the attach tray. */
export interface ComposerAttachment {
  /** Local, tray-unique key (stable across renders; NOT the server's asset id). */
  readonly key: string
  readonly file: File
  readonly kind: MediaKind
  readonly status: AttachmentStatus
  /** Upload progress as a fraction in [0, 1] (1 once `ready`). */
  readonly progress: number
  /** The author-entered description (required before the post can go out). */
  readonly alt: string
  /** In-fiction failure text, set only when `status === 'failed'`. */
  readonly error?: string
  /** The uploaded asset, set once `status === 'ready'`. */
  readonly asset?: MediaAssetView
}

/** Outcome of validating a picked batch against the media rules. */
export type AttachBatchResult =
  | { readonly ok: true; readonly kinds: readonly MediaKind[] }
  | { readonly ok: false; readonly error: string }

/**
 * Validates a batch of newly picked files against the media rules (NFR-004), given
 * the kinds already in the tray. Rejects the WHOLE batch on the first failure:
 * a file that fails `validateMediaFile` (type / size / empty — the message names
 * the file), then the count rules (mixed image + video; more than 1 video; more
 * than 4 images).
 *
 * @param files         the newly picked files
 * @param existingKinds the kinds of the items already in the tray
 */
export function validateAttachBatch(
  files: readonly File[],
  existingKinds: readonly MediaKind[],
): AttachBatchResult {
  const kinds: MediaKind[] = []
  for (const file of files) {
    const check = validateMediaFile(file)
    if (!check.ok) return { ok: false, error: `${file.name}: ${check.error}` }
    kinds.push(check.kind)
  }

  const all = [...existingKinds, ...kinds]
  const images = all.filter(kind => kind === 'image').length
  const videos = all.length - images
  if (images > 0 && videos > 0) return { ok: false, error: MEDIA_MIXED_MESSAGE }
  if (videos > MAX_VIDEOS) return { ok: false, error: MEDIA_TOO_MANY_VIDEOS_MESSAGE }
  if (images > MAX_IMAGES) return { ok: false, error: MEDIA_TOO_MANY_IMAGES_MESSAGE }
  return { ok: true, kinds }
}

/** The alt text that would actually be sent: sanitized, trimmed, bounded. */
export function effectiveAlt(alt: string): string {
  return sanitizeText(alt).trim().slice(0, ALT_MAX_LENGTH)
}

/**
 * Builds the request's `media[]` from the tray, or `undefined` when the tray is
 * not ready to send (an item is still uploading, failed, or has no usable alt).
 * An empty tray yields `[]`.
 */
export function toCreatePostMedia(
  items: readonly ComposerAttachment[],
): CreatePostMedia[] | undefined {
  const media: CreatePostMedia[] = []
  for (const item of items) {
    const alt = effectiveAlt(item.alt)
    if (item.status !== 'ready' || item.asset === undefined || alt.length === 0) return undefined
    media.push({ mediaId: item.asset.id, alt })
  }
  return media
}

/** The user-facing text for a failed upload (never a raw error message). */
function uploadFailureMessage(error: unknown): string {
  return error instanceof MediaUploadError ? error.message : MEDIA_ERROR_TEXT.failed
}

// -----------------------------------------------------------------------------
// The hook
// -----------------------------------------------------------------------------

/** Options for {@link useComposePost}. */
export interface UseComposePostOptions {
  /** Per-exercise character limit; defaults to {@link DEFAULT_CHAR_LIMIT}. */
  readonly charLimit?: number
  /**
   * Makes every post this composer publishes a REPLY to this post (an opaque id).
   * Omitted for the top-level composer.
   */
  readonly parentPostId?: string
  /**
   * Called with the participant-safe view of the created post after a successful
   * publish — in live mode too. The composer never touches the feed itself; the
   * host reacts (a modal closes, a thread appends the reply).
   */
  readonly onPosted?: (view: ParticipantPostView) => void
}

/** The full compose surface the composers bind to. */
export interface UseComposePostResult {
  readonly text: string
  readonly setText: (value: string) => void
  /** The attach tray, in pick order. */
  readonly attachments: readonly ComposerAttachment[]
  /** Validates the batch, then adds + uploads the files. Sets `mediaError` on rejection. */
  readonly attachFiles: (files: readonly File[]) => void
  /** Aborts an in-flight upload and drops its item. */
  readonly cancelAttachment: (key: string) => void
  /** Drops an item (aborting its upload if it is still running). */
  readonly removeAttachment: (key: string) => void
  /** Sets one item's description. */
  readonly setAttachmentAlt: (key: string, alt: string) => void
  /** The reason the last pick was refused, or `undefined`. */
  readonly mediaError: string | undefined
  /** True while any tray item is still uploading. */
  readonly isUploading: boolean
  /** True while a publish request is in flight (the form is locked). */
  readonly isPublishing: boolean
  /** In-fiction reason the last publish failed, or `undefined`. `publish()` again = Retry. */
  readonly publishError: string | undefined
  /** True from a successful publish until the next edit (drives the SR "posted" notice). */
  readonly posted: boolean
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
  /** All conditions met to publish (content, ready tray with alts, within limit, canPost). */
  readonly canPublish: boolean
  /** Why Post is disabled for a MEDIA reason the author can fix, or `undefined`. */
  readonly mediaBlockReason: string | undefined
  /** Publishes the draft. A no-op unless `canPublish`. Calling it again after a failure = Retry. */
  readonly publish: () => void
}

/** Monotonic local key source for tray items. */
let attachmentSeq = 0

/**
 * The composer's state + publish machine. See the module header for the full
 * contract; `<Composer>` and `<ReplyComposer>` are its intended consumers.
 */
export function useComposePost(options: UseComposePostOptions = {}): UseComposePostResult {
  const { charLimit = DEFAULT_CHAR_LIMIT, parentPostId, onPosted } = options
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()

  const [text, setTextState] = useState('')
  const [items, setItems] = useState<readonly ComposerAttachment[]>([])
  const [mediaError, setMediaError] = useState<string | undefined>(undefined)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | undefined>(undefined)
  const [posted, setPosted] = useState(false)

  // The tray is mirrored in a ref so a batch pick and the async upload callbacks
  // always see the current items (no stale closure), and in state so it renders.
  const itemsRef = useRef<readonly ComposerAttachment[]>([])
  const controllersRef = useRef(new Map<string, AbortController>())
  const mountedRef = useRef(true)
  const publishingRef = useRef(false)
  const onPostedRef = useRef(onPosted)

  useEffect(() => {
    onPostedRef.current = onPosted
  }, [onPosted])

  useEffect(() => {
    mountedRef.current = true
    const controllers = controllersRef.current
    return () => {
      mountedRef.current = false
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    }
  }, [])

  const commit = useCallback((next: readonly ComposerAttachment[]) => {
    itemsRef.current = next
    if (mountedRef.current) setItems(next)
  }, [])

  const patchItem = useCallback((key: string, patch: Partial<ComposerAttachment>) => {
    if (!itemsRef.current.some(item => item.key === key)) return
    commit(itemsRef.current.map(item => (item.key === key ? { ...item, ...patch } : item)))
  }, [commit])

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

  // "Has content" is judged on what would be SENT: text that is only markup
  // sanitizes to nothing and must not count as a post.
  const hasText = useMemo(() => sanitizeText(text).trim().length > 0, [text])
  const mediaReady = useMemo(() => toCreatePostMedia(items) !== undefined, [items])
  const isUploading = items.some(item => item.status === 'uploading')
  const hasMedia = items.length > 0
  const canPublish =
    (hasText || hasMedia) && mediaReady && !isOverLimit && canPost && !isReadOnly && !isPublishing

  const mediaBlockReason = useMemo((): string | undefined => {
    if (items.some(item => item.status === 'failed')) {
      return 'Remove the attachment that failed to upload before posting.'
    }
    if (items.some(item => item.status === 'uploading')) {
      return 'Waiting for your uploads to finish.'
    }
    if (items.some(item => effectiveAlt(item.alt).length === 0)) {
      return 'Add a description to every photo or video before posting.'
    }
    return undefined
  }, [items])

  /** Any edit to the draft clears the last outcome (failure banner, "posted" notice). */
  const noteEdit = useCallback(() => {
    setPublishError(undefined)
    setPosted(false)
  }, [])

  const setText = useCallback((value: string) => {
    setTextState(value)
    noteEdit()
  }, [noteEdit])

  const startUpload = useCallback((item: ComposerAttachment) => {
    const controller = new AbortController()
    controllersRef.current.set(item.key, controller)

    uploadPickedMedia(item.file, {
      signal: controller.signal,
      onProgress: fraction => patchItem(item.key, { progress: fraction }),
    })
      .then(asset => {
        patchItem(item.key, { status: 'ready', progress: 1, asset })
      })
      .catch((failure: unknown) => {
        // A cancel/remove already dropped the item; nothing to report.
        if (isAbortError(failure)) return
        patchItem(item.key, { status: 'failed', error: uploadFailureMessage(failure) })
      })
      .finally(() => {
        controllersRef.current.delete(item.key)
      })
  }, [patchItem])

  const attachFiles = useCallback((files: readonly File[]) => {
    if (files.length === 0) return
    const result = validateAttachBatch(files, itemsRef.current.map(item => item.kind))
    if (!result.ok) {
      setMediaError(result.error)
      return
    }
    setMediaError(undefined)
    noteEdit()

    const added: ComposerAttachment[] = files.map((file, index) => {
      attachmentSeq += 1
      return {
        key: `attachment-${attachmentSeq}`,
        file,
        kind: result.kinds[index] ?? 'image',
        status: 'uploading',
        progress: 0,
        alt: '',
      }
    })
    commit([...itemsRef.current, ...added])
    for (const item of added) startUpload(item)
  }, [commit, noteEdit, startUpload])

  const removeAttachment = useCallback((key: string) => {
    controllersRef.current.get(key)?.abort()
    controllersRef.current.delete(key)
    commit(itemsRef.current.filter(item => item.key !== key))
    setMediaError(undefined)
    noteEdit()
  }, [commit, noteEdit])

  const setAttachmentAlt = useCallback((key: string, alt: string) => {
    patchItem(key, { alt })
    noteEdit()
  }, [patchItem, noteEdit])

  const publish = useCallback(() => {
    // Re-derive every guard locally rather than trusting a stale `canPublish`
    // closure, and narrow `personaId` to a string (no non-null assertion).
    const personaId = session.personaId
    if (session.isReadOnly || personaId === undefined) return
    if (publishingRef.current) return
    if ([...text].length > charLimit) return

    const body = sanitizeText(text).trim()
    const media = toCreatePostMedia(itemsRef.current)
    if (media === undefined) return
    if (body.length === 0 && media.length === 0) return

    const isReply = parentPostId !== undefined
    const input: CreatePostInput = {
      exerciseId,
      timeZone,
      scenarioTime: scenarioNow().toISOString(),
      authorPersonaId: personaId,
      actingHumanId: session.actingHumanId,
      text: body,
      ...(media.length > 0 ? { media } : {}),
      ...(parentPostId !== undefined ? { parentPostId } : {}),
      origin: 'participant',
    }

    const finish = (view: ParticipantPostView) => {
      // A top-level post is the viewer's own (merged at the top of the feed, its
      // echo kept off the pill). A reply is not a feed item: the thread appends it.
      if (!isReply) ownPostStore.add(view)
      onPostedRef.current?.(view)
      if (!mountedRef.current) return
      setTextState('')
      commit([])
      setMediaError(undefined)
      setPublishError(undefined)
      setPosted(true)
    }

    if (USE_MOCK_DATA) {
      try {
        const post = createPost(input)
        // Register BEFORE appending so the mock stream's synchronous echo of this
        // post is already known to be the viewer's own (the live echo can beat the
        // 201, which `<Feed>` handles by discarding from the pill's buffer).
        if (!isReply) ownPostStore.add(toParticipantView(post))
        // The mock backend: `appendPost` links a reply to its parent (resolving
        // `inReplyTo`) and bumps the parent's reply count, so read the stored form.
        postStore.appendPost(post)
        const stored = postStore.getPosts().find(candidate => candidate.id === post.id) ?? post
        finish(toParticipantView(stored))
      } catch {
        // Only a mock-mode media rejection (unknown id / no alt) can throw here.
        setPublishError(publishFailedMessage(isReply))
      }
      return
    }

    publishingRef.current = true
    setIsPublishing(true)
    setPublishError(undefined)
    publishPost(input)
      .then(created => {
        finish(narrowCreatedPost(created))
      })
      .catch((failure: unknown) => {
        if (!mountedRef.current) return
        // The draft is untouched: this is what makes Retry safe and lossless.
        setPublishError(
          isAxiosError(failure)
            ? publishFailedMessage(isReply)
            : publishUnconfirmedMessage(isReply),
        )
      })
      .finally(() => {
        publishingRef.current = false
        if (mountedRef.current) setIsPublishing(false)
      })
  }, [
    exerciseId,
    timeZone,
    session.personaId,
    session.actingHumanId,
    session.isReadOnly,
    text,
    charLimit,
    parentPostId,
    commit,
  ])

  return {
    text,
    setText,
    attachments: items,
    attachFiles,
    cancelAttachment: removeAttachment,
    removeAttachment,
    setAttachmentAlt,
    mediaError,
    isUploading,
    isPublishing,
    publishError,
    posted,
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
    mediaBlockReason,
    publish,
  }
}

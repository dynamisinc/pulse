/**
 * features/social/types/post.ts
 * ---------------------------------------------------------------------------
 * The Post model (feature: posts, story 03 "Post provenance & telemetry";
 * SOC-003, COR-018, COR-053, XC-002, XC-004). Participant world (Pulse Social
 * skin) — pure data/types module, no UI, no COBRA.
 *
 * TWO SHAPES, DELIBERATELY SEPARATE:
 *
 *   - `Post` — the FULL model, including provenance that is **staff/telemetry
 *     -only**: `origin` (participant / controller-as-persona / engine /
 *     inject) and `injectId`, plus the acting-human attribution
 *     (`actingHumanId`, COR-018) behind a shared persona/org account. This
 *     shape must never be sent to, or read by, a participant surface.
 *
 *   - `ParticipantPostView` — the ONLY shape a participant surface may ever
 *     receive. It has NO provenance fields at all — not hidden, not
 *     falsy-but-present, but structurally ABSENT from the type, so a
 *     participant surface cannot even compile a read of `post.origin`
 *     (XC-002). `services/postService.ts`'s `toParticipantView` is the sole,
 *     sanctioned way to narrow a `Post` down to this shape.
 *
 * TIME (COR-053): `scenarioTime` is the ONLY participant-visible instant —
 * render it via `formatScenarioTime()` from `@/core/clock`, in the exercise's
 * time zone. `createdWallClock` is REAL wall-clock time (sourced from
 * `@/core/time/wallClock`), telemetry/staff-only, and — deliberately — does
 * not exist on `ParticipantPostView` at all.
 *
 * `origin` mirrors `@/core/telemetry`'s `TelemetryOrigin` union exactly
 * (participant / controller-as-persona / engine / inject); see
 * `postService.originConsoleLabel` for the staff console's R-003 vocabulary
 * mapping (this module renders nothing itself).
 *
 * CONTRACT v2 (demo-polish F0 — implementation.md §1.5, FROZEN): this module
 * also carries the v2 wire shapes the server (BP/B2/B3 stories) and the mocks
 * agree on, so the participant world and the controller (staff) world — which
 * imports these as PURE DATA only, never a participant component — build against
 * one definition:
 *
 *   - `PostMedia` v2 (id, kind image|video, url, REQUIRED alt, poster/size/length)
 *   - `PostInReplyTo`, `PostViewerState` — new optional members of the post views
 *   - `PostLinkPreview.imageUrl?` — client-typed only this push (mock-verified)
 *   - the write side: `CreatePostMedia`, `EngagementBaseline` (STAFF only),
 *     `CreatePostInput`, and the 201 response union `CreatedPostView`
 *   - `ReplyTarget` — the staff composer's "replying to" chip (pure data)
 *
 * Every new member is participant-safe by construction. Provenance (`origin`,
 * `actingHumanId`, `createdWallClock`, `injectId`) and the baseline numbers are
 * still structurally ABSENT from `ParticipantPostView` (XC-002) —
 * `types/post.provenance.test.ts` pins that.
 */

/**
 * Provenance of a post — deliberately identical to
 * `@/core/telemetry`'s `TelemetryOrigin`. NEVER participant-visible (XC-002);
 * staff-visible only, via the console's always-visible origin line (R-003).
 */
export type PostOrigin = 'participant' | 'controller-as-persona' | 'engine' | 'inject'

/**
 * A single media attachment on a post (contract v2, §1.5.3). `id` is the
 * `MediaAsset` id and the stable list key. `alt` is REQUIRED for images AND
 * videos (NFR-001) — there is no caption track this push (DP-12), so the
 * description is the video's only text alternative. `url` is a read URL a
 * browser can GET with no credentials; clients never build one themselves.
 * `durationSec` is a media LENGTH, not a clock (COR-053 is unaffected).
 */
export interface PostMedia {
  readonly id: string
  readonly kind: 'image' | 'video'
  readonly url: string
  readonly alt: string
  readonly posterUrl?: string
  readonly width?: number
  readonly height?: number
  readonly durationSec?: number
}

/** Who a reply replies to: the parent post and its author's handle (no leading '@'). */
export interface PostInReplyTo {
  readonly postId: string
  readonly authorHandle: string
}

/**
 * The CALLER's own engagement state on a post. Present on feed/thread reads for
 * a persona-bound participant session; ABSENT on realtime broadcasts and for
 * staff sessions (so a missing `viewer` means "unknown", not "not liked").
 */
export interface PostViewerState {
  readonly liked: boolean
  readonly reposted: boolean
}

/**
 * An in-sim link preview card (SOC-004, story 04 — not built here; the shape
 * is defined now so `Post` can carry one). `domain` is an in-fiction/in-sim
 * domain only — never a real external URL/domain.
 */
export interface PostLinkPreview {
  readonly title: string
  readonly domain: string
  readonly imageLabel?: string
  /**
   * An in-sim preview image URL. CLIENT-TYPED ONLY this push: the server never
   * sends a link preview (feature.md "cut"), so this is exercised by the mocks
   * and the F2 link card alone.
   */
  readonly imageUrl?: string
}

/** Engagement counts. Order everywhere in the product is reply · repost ·
 * like (R-002); `share` is optional (not every surface/post exposes it). */
export interface PostCounts {
  readonly reply: number
  readonly repost: number
  readonly like: number
  readonly share?: number
}

/**
 * The FULL post model. Staff/telemetry-only provenance fields are called out
 * individually below — never destructure/spread a whole `Post` onto a
 * participant-facing payload; always go through `toParticipantView`.
 */
export interface Post {
  readonly id: string
  readonly exerciseId: string
  /** References a `Persona` INSTANCE id (`@/features/personas`),
   * `persona-<handle-lowercased>`. */
  readonly authorPersonaId: string
  /** The individual human behind the account (COR-018) — e.g. which
   * controller was operating a shared org persona, or which participant
   * authored their own post. STAFF/telemetry-only; never participant-visible. */
  readonly actingHumanId: string
  readonly text: string
  readonly media?: PostMedia[]
  /** Set when this post is a reply (contract v2). Participant-safe. */
  readonly inReplyTo?: PostInReplyTo
  /**
   * MOCK-ONLY write-side link: the parent post id a freshly `createPost`-ed reply
   * was addressed to, before `postStore.appendPost` resolves it into `inReplyTo`
   * (the server does that resolution on a live reply). Never on the wire to a
   * participant — `toParticipantView` does not carry it.
   */
  readonly parentPostId?: string
  readonly linkPreview?: PostLinkPreview
  readonly counts: PostCounts
  /** The caller's own like/repost state (contract v2). Participant-safe; absent when unknown. */
  readonly viewer?: PostViewerState
  /** REAL wall-clock ISO instant the post was ingested. Telemetry-only —
   * never render this; see `@/core/time/wallClock`. */
  readonly createdWallClock: string
  /** Scenario ISO instant (COR-053) — the ONLY participant-visible time. */
  readonly scenarioTime: string
  /** Provenance. NEVER participant-visible (XC-002) — staff-visible only. */
  readonly origin: PostOrigin
  /** Set when `origin === 'inject'` — the MSEL inject id (rendered
   * `INJ-nnn` on the staff console, R-003). Never participant-visible. */
  readonly injectId?: string
}

/**
 * The ONLY shape a participant surface may receive. Deliberately has NO
 * `origin`, `actingHumanId`, `createdWallClock`, or `injectId` field — those
 * keys do not exist on this type at all (XC-002).
 */
export interface ParticipantPostView {
  readonly id: string
  readonly authorPersonaId: string
  readonly text: string
  readonly media?: PostMedia[]
  readonly inReplyTo?: PostInReplyTo
  readonly linkPreview?: PostLinkPreview
  /** Baseline + real engagement (the server adds them; the client just renders). */
  readonly counts: PostCounts
  readonly viewer?: PostViewerState
  readonly scenarioTime: string
}

// -----------------------------------------------------------------------------
// Write side (contract v2, §1.5.2)
// -----------------------------------------------------------------------------

/**
 * One attachment on a new post: a `MediaAsset` the SAME actor already uploaded
 * (`core/media`), plus its required alt text. `posterMediaId` optionally
 * overrides a video's poster. The legacy `{ kind, alt }` placeholder (no media
 * id) is no longer sent — the server ignores an all-placeholder list only for
 * the pre-demo deploy window (DP-6).
 */
export interface CreatePostMedia {
  readonly mediaId: string
  readonly alt: string
  readonly posterMediaId?: string
}

/**
 * The staff controller-as-persona's seeded starting engagement (CTL-001). STAFF
 * ONLY: the server ignores it for a participant, and the participant views never
 * carry it back (the read side returns baseline + real as plain `counts`).
 * Values are integers 0..1,000,000.
 */
export interface EngagementBaseline {
  readonly like?: number
  readonly repost?: number
  readonly reply?: number
}

/**
 * Input to `createPost` (mock) and `publishPost` (live). The caller supplies
 * `scenarioTime`/`timeZone` from its own clock / exercise context — the
 * services stay pure and never read either. `exerciseId` stamps the MOCK post
 * and its telemetry envelope only; it is NEVER sent on the wire (COR-001).
 */
export interface CreatePostInput {
  readonly exerciseId: string
  readonly timeZone: string
  readonly scenarioTime: string
  readonly authorPersonaId: string
  readonly actingHumanId: string
  readonly text: string
  /** <= 4 images OR exactly 1 video; never mixed. */
  readonly media?: CreatePostMedia[]
  readonly linkPreview?: PostLinkPreview
  readonly counts?: Partial<PostCounts>
  readonly origin: PostOrigin
  readonly injectId?: string
  /** Makes this post a reply to `parentPostId` (an opaque post id). */
  readonly parentPostId?: string
  /** STAFF only (see {@link EngagementBaseline}). */
  readonly engagementBaseline?: EngagementBaseline
}

/**
 * The staff caller's OWN 201 response from `POST /api/posts` for a non-
 * participant origin (`StaffPostDto`): the participant view widened by the
 * provenance the console's always-visible origin line reads (R-003). It exists
 * ONLY for that response — it is never a participant shape and never handed to
 * a participant surface.
 */
export interface StaffPostView extends ParticipantPostView {
  readonly exerciseId: string
  readonly actingHumanId: string
  readonly origin: PostOrigin
  readonly injectId?: string
  readonly createdWallClock: string
}

/** What `publishPost` resolves with: the parsed 201 body (participant OR staff shape). */
export type CreatedPostView = ParticipantPostView | StaffPostView

/**
 * The staff composer's "replying to" target (C1/C2/C3) — pure data shared with
 * the controller world; the controller never imports a participant component.
 * `excerpt` is the parent's text truncated to <= 140 characters.
 */
export interface ReplyTarget {
  readonly postId: string
  readonly authorHandle: string
  readonly authorDisplayName: string
  readonly excerpt: string
}

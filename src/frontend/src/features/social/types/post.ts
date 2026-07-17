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
 */

/**
 * Provenance of a post — deliberately identical to
 * `@/core/telemetry`'s `TelemetryOrigin`. NEVER participant-visible (XC-002);
 * staff-visible only, via the console's always-visible origin line (R-003).
 */
export type PostOrigin = 'participant' | 'controller-as-persona' | 'engine' | 'inject'

/** A single media attachment on a post. Phase-1 scope is image-only. */
export interface PostMedia {
  readonly kind: 'image'
  readonly alt: string
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
  readonly linkPreview?: PostLinkPreview
  readonly counts: PostCounts
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
  readonly linkPreview?: PostLinkPreview
  readonly counts: PostCounts
  readonly scenarioTime: string
}

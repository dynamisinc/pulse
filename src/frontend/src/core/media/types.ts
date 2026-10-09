/**
 * core/media/types.ts
 * ---------------------------------------------------------------------------
 * The WIRE shapes of the media upload + library contract (demo-polish
 * implementation.md §1.5.1; owner of the server half is the BM story). Pure
 * data types — no UI, no theme, no React. `core/media` is deliberately
 * WORLD-NEUTRAL: it is imported by the participant world (the social composer,
 * F4) and by the staff world (the controller's composer + media library, C1/C3)
 * and must therefore know nothing about either world's skin.
 *
 * `MediaAssetView` is what `POST /api/media` answers with (201) and the shape a
 * post's `media[]` items are built from. `StaffMediaAssetView` is the staff
 * library row (`GET /api/staff/media`): the participant shape widened by the
 * original file name and the SCENARIO instant it was uploaded (DP-1 — stamped
 * from the exercise clock on the server, never derived from wall-clock at
 * read). The extra members are STAFF-ONLY; a participant payload never carries
 * them (XC-002).
 *
 * Ids are opaque strings (a GUID live, `mock-media-<uuid>` in mock mode).
 * Nothing here ever names an `exerciseId`: the client never sends one (COR-001).
 */

/** What an uploaded asset is. The server decides by sniffing magic bytes. */
export type MediaKind = 'image' | 'video'

/** An uploaded media asset as the participant world may see it. */
export interface MediaAssetView {
  readonly id: string
  readonly kind: MediaKind
  /** Read URL a browser can GET with no credentials (a short-lived read SAS live). */
  readonly url: string
  /** Videos only: the poster image URL, when one was uploaded alongside. */
  readonly posterUrl?: string
  readonly width?: number
  readonly height?: number
  /** Videos only: media length in seconds (a media length, not a clock). */
  readonly durationSec?: number
}

/** A row in the staff media library (`GET /api/staff/media`). STAFF-ONLY members. */
export interface StaffMediaAssetView extends MediaAssetView {
  readonly fileName: string
  /** Scenario-time ISO instant the asset was uploaded (COR-053). */
  readonly uploadedAtScenario: string
}

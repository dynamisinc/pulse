/**
 * features/controller/personaEdit/types.ts
 * ---------------------------------------------------------------------------
 * The shapes of the persona profile edit (demo-polish story 21 / PE-FE,
 * docs/features/demo-polish/21-persona-profile-edit.md; COR-020, COR-022 (edit,
 * not create), COR-024, NFR-004). STAFF world: pure data types, no React, no
 * theme.
 *
 * Two layers, deliberately separate:
 *
 *   - `PersonaEditDraft` is what the DIALOG holds while the controller types —
 *     every text field as the raw string in its input, the verified flag, and
 *     what the controller chose for each image (`ImageChoice`).
 *   - `PersonaPatch` is what goes ON THE WIRE: an RFC 7396 JSON merge-patch body
 *     (PE-BE's shipped contract, PATCH /api/staff/personas/{id}). A key that is
 *     ABSENT means "leave it alone"; `null` clears (only `bio`, `location`,
 *     `avatarMediaId`, `bannerMediaId` may be cleared); a value sets. The draft is
 *     diffed against the persona to produce the patch, so only CHANGED fields are
 *     ever sent and the whole persona is never echoed back (the server answers an
 *     `id` / `avatarUrl` / `handle` in the body with a 400).
 *
 * `handle`, `kind`, `personaType` and `exerciseId` are NOT in `PersonaPatch` on
 * purpose: they are immutable (the engine matches on handles, plan §9) and the
 * type makes it impossible to build a patch naming one.
 */

/**
 * The wire names of the six editable fields — also the vocabulary of the
 * `fields` array on the `persona_edit` telemetry event (names only, never
 * values: implementation.md §1.8).
 */
export type PersonaEditField =
  | 'displayName'
  | 'bio'
  | 'location'
  | 'verified'
  | 'avatarMediaId'
  | 'bannerMediaId'

/**
 * The JSON merge-patch body. Every member is optional; an absent member is
 * "unchanged". `null` is only representable where the server accepts it.
 */
export interface PersonaPatch {
  readonly displayName?: string
  readonly bio?: string | null
  readonly location?: string | null
  readonly verified?: boolean
  readonly avatarMediaId?: string | null
  readonly bannerMediaId?: string | null
}

/**
 * What the controller chose for an avatar or banner:
 *   - `keep`  — leave whatever the persona has (the default);
 *   - `clear` — remove the persona's image (sent as `null`);
 *   - `set`   — use this media asset (uploaded just now, or picked from the
 *               library). `previewUrl` is the asset's read URL when known, for the
 *               in-dialog preview only — it is never sent anywhere.
 */
export type ImageChoice =
  | { readonly mode: 'keep' }
  | { readonly mode: 'clear' }
  | { readonly mode: 'set'; readonly mediaId: string; readonly previewUrl?: string }

/** The dialog's working copy of the persona's editable profile. */
export interface PersonaEditDraft {
  readonly displayName: string
  readonly bio: string
  readonly location: string
  readonly verified: boolean
  readonly avatar: ImageChoice
  readonly banner: ImageChoice
}

/** Per-field validation messages; a missing key means the field is valid. */
export interface DraftProblems {
  readonly displayName?: string
  readonly bio?: string
  readonly location?: string
}

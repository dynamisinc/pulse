/**
 * features/social/edit/editLimits.ts
 * ---------------------------------------------------------------------------
 * The edit-own-post limits (demo-feedback DF-29, story 20), shared by the MOCK edit
 * service and its tests. The SERVER is authoritative for both (story 19): the client
 * only counts `viewer.editableForSeconds` down and shows what the server answers.
 * A leaf module (no imports) so `postService` can use it without a cycle.
 */

/** The edit window: 15 minutes from publishing, in seconds. */
export const EDIT_WINDOW_SECONDS = 15 * 60

/** The most edits one post accepts (history versions 0..5). */
export const EDIT_LIMIT = 5

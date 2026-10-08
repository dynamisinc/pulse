/**
 * core/media/mediaLibraryKey.ts
 * ---------------------------------------------------------------------------
 * The React Query key prefix of the staff media library. Its own tiny module so
 * the upload client (which invalidates it after every successful upload) and the
 * `useMediaLibrary` hook (which reads it) share ONE definition without importing
 * each other. World-neutral (`core/`).
 */

/**
 * Prefix of every media-library query. `useMediaLibrary` appends the session's
 * exercise id and then the kind filter: `[...prefix, exerciseId, kind | 'all']`.
 * Invalidating the prefix refreshes every exercise/kind variant.
 */
export const MEDIA_LIBRARY_QUERY_KEY = ['staff', 'media'] as const

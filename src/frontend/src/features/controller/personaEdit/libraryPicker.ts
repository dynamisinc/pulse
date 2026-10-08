/**
 * features/controller/personaEdit/libraryPicker.ts
 * ---------------------------------------------------------------------------
 * THE ONE SEAM to demo-polish story C1's staff media-library picker.
 *
 * PE-FE (persona profile edit) lets the controller pick an avatar / banner from
 * the exercise's media library. The picker is C1's component — C1 owns
 * `features/controller/media/**` (implementation.md §4.1) and its props are FROZEN
 * in §1.11:
 *
 *   interface MediaLibraryPickerProps {
 *     kind?: MediaKind; max: number; selectedIds: string[]; onChange(ids: string[]): void
 *   }
 *
 * PE-FE codes against those props only. Every PE-FE import of the picker goes
 * through THIS file, so if C1's final path or export name differs from
 * `controller/media/MediaLibraryPicker`, the fix is this one line and nothing else
 * in `personaEdit/` changes.
 *
 * (In PE-FE's own branch the file at that path is a clearly-marked STAND-IN
 * committed before the feature commit — see its header; C1's real one replaces it
 * on merge. PE-FE's tests substitute a props-contract fake for this module, so
 * they exercise the contract, not C1's DOM.)
 */

export { MediaLibraryPicker } from '@/features/controller/media/MediaLibraryPicker'

# Run sheet (demo-polish C3, story 19, issue #438)

STAFF world (controller console). A browser-side list of staged posts ("beats") a controller
fires with one key press: the scripted misinformation beat of the demo. No backend of its own:
the sheet lives in `localStorage` per exercise, moves in and out as `pulse.runsheet.v1` JSON, and
fires through the existing `POST /api/posts`. No scheduler: "T+14m" is information and a sort hint.

Mount it through the console's slot (self-contained, no props; needs the exercise context and a
React Query client above it):

```tsx
<ControllerConsole runSheetSlot={() => <RunSheetPanel />} ... />
```

| File | Role |
|------|------|
| `RunSheetPanel.tsx` | The panel (the only public component). Keyboard, import / export, dialogs. |
| `RunSheetBeatRow.tsx` | One beat: status chip (text + icon), details, the selected row's actions. |
| `BeatEditor.tsx` | Add / edit dialog. Uses C1's `MediaLibraryPicker` through its frozen props. |
| `libraryView.ts` | The panel's id -> asset view of the media library: the "All" list it fetches (`useMediaLibrary`) plus a fallback to the picker's cached Images / Videos lists (`useLibraryAssetLookup`), so an asset picked under a filter that the capped "All" list misses still resolves. |
| `ConfirmDialog.tsx` | The one confirm step (delete, replace-by-import, fire again, discard). Focus starts on Cancel. |
| `useRunSheet.ts` | Joins sheet + exercise + acting human + personas; `fire` / `fireNext`. |
| `runSheetFire.ts` | Block reasons, the post a beat becomes, `sendBeat`, failed-vs-unconfirmed classification. |
| `runSheetStore.ts` | Reactive per-exercise store over `localStorage` (write-through, read-modify-write). |
| `runSheetStorage.ts` | Key `pulse.runsheet.v1:{exerciseId}`, validated read, safe write. |
| `runSheetModel.ts` | Pure operations on the model; the status transitions. |
| `runSheetSchema.ts` | **The file format** `pulse.runsheet.v1` (zod). The one place S1's docs should reference. |
| `runSheetBeatForm.ts` | Editor draft <-> beat, field-keyed validation (same zod rules as the importer). |
| `runSheetKeyboard.ts` | Which key means what, and when it is ignored. |
| `runSheetStatus.ts` | Status chip vocabulary. |
| `runSheetFileIO.ts` | Object-URL download, reading a picked file. |
| `runSheetTestKit.tsx` | Test helpers (not app code). |

## Things worth knowing

- **Status is never in the file.** `pending | fired | skipped | failed`, `firedPostId`, failures and
  the in-flight marker live in storage only. Importing resets every beat to pending.
- **Failed vs unconfirmed.** `POST /api/posts` is not idempotent yet (F4 / #455). A 4xx is `failed`
  (Retry is safe). No response, a 5xx / 504 / 408, an unreadable 2xx, or a page closed mid-request is
  `unconfirmed`: the post may be live, there is no Retry, `Fire next` skips it, and re-firing needs a
  confirmation. Both are stored as `status: 'failed'`; `failure.kind` tells them apart.
- **One fire at a time.** The slot is claimed synchronously and persisted, so a double-press sends one
  request and a reload mid-request cannot leave a "pending" beat that was actually sent.
- **Fire next** targets the first `pending` beat only, and reports (rather than skips) a blocked one.
- **Mock mode** (`USE_MOCK_DATA`, `npm run dev`) fires through `createPost` + `postStore`, so the demo
  runs with no backend.

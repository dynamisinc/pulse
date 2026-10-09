# controller/personaEdit — persona profile edit (staff, COBRA)

Demo-polish story 21, frontend half (**PE-FE**; backend half PE-BE ships `PATCH /api/staff/personas/{id}`).
Lets a controller rename a persona and set its bio, location, verified mark, avatar and banner from the
console. **Handles are immutable** (the engine matches on them) and are shown read-only.

**World: STAFF.** COBRA components, dense, keyboard-first, FontAwesome only, MUI 9 `sx`-only. Nothing
participant-styled is imported (`personaEdit.worlds.test.ts` enforces it, both directions).

## What the console mounts

```tsx
import { PersonaEditButton } from '@/features/controller/personaEdit'

<PersonaContextPanel persona={activePersona} actionsSlot={<PersonaEditButton persona={activePersona} />} />
```

`PersonaEditButton` takes `{ persona: StaffPersona }` and is self-contained. It needs the console's providers
(`ExerciseContextProvider`, `ActivePersonaProvider`, React Query).

## Files

| File | Role |
|---|---|
| `PersonaEditButton.tsx` | The only export the route uses: button + dialog + "Saved" status; returns focus to itself. |
| `PersonaEditDialog.tsx` | The COBRA dialog (form; mounted only while open). |
| `ImageChooser.tsx` | Avatar / banner: upload (`useMediaUpload`) or pick from the library; preview. |
| `VerifiedConfirmDialog.tsx` | Confirmation when Verified is turned on or off (SOC-052). |
| `DiscardChangesDialog.tsx` / `consoleChords.ts` | "Discard your changes?" on Esc; swallows the console's ⌘K. |
| `usePersonaEdit.ts` | The save flow: PATCH, then `invalidatePersonas()`, `selectPersona(updated)`, ONE `steering_action`. |
| `personaEditService.ts` | `patchPersona`, error mapping (400 text verbatim), response parser. |
| `personaEditMock.ts` | Mock adapter: the contract's exact 400 texts; **edits the mock persona directory**. |
| `personaEditForm.ts` / `textRules.ts` / `personaEditStyles.ts` | Pure: validation, the draft -> merge-patch diff, AA colours. |
| `libraryPicker.ts` | The ONE import seam to C1's `MediaLibraryPicker`. |
| `PersonaEditHarness.testUtils.tsx` | Test-only render harness. |

## Contract notes (PE-BE, after the Gate-1 fold)

- JSON merge-patch (RFC 7396), `Content-Type: application/merge-patch+json` (anything else is 415).
  Only **changed** fields are sent; `null` clears `bio` / `location` / `avatarMediaId` / `bannerMediaId`
  (never `""`); the persona is never echoed back; `{}` is valid but the dialog never sends it.
- The server's 400 sentence is shown to the controller **verbatim**; 401 / 403 / 404 / 415 / 5xx / network
  have their own staff copy.
- **Never truncate user text.** Lengths are counted in **UTF-16 units** — the server's `string.Length`, so an
  emoji counts 2 (256 emoji fill the bio) — and an over-long field shows its limit and blocks Save (a cut
  through a surrogate pair is a server 400). Control characters and bidi overrides are refused (the bio may
  hold line breaks and tabs); a display name needs a visible character by the **server's own rule**
  (`textRules.hasVisibleCharacter`: separators, controls, format, combining marks, surrogates, unassigned and
  the five blank filler glyphs); lookalike names are allowed (SOC-052).
- **The 200 body is the server's `FromPersona`.** `templateId` is `""` for every template-less persona (the
  whole seeded cast) and the optional strings are *omitted*; the parser validates only what the console relies
  on (`parseStaffPersonaResponse`). The staff DTO has **no media id / has-image flag**: a missing avatar URL
  means "none set" *or* "signing failed", so Remove is always offered and the copy never claims "none is set".
- **Dismissing:** a clean dialog closes on Esc / backdrop; with unsaved work the backdrop is ignored and Esc asks
  "Discard your changes?"; ⌘K / Ctrl+K is swallowed so the console palette cannot open behind the modal.
- Telemetry: the **console** emits `steering_action { action: 'persona_edit', fields }` (field **names**
  only), `target { persona, id }`, once per successful edit, in mock and live mode. The server emits none (DP-9).

## Mock vs live

`USE_MOCK_DATA` (`@/core/config/mockData`) is the one flip point. In mock mode the edit replaces the persona in
the mock directory (`SEEDED_PERSONAS`), so the staff picker, the participant feed's author lookup and the
active-persona panel all show it after `invalidatePersonas()`. `resetMockPersonaEdits()` restores the seeds.

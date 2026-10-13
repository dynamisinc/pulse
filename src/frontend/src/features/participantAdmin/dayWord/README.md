# participantAdmin / dayWord

**Easy participant login, story 11: the staff "Today's word" panel.** STAFF world: COBRA components
(`@/theme/styledComponents`), FontAwesome, MUI 9 `sx`-only. It is not a participant surface and is
never confusable with one.

Staff set one word per exercise day and read it to the room; participants then sign in with their
sign-in name plus that word (story 09). The server stores only a hash (EL-9), so **the word is shown
once, when it is set**. This panel is built around that.

## Use

```tsx
import { DayWordPanel } from '@/features/participantAdmin/dayWord'

<DayWordPanel />   // no props
```

The orchestrator mounts it into the roster page's `dayWordSlot` (story 10). It needs a React Query
client, the COBRA theme and an `ExerciseContextProvider` above it, all of which the staff frame
already provides.

## Files

| File | What it is |
|---|---|
| `DayWordPanel.tsx` | The exported component. Status, generate / set / rotate, date pre-set, Upcoming, turn off. |
| `OneTimeWordResult.tsx` | The ONE place the plaintext word is rendered: framed block, Copy, Show large, Done. Unmounting it clears the word. |
| `DayWordConfirmDialog.tsx` | The `role="alertdialog"` confirm for rotate / turn off / clear. |
| `useDayWord.ts` | `useDayWordStatus` (query, keyed on the exercise id), `useSetDayWord` (consume-once mutation), `useClearDayWord`. |
| `dayWordService.ts` | axios under `/staff/day-word`, runtime guards, typed `DayWordError`, the `USE_MOCK_DATA` flip point. |
| `dayWordMocks.ts` | The mock adapter (the three calls of the frozen contract) and `dayWordMockControls` (a test seam). |
| `dayWordNormalize.ts` | Pure mirror of the server's normalisation, for the live length check only. |
| `dayWordDates.ts` | Pure calendar-date and exercise-zone instant helpers. |
| `types.ts` | The day-word half of the frozen wire contract. |

## Rules this folder keeps

- **Secrets.** The word lives only in component state for the one result view. Not in the React Query
  query or mutation cache (`gcTime: 0` + `reset()`), storage, a toast, a log, the title or a URL.
  `DayWordPanel.secrets.test.tsx` guards each of those.
- **Failures.** A failed background re-read of the status never hides the one-time word: the full
  error state is only for "no status at all", otherwise an inline notice with Try again. A malformed
  2xx is its own error kind ("the word may have been set"), never "check your connection". Status is
  re-read after every PUT / DELETE however it ends, on window focus, and just after the local-midnight
  rollover. Error objects never carry the request (and so never the typed word).
- **Normalisation.** `dayWordNormalize.ts` is the server's chain step for step (NFKD, strip combining
  marks, lower-case, `a-z0-9`), so "Ñandú 1" is six characters.
- **Isolation.** No request carries an exercise id. The query key includes the active exercise id for
  cache separation only, and the panel body is re-keyed on it so a switch drops all state.
- **Time.** Real dates and instants in the exercise zone, with the zone named. Never scenario time.
- **Accessibility.** Labelled controls, `alertdialog` confirms with focus management, a polite live
  region that announces "Word set ..." without the word, status as icon plus text.
- **Mock-first.** `USE_MOCK_DATA` attaches the mock adapter per request at one flip point; a build
  that does not opt in talks to the real API and fails closed.

## Tests

`npx vitest run src/features/participantAdmin/dayWord`

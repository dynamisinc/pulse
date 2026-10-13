# participantAdmin (STAFF world, despite the name)

The **Participants** staff screen: add people to the exercise, see who is in, fix whoever is not.
Feature `easy-login`, story 10 (`docs/features/easy-login/10-fe-roster-screen.md`); decisions EL-1..EL-14 and
the frozen wire contract are in `docs/features/easy-login/implementation.md`.

**This is the staff world.** COBRA only (`@/theme/styledComponents`, `CobraStyles`), FontAwesome only, MUI 9
`sx`-only system props, desktop-first and dense. It is deliberately not a participant root, and
`staffShell/twoWorldsSeparation.test.ts` forbids any participant surface from importing it.

## Layout

```
ParticipantAdminRoute.tsx   StaffShellFrame + RosterPage (the registry mounts this at /staff/participant-admin)
pages/RosterPage.tsx        the composition point + the three frozen slot props
components/people/          RosterTable, RosterRowActions, RosterImportPanel, AddParticipantDialog,
                            ConfirmActionDialog, RosterBadges, and the pure rules they render
                            (rosterDisplay, rosterActions, rosterValidation, rosterImport, copyToClipboard)
services/rosterService.ts   axios under /staff/roster..., runtime guards, typed RosterError
hooks/                      useRoster (exercise-keyed query), useRosterMutations (add, import, actions)
mocks/rosterMocks.ts        stateful mock backend that follows the contract (USE_MOCK_DATA)
types.ts                    the roster half of the frozen contract
test/                       render harness + fixtures for the tests
```

Stories 11 (`dayWord/`), 12 (`cards/`) and 13 (`email/`) own their own folders and plug into `RosterPage`'s props.
Nothing here imports them.

## The seam: slot props (frozen)

```ts
interface RosterPageProps {
  dayWordSlot?: ReactNode                                          // above the table
  renderCardsAction?: (selection: readonly string[]) => ReactNode  // in the toolbar
  renderEmailAction?: (selection: readonly string[]) => ReactNode  // in the toolbar
}
```

`selection` is the selected participant (account) ids in roster order. An absent slot renders nothing.

## Rules worth knowing before you change anything

- **No exercise id on the wire.** The server scopes everything. The active exercise id only keys the React Query
  cache (`['participantAdmin', exerciseId, 'roster']`) so switching exercise never shows the previous people.
- **`joinUrl` is a secret.** It lives in query data and goes to the clipboard inside the click handler. It is never
  rendered, put in a toast, a log, a `title` or a URL. The list query is `staleTime: 0` with a short `gcTime`.
- **Status is never colour alone**: every mark is an icon plus a word.
- **Times** are real wall-clock instants in the exercise time zone with the zone named. The scenario-time-only rule
  (COR-053) binds the participant world, not this screen.
- **Mock/live**: `rosterService.ts` is the one flip point (`USE_MOCK_DATA`). `mocks/rosterMocks.ts` has a 403 switch
  (`setRosterMockAccess`) and a `joinLinksAvailable: false` switch (`setRosterMockJoinLinksAvailable`).

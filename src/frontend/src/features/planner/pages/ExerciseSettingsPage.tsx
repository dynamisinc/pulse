/**
 * features/planner/pages/ExerciseSettingsPage.tsx
 * ---------------------------------------------------------------------------
 * The staff-console EXERCISE SETTINGS page (feature: exercise-configuration,
 * story 01b; COR-030; issue #41 / story #67). The planner's one place to see
 * and change everything that configures a single exercise.
 *
 * TWO WORLDS — STAFF (D0 §2 / CLAUDE.md). Desktop-first COBRA: it renders
 * inside the app's COBRA `ThemeProvider` and mounts NO participant/brand theme,
 * even though the values edited here are what the participant world is skinned
 * from. It draws no app chrome of its own — the shared staff shell (D7) owns the
 * header and toolstrip; this page is work-area content, exactly like
 * `features/evaluator/pages/EvaluatorDashboardPage.tsx`.
 *
 * ============================================================================
 * THE SHAPE: LEFT SECTION NAV + CONTENT PANE
 * ============================================================================
 * This was a single long vertical scroll (three stacked panels, ~20 fields).
 * It is now a section nav on the left and the selected section's content on the
 * right — the Cadence/COBRA idiom for dense operator config, chosen over tabs
 * because it keeps scaling as more panels land.
 *
 * Five sections, from ONE registry (`SECTIONS` below):
 *
 *   1. Identity & schedule  ┐
 *   2. Channels             ├─ three VIEWS over ONE shared settings form
 *   3. Theming & outlets    ┘
 *   4. Compliance chrome    ─  its own form, its own save (story 02)
 *   5. Practice / sandbox   ─  its own form, its own save (story 04)
 *
 * ============================================================================
 * THE STICKY SHELL: WHAT MOVES AND WHAT DOES NOT
 * ============================================================================
 * At `lg` and up the page is a FIXED-HEIGHT FLEX COLUMN, not a document that
 * scrolls:
 *
 *   ┌ main (height:100%, overflow:hidden) ────────────────────────────┐
 *   │  h1 + intro + divider           flexShrink:0 — never scrolls    │
 *   │ ┌ row (flex:1 1 auto, minHeight:0) ────────────────────────────┐│
 *   │ │  nav (fixed width, pinned) │ CONTENT PANE (overflow-y:auto)  ││
 *   │ └──────────────────────────────────────────────────────────────┘│
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * The page used to carry `overflow-y: auto` itself, so a section taller than
 * the work area scrolled the title and the section nav away with it. Now the
 * ONE scrollport is the content pane: whatever a section cannot fit scrolls
 * there, under a heading and a nav that hold still, and no second outer
 * scrollbar appears beside it. `minHeight: 0` on the row and the pane is what
 * makes that work at all — a flex item defaults to `min-height: auto` and
 * refuses to shrink below its content, which would push the page taller
 * instead of scrolling the pane.
 *
 * Below `lg` it reverts to ordinary document flow (`height: auto`,
 * `overflow: visible`) and the staff shell's work area scrolls the page as a
 * whole: pinning a wrapped nav row on a narrow screen would eat the little
 * height there is.
 *
 * HEIGHT IS THE SCARCE RESOURCE, AND IT IS SPENT ON FIELDS. The sections were
 * measured in a real browser (1440x900, work area 844px) and three of the five
 * overflowed — theming worst, by ~170px. The fix was NOT to shrink anything:
 * the panels lay their fields out in a responsive grid (`FieldGrid`) instead of
 * one column, and the panels' redundant inner padding — the page already insets
 * the pane — was dropped. Fonts, control sizes and COBRA spacing are untouched.
 * Re-measure before adding a field: at 1280x800 the tightest sections have
 * ~16px of headroom left.
 *
 * WHATEVER SCROLLS, THE COMMIT POINT DOES NOT. Because sections 1–3 share ONE
 * full-replace save, a save button that can scroll out of reach would make this
 * page MORE dangerous, not less — so each panel's footer is a `PanelSaveBar`,
 * pinned to the bottom of the pane, and the pane reserves
 * `scroll-padding-bottom` so a focused field is never scrolled to underneath it.
 *
 * ============================================================================
 * THIS PAGE IS STILL A COMPOSITION POINT — KEEP IT THAT WAY
 * ============================================================================
 * Per `docs/features/exercise-configuration/implementation.md` → "Integration
 * seams", this file is where the feature's other stories hang their panels. It
 * still costs ONE line — now one ENTRY in `SECTIONS`:
 *
 *   { id: 'my-thing', label: 'My thing', icon: faThing,
 *     content: { kind: 'panel', panel: <MyThingPanel /> } },
 *
 * ...plus its `id` in the `ExerciseConfigSectionId` union. Nothing else: no prop
 * threaded through, no layout edited, no save wired. A self-contained panel
 * (own hook, service, query, states, no props) is the contract that keeps two
 * builders off the same lines. Add a section, add it to the mount guard in
 * `ExerciseSettingsPage.test.tsx`.
 *
 * WHAT THIS PAGE OWNS, AND WHAT IT STILL MUST NOT
 * -----------------------------------------------
 * It holds NO data fetching and NO state belonging to a panel: chrome and
 * practice remain entirely self-contained, and anything that looks like chrome
 * configuration or practice-mode behaviour belongs in those panels, never here.
 *
 * The ONE DELIBERATE EXCEPTION, introduced with this layout: the page holds
 * which section is selected, and mirrors two facts the SHARED SETTINGS FORM
 * reports up (`dirty`, `sectionsWithErrors`) so the nav can mark them. It is a
 * mirror, never the source — the form values themselves stay inside
 * `ExerciseSettingsPanel`. Read that panel's header before changing any of this.
 *
 * ============================================================================
 * THE CONSTRAINT THAT DRIVES THE WHOLE LAYOUT
 * ============================================================================
 * `PUT /api/staff/exercise-settings` is a FULL REPLACE: a body missing
 * `brandName` / `locale` / `outletNames` clears all three and resets channels.
 * So sections 1–3 are NOT three forms:
 *
 *   - exactly ONE `<ExerciseSettingsPanel />` is mounted for all three, with the
 *     selected section passed in as a prop. Three mounts would mean three form
 *     states and three partial saves — each one wiping the other two sections;
 *   - it stays MOUNTED (just `hidden`) while sections 4–5 are on screen, so a
 *     planner's unsaved edits survive a detour and are there on return;
 *   - Save and Revert live in that panel's shared footer, visible in all three
 *     sections, so nobody hunts for the section that owns the button.
 *
 * UNSAVED CHANGES. Nothing is discarded by switching sections here (see above),
 * but silence would still be wrong: while the settings form is dirty the nav
 * carries a `role="status"` notice, and when the planner is on a section that
 * cannot save it, that notice says so and offers a way back. There is
 * deliberately NO routing-level `beforeunload` prompt.
 *
 * VALIDATION IN A SECTION YOU CANNOT SEE. A blocked save marks every offending
 * section in the nav (FontAwesome icon + the words "Needs attention" — never
 * colour alone) and moves the planner to the first one if the problem is not on
 * their screen. The server reports only its FIRST failure, so this client-side
 * pass is what makes a multi-section problem discoverable at all.
 *
 * ACCESSIBILITY (NFR-001, WCAG 2.1 AA). The pattern is NAVIGATION + a labelled
 * REGION, implemented completely — not a half-built tablist:
 *  - a real `<nav>` with an accessible name, holding a `<ul>` of real `<button>`
 *    elements: each is natively tabbable and Enter/Space-operable, so there is
 *    no roving tabindex to get wrong;
 *  - the selected one is marked `aria-current="page"` — programmatic, not just a
 *    background colour;
 *  - the content pane is a named `region` with `tabIndex={-1}`; choosing a
 *    section moves focus there, so a keyboard or screen-reader user lands on the
 *    content they asked for instead of the top of the document. Focus moves only
 *    on a real selection, never on first render;
 *  - unselected sections are `hidden`, so they are out of the accessibility tree
 *    entirely — no phantom headings, no focus traps in invisible forms;
 *  - one `<main>`, one `h1`; each section's own heading stays an `h2`;
 *  - COBRA has NO `palette.warning` (it falls through to stock MUI and fails AA
 *    at ~3.8:1), so the status/error text here uses `notifications.warningText`
 *    (#6F4E37, 7.4:1 on white) and `notifications.errorText` (#b22222, 6.7:1 on
 *    white). The `notifications.warning` / `success` tokens are pale FILL tints
 *    and are unusable as text or borders.
 *
 *  - the sticky shell must not hide what a keyboard user is on. The pinned save
 *    bar overlays the bottom of the scrollport, so the pane sets
 *    `scroll-padding-bottom` from `PANEL_SAVE_BAR_SCROLL_PADDING_PX` — the room
 *    the browser keeps clear when it scrolls a focused control into view. With
 *    it removed, focusing the outlet-name fields put them 70px BEHIND the bar
 *    (measured). The heading block cannot hide anything: it is outside the
 *    scrollport rather than floating over it.
 *
 * DESKTOP-FIRST, not desktop-only: below `lg` the nav becomes a wrapping
 * horizontal row above the content rather than a squeezed column.
 *
 * ROUTING is orchestrator-owned (`src/frontend/src/App.tsx` + the planner
 * barrel): this feature exports the page and never edits the route table.
 *
 * SCENARIO TIME (COR-053): not applicable — staff world throughout.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Box, ButtonBase, Divider, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faArrowLeft,
  faFlask,
  faGears,
  faPenToSquare,
  faShieldHalved,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import CobraStyles from '@/theme/CobraStyles'
import { CobraLinkButton } from '@/theme/styledComponents'
import {
  CLEAN_EXERCISE_SETTINGS_STATUS,
  EXERCISE_SETTINGS_SECTION_META,
  EXERCISE_SETTINGS_SECTION_ORDER,
  type ExerciseSettingsSectionId,
  type ExerciseSettingsStatus,
} from '../exerciseSettingsSections'
import { ExerciseSettingsPanel } from '../components/ExerciseSettingsPanel'
import { ComplianceChromePanel } from '../components/ComplianceChromePanel'
import { PracticeModePanel } from '../components/PracticeModePanel'
import { PANEL_SAVE_BAR_SCROLL_PADDING_PX } from '../components/PanelSaveBar'

// ---------------------------------------------------------------------------
// The section registry
// ---------------------------------------------------------------------------

/** Every section the nav can select. Adding a panel adds one member here. */
type ExerciseConfigSectionId = ExerciseSettingsSectionId | 'chrome' | 'practice'

/**
 * What a section shows.
 *
 * `sharedSettings` exists because sections 1–3 are views over ONE form and must
 * therefore share ONE mounted panel — the registry cannot hold three separate
 * elements for them without recreating the full-replace data-loss bug. A NEW
 * panel is always `kind: 'panel'`.
 */
type SectionContent =
  | { readonly kind: 'sharedSettings'; readonly section: ExerciseSettingsSectionId }
  | { readonly kind: 'panel'; readonly panel: ReactNode }

interface ExerciseConfigSection {
  readonly id: ExerciseConfigSectionId
  /** The nav label AND (for shared-settings sections) the heading it lands on. */
  readonly label: string
  readonly icon: IconDefinition
  readonly content: SectionContent
}

/**
 * THE COMPOSITION POINT. One entry per section, in nav order.
 *
 * The three shared-settings entries take their label and icon from the panel
 * itself, so the item a planner clicks and the `h2` they land on cannot drift
 * apart. Self-contained panels bring their own.
 */
const SECTIONS: readonly ExerciseConfigSection[] = [
  ...EXERCISE_SETTINGS_SECTION_ORDER.map<ExerciseConfigSection>(section => ({
    id: section,
    label: EXERCISE_SETTINGS_SECTION_META[section].label,
    icon: EXERCISE_SETTINGS_SECTION_META[section].icon,
    content: { kind: 'sharedSettings', section },
  })),

  // Self-contained panels: own hook, service, query and states; no props.
  {
    id: 'chrome',
    label: 'Compliance chrome',
    icon: faShieldHalved,
    content: { kind: 'panel', panel: <ComplianceChromePanel /> },
  },
  {
    id: 'practice',
    label: 'Practice / sandbox',
    icon: faFlask,
    content: { kind: 'panel', panel: <PracticeModePanel /> },
  },
]

/**
 * The section shown on arrival. Typed as a SETTINGS section, so it can also seed
 * "the settings section to come back to".
 */
const DEFAULT_SECTION: ExerciseSettingsSectionId = 'identity'

/** True when `id` is one of the three views over the shared settings form. */
function isSettingsSection(id: ExerciseConfigSectionId): id is ExerciseSettingsSectionId {
  return EXERCISE_SETTINGS_SECTION_ORDER.some(section => section === id)
}

/**
 * The registry entry for `id`. Throws rather than returning `undefined`: the id
 * always comes from the registry, so a miss means the registry and the id union
 * have drifted — which should fail loudly, not render a nameless pane.
 */
function sectionById(id: ExerciseConfigSectionId): ExerciseConfigSection {
  const found = SECTIONS.find(section => section.id === id)
  if (found === undefined) throw new Error(`Unknown exercise-configuration section: ${id}`)
  return found
}

// ---------------------------------------------------------------------------
// Nav item
// ---------------------------------------------------------------------------

interface SectionNavItemProps {
  readonly section: ExerciseConfigSection
  readonly selected: boolean
  /** Marked "Needs attention" — a validation error is waiting in this section. */
  readonly hasError: boolean
  readonly onSelect: (id: ExerciseConfigSectionId) => void
}

/**
 * One row of the section nav.
 *
 * A real `<button>` (via MUI's unstyled `ButtonBase`) rather than a COBRA button
 * component: there is no `CobraNavItem`, and a `CobraPrimaryButton` per row
 * would read as five call-to-actions. Same precedent as the panels' raw MUI
 * `Checkbox`. Every colour below is a COBRA palette token, so it stays inside
 * the staff look.
 */
function SectionNavItem({ section, selected, hasError, onSelect }: SectionNavItemProps) {
  return (
    <ButtonBase
      type="button"
      onClick={() => onSelect(section.id)}
      aria-current={selected ? 'page' : undefined}
      data-testid={`exercise-config-nav-${section.id}`}
      sx={{
        width: '100%',
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        textAlign: 'left',
        gap: 1,
        padding: '8px 10px',
        borderRadius: 1,
        borderLeft: '3px solid',
        borderLeftColor: selected ? 'buttonPrimary.main' : 'transparent',
        bgcolor: selected ? 'grid.main' : 'transparent',
        color: 'text.primary',
        fontWeight: selected ? 700 : 400,
        '&:hover': { bgcolor: selected ? 'grid.main' : 'grid.light' },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'buttonPrimary.main',
          outlineOffset: '2px',
        },
      }}
    >
      <Box component="span" sx={{ mt: '2px', width: 18, flexShrink: 0 }}>
        <FontAwesomeIcon icon={section.icon} aria-hidden />
      </Box>
      <Box component="span">
        <Typography variant="body2" component="span" sx={{ display: 'block', fontWeight: 'inherit' }}>
          {section.label}
        </Typography>
        {hasError ? (
          // Icon + WORDS. The colour is decoration on top of both, never the
          // signal itself (NFR-001).
          <Typography
            variant="caption"
            component="span"
            data-testid={`exercise-config-nav-error-${section.id}`}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              color: 'notifications.errorText',
              fontWeight: 700,
            }}
          >
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
            Needs attention
          </Typography>
        ) : null}
      </Box>
    </ButtonBase>
  )
}

// ---------------------------------------------------------------------------
// Section shell
// ---------------------------------------------------------------------------

interface SectionShellProps {
  readonly active: boolean
  readonly children: ReactNode
}

/**
 * Keeps a section MOUNTED but out of sight — and out of the accessibility tree —
 * when it is not selected, so nothing a planner has typed is thrown away by a
 * click on the nav. `hidden` alone is enough for assistive tech and for
 * Testing Library's role queries; the explicit `display` guards against an
 * Emotion rule out-specifying the UA `[hidden]` stylesheet.
 */
function SectionShell({ active, children }: SectionShellProps) {
  return (
    <Box hidden={!active} sx={{ display: active ? 'block' : 'none' }}>
      {children}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/**
 * Work-area content for the planner's exercise-settings route: a page title, the
 * section nav, and the selected section. Mounted by `App.tsx`
 * (orchestrator-owned) inside the shared staff shell, a COBRA `ThemeProvider`
 * and a React Query `QueryClientProvider`.
 */
export function ExerciseSettingsPage() {
  const [activeId, setActiveId] = useState<ExerciseConfigSectionId>(DEFAULT_SECTION)
  const [settingsStatus, setSettingsStatus] = useState<ExerciseSettingsStatus>(
    CLEAN_EXERCISE_SETTINGS_STATUS,
  )

  // The settings section to come BACK to: the last one the planner looked at, so
  // a detour through compliance chrome returns them where they left off.
  const [lastSettingsSection, setLastSettingsSection] =
    useState<ExerciseSettingsSectionId>(DEFAULT_SECTION)

  const contentRef = useRef<HTMLDivElement>(null)
  // Focus moves only after a real selection — never on first render, which would
  // yank a screen reader away from the page heading.
  const focusOnNextRender = useRef(false)

  const selectSection = useCallback((id: ExerciseConfigSectionId) => {
    focusOnNextRender.current = true
    setActiveId(id)
    if (isSettingsSection(id)) setLastSettingsSection(id)
  }, [])

  useEffect(() => {
    if (!focusOnNextRender.current) return
    focusOnNextRender.current = false
    contentRef.current?.focus()
  }, [activeId])

  // Stable identity: the settings form reports its status through this on every
  // change, and an unstable callback would re-fire its effect every render.
  const handleSettingsStatus = useCallback((status: ExerciseSettingsStatus) => {
    setSettingsStatus(status)
  }, [])

  const activeSection = sectionById(activeId)
  const settingsActive = isSettingsSection(activeId)
  const unsavedAwayFromForm = settingsStatus.dirty && !settingsActive

  return (
    <Box
      component="main"
      data-testid="exercise-settings-page"
      sx={{
        // THE STICKY SHELL (see the module header). A fixed-height flex column
        // at `lg`+: the title block and the nav hold still and the content pane
        // owns the scroll. Below `lg` the page reverts to ordinary document
        // flow and scrolls as a whole, because pinning a wrapped nav row on a
        // narrow screen would eat the little height there is.
        height: { xs: 'auto', lg: '100%' },
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        // No second, outer scrollbar: at `lg`+ the ONE scrollport on this page
        // is the content pane below.
        overflow: { xs: 'visible', lg: 'hidden' },
        paddingTop: CobraStyles.Padding.MainWindow,
        paddingLeft: CobraStyles.Padding.MainWindow,
        paddingRight: CobraStyles.Padding.MainWindow,
        // The pane supplies its own bottom padding INSIDE its scrollport, so
        // the last field can reach the bottom edge instead of stopping short.
        paddingBottom: { xs: CobraStyles.Padding.MainWindow, lg: 0 },
      }}
    >
      {/* PINNED: the page title and what this page is. `flexShrink: 0` keeps it
          at its natural height however tall the section below is. */}
      <Box sx={{ flexShrink: 0 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <FontAwesomeIcon icon={faGears} aria-hidden />
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            Exercise configuration
          </Typography>
        </Stack>

        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 860 }}>
          Everything that configures this exercise. Changes apply to the exercise your console is
          currently working in — the server decides which one that is, so nothing here can reach
          another exercise.
        </Typography>

        <Divider sx={{ mt: 2 }} />
      </Box>

      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        sx={{
          gap: CobraStyles.Spacing.DashboardWidgets,
          mt: 2,
          alignItems: 'stretch',
          // The row takes the height the title block left over, and `minHeight:
          // 0` is what lets its children actually scroll instead of stretching
          // the page (a flex item's default `min-height: auto` refuses to
          // shrink below its content).
          flex: { lg: '1 1 auto' },
          minHeight: 0,
        }}
      >
        <Box
          component="nav"
          aria-label="Exercise configuration sections"
          data-testid="exercise-config-nav"
          sx={{
            width: { xs: '100%', lg: 260 },
            flexShrink: 0,
            // PINNED, not sticky: the nav is a flex sibling of the pane inside
            // a row that does not scroll, so it simply stays where it is. It
            // takes its own scrollbar only in the pathological case of a nav
            // taller than the work area (many sections on a short screen) —
            // never the page's.
            minHeight: 0,
            overflowY: { xs: 'visible', lg: 'auto' },
            paddingBottom: { lg: CobraStyles.Padding.MainWindow },
            // A non-visible `overflow` CLIPS ink overflow, and a nav item's
            // focus ring is ink overflow: `outline` 2px at `outlineOffset` 2px
            // needs 4px of room outside the item or the ring is shaved off
            // (NFR-001 wants it visible). The negative margin gives that room
            // back without moving the nav off the page's own left inset.
            paddingLeft: '4px',
            paddingRight: '4px',
            marginLeft: { lg: '-4px' },
          }}
        >
          <Box
            component="ul"
            sx={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: { xs: 'row', lg: 'column' },
              flexWrap: 'wrap',
              gap: 0.5,
            }}
          >
            {SECTIONS.map(section => (
              <Box
                component="li"
                key={section.id}
                sx={{ width: { xs: 'auto', lg: '100%' }, flex: { xs: '1 1 180px', lg: '0 0 auto' } }}
              >
                <SectionNavItem
                  section={section}
                  selected={section.id === activeId}
                  hasError={
                    isSettingsSection(section.id)
                    && settingsStatus.sectionsWithErrors.includes(section.id)
                  }
                  onSelect={selectSection}
                />
              </Box>
            ))}
          </Box>

          {/*
            UNSAVED-CHANGES NOTICE. Nothing is discarded by moving around this
            page — the settings form stays mounted — but a planner must be told
            that edits are outstanding, and told where to go to deal with them.
            `role="status"` announces it politely; the icon + words carry the
            state, the colour only decorates it.
          */}
          {settingsStatus.dirty ? (
            <Stack
              role="status"
              data-testid="exercise-settings-unsaved-notice"
              sx={{
                mt: 1.5,
                gap: 0.5,
                padding: '10px 12px',
                border: '1px solid',
                borderColor: 'notifications.warningText',
                borderRadius: 1,
                color: 'notifications.warningText',
              }}
            >
              <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
                <Box component="span" sx={{ mt: '2px' }}>
                  <FontAwesomeIcon icon={faPenToSquare} aria-hidden />
                </Box>
                <Typography variant="body2">
                  {unsavedAwayFromForm
                    ? 'Unsaved exercise settings. Nothing was discarded — your edits are still '
                      + `waiting in ${EXERCISE_SETTINGS_SECTION_META[lastSettingsSection].label}.`
                    : 'Unsaved exercise settings. Use Save settings or Revert changes below — '
                      + 'they cover all three settings sections at once.'}
                </Typography>
              </Stack>
              {unsavedAwayFromForm ? (
                <CobraLinkButton
                  type="button"
                  onClick={() => selectSection(lastSettingsSection)}
                  startIcon={<FontAwesomeIcon icon={faArrowLeft} />}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Back to {EXERCISE_SETTINGS_SECTION_META[lastSettingsSection].label}
                </CobraLinkButton>
              ) : null}
            </Stack>
          ) : null}
        </Box>

        <Box
          ref={contentRef}
          tabIndex={-1}
          role="region"
          aria-label={`${activeSection.label} settings`}
          data-testid="exercise-config-content"
          sx={{
            flexGrow: 1,
            minWidth: 0,
            // THE ONE SCROLLPORT on this page at `lg`+. Whatever a section
            // cannot fit scrolls HERE, under a title and a nav that hold still.
            minHeight: 0,
            overflowY: { xs: 'visible', lg: 'auto' },
            // No bottom padding of its own: each panel already carries
            // `CobraStyles.Padding.MainWindow`, and the pinned save bar is
            // sized to swallow exactly that, so the bar ends flush with the
            // bottom of the scrollport instead of floating above a gap.
            // Room for a focus ring on the leftmost controls, which an
            // `overflow` scrollport would otherwise clip.
            paddingLeft: '2px',
            // KEYBOARD SAFETY (NFR-001). The panel's save bar is pinned to the
            // bottom of this scrollport, so a field tabbed to near the end of a
            // form could be scrolled to underneath it. `scroll-padding-bottom`
            // is what the browser keeps clear when it scrolls a focused control
            // into view; the constant lives with the bar so the two cannot
            // drift apart.
            scrollPaddingBottom: `${PANEL_SAVE_BAR_SCROLL_PADDING_PX}px`,
            scrollPaddingTop: '8px',
            '&:focus-visible': { outline: 'none' },
          }}
        >
          {/*
            ONE settings panel for sections 1–3 — see the module header. It is
            rendered whichever section is active (hidden when it is not one of
            the three) so in-progress edits survive a trip to another section.
          */}
          <SectionShell active={settingsActive}>
            <ExerciseSettingsPanel
              section={lastSettingsSection}
              onStatusChange={handleSettingsStatus}
              onRequestSection={selectSection}
            />
          </SectionShell>

          {/* Self-contained panels: one entry each, mounted from the registry. */}
          {SECTIONS.map(section =>
            section.content.kind === 'panel' ? (
              <SectionShell key={section.id} active={section.id === activeId}>
                {section.content.panel}
              </SectionShell>
            ) : null,
          )}
        </Box>
      </Stack>
    </Box>
  )
}

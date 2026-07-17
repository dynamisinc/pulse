/**
 * features/staffShell/components/PortalStub.tsx
 * ---------------------------------------------------------------------------
 * The PARTICIPANT-WORLD content "Preview as participant" (feature:
 * staff-shell, story 04, COR-041) stages inside the staff frame — see
 * `PreviewAsParticipant.tsx`'s module header for the staging contract this
 * component is mounted under.
 *
 * This is the "small PORTAL-STUB participant page" the story calls for: there
 * is no real participant channel on `main` yet (participant-shell's own
 * channels land separately), so this is a plain, self-contained local-news-
 * portal MOCK proving the preview stage correctly hosts a PARTICIPANT-WORLD
 * render — not a channel implementation, and not a thing any other feature
 * should import.
 *
 * ## CRITICAL two-worlds rule (SHELL-CONTRACT.md §4 hard gate; D7-009)
 * This component imports NO COBRA (`@/theme/*`, `staffShellTokens`) and NO
 * MUI at all — every visual choice is a plain, brandable "Fairhaven Today"
 * masthead skin (Figtree-style stack, warm ink-on-white), built from bare DOM
 * elements + inline `style` objects, so it structurally cannot pick up the
 * staff frame's Cadence chrome. `previewStubTwoWorlds.test.ts` (this story)
 * enforces this mechanically by scanning this file's real source text — the
 * general `twoWorldsSeparation.test.ts` (story 05) only scans the
 * social/portal/news/press/weather/participant-shell feature roots and does
 * not reach this file, so this story ships its own narrow copy of that gate.
 * FontAwesome icons only (CLAUDE.md) — the mock alert severity is paired with
 * an icon + text label, never color alone, even in a stub (NFR-001).
 *
 * ## READ-ONLY (AC4, COR-015)
 * Every element here is inert: plain `<div>` / `<p>` / `<span>` / `<h1>` —
 * no `<button>`, `<input>`, `<textarea>`, `<a href>`, or `onClick` anywhere.
 * There is no compose box and no like/reply affordance to merely disable —
 * they are simply never rendered (COR-015: absent, not disabled).
 *
 * Free text here (kicker/headline/dek/alert message) is all LITERAL STRING
 * CONSTANTS from `../previewContext`'s mock moment model, rendered as
 * ordinary React text children (auto-escaped) — never
 * `dangerouslySetInnerHTML` (NFR-004).
 *
 * Reads its mount props via `useShellContext()` — the REAL participant-shell
 * contract (`@/features/participant-shell/mountContract`) — exactly as a real
 * channel would, so `variant` is provably `'preview'` end-to-end (AC1/AC4),
 * not asserted against a prop this component invented itself. Reads
 * `timeZone` via `useExerciseContext()` (the same Wave-0 seam
 * `participant-shell/ShellLayout.tsx` itself calls) purely to format the
 * mount-supplied `scenarioNow` as a dateline — never wall-clock.
 *
 * World: participant. No COBRA, no MUI, no enterprise look.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faCircleInfo, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { formatScenarioTime } from '@/core/clock'
import { useShellContext } from '@/features/participant-shell/mountContract'
import type { PreviewAlertState, PreviewMomentConfig } from '../previewContext'

export interface PortalStubProps {
  /** The selected preview moment's mock content + alert state (`../previewContext`). */
  momentConfig: PreviewMomentConfig
}

/** Severity → icon. Deliberately omits `none` — no banner renders for it. */
const SEVERITY_ICON: Partial<Record<PreviewAlertState, IconDefinition>> = {
  info: faCircleInfo,
  advisory: faTriangleExclamation,
  emergency: faTriangleExclamation,
}

/** Severity → banner colors — paired with the icon + text label above, never color-only. */
const SEVERITY_STYLE: Partial<Record<PreviewAlertState, {
  background: string
  color: string
  border: string
}>> = {
  info: { background: '#edf3f9', color: '#3d6a96', border: '#b7cfe6' },
  advisory: { background: '#fff3dd', color: '#6b4300', border: '#e3b25f' },
  emergency: { background: '#b3261e', color: '#ffffff', border: '#8f150c' },
}

export function PortalStub({ momentConfig }: PortalStubProps) {
  const { variant, scenarioNow } = useShellContext()
  const { timeZone } = useExerciseContext()
  const dateline = formatScenarioTime(scenarioNow, timeZone, { format: 'dateline' })

  const severity = momentConfig.alertState
  const severityIcon = SEVERITY_ICON[severity]
  const severityStyle = SEVERITY_STYLE[severity]

  return (
    <div
      data-testid="portal-stub"
      data-shell-variant={variant}
      style={{
        fontFamily: 'Figtree, ui-sans-serif, system-ui, sans-serif',
        color: '#0e1518',
        background: '#ffffff',
        width: '100%',
      }}
    >
      {severityStyle && severityIcon && (
        <div
          data-testid="portal-stub-alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            fontSize: 12.5,
            background: severityStyle.background,
            color: severityStyle.color,
            borderBottom: `1px solid ${severityStyle.border}`,
          }}
        >
          <FontAwesomeIcon icon={severityIcon} />
          <span style={{ fontWeight: 800, fontSize: 9.5, letterSpacing: '0.1em' }}>
            {severity.toUpperCase()}
          </span>
          <span>{momentConfig.alertMessage}</span>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '0 10px',
          height: 32,
          background: '#fbfcfd',
          borderBottom: '1px solid #e3e7ea',
          fontSize: 11,
          fontWeight: 600,
          color: '#5a6a76',
        }}
      >
        <span
          style={{
            color: '#101b23',
            fontWeight: 800,
            boxShadow: 'inset 0 -2px 0 #101b23',
            padding: '4px 8px',
          }}
        >
          Fairhaven Today
        </span>
        <span style={{ padding: '4px 8px' }}>Newsline 7</span>
        <span style={{ padding: '4px 8px' }}>Pulse</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#8a97a1' }}>{dateline}</span>
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div style={{ color: '#c8102e', fontWeight: 800, fontSize: 9, letterSpacing: '0.12em' }}>
          {momentConfig.kicker}
        </div>
        <h1 style={{ font: '800 16px/1.3 Figtree, sans-serif', margin: '4px 0 6px' }}>
          {momentConfig.headline}
        </h1>
        <p style={{ font: '400 11.5px/1.5 Figtree, sans-serif', color: '#46545f', margin: 0 }}>
          {momentConfig.dek}
        </p>
      </div>
    </div>
  )
}

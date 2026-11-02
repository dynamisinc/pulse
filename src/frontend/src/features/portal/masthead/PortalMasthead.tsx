/**
 * features/portal/masthead/PortalMasthead.tsx
 * ---------------------------------------------------------------------------
 * The portal masthead (exercise-portal story 06, #771; PRT-002, COR-053,
 * COR-066, NFR-001, NFR-008; D2-001/D2-008). Broadcast direction:
 *
 *   +-------------------------------------------------------------+
 *   | [logo] Atlanta TODAY                          [alertsEntry] |  station-blue band
 *   | Your city, every hour            OCT 29, 2026 · 2:32 PM EDT |
 *   +=============================================================+  red accent rule
 *   | (hero, when given)                              [EXERCISE]  |  watermark slot
 *   +-------------------------------------------------------------+
 *
 *  - NAME: `masthead.name`, resolved by the server (`PortalName`, else
 *    `"{CityName} Today"`, else `"Local Today"`). Never the exercise name: this
 *    component does not read it. A blank name renders "Local Today" (Q-E3-1).
 *    It is the page's one `h1` and plain text, never a link out of the portal.
 *  - LOGO: optional; an image with its own `alt`, through `resolveSafeMediaUrl`.
 *    Without one (an unsafe one, or one that fails to load) the name stands alone.
 *  - DATELINE: the shell's `scenarioNow` (the single "now", COR-053) through
 *    F14's `ScenarioDateline` in the exercise zone, so it advances with the
 *    shell's ticker and never refetches. Never labelled "scenario time".
 *  - SLOTS: `alertsEntry` (filled by story 14) sits on the name line; the
 *    masthead draws no alert bar of its own (the shell hosts the one bar).
 *    `hero`, when given, gets a positioned box with F14's `WatermarkSlot`
 *    (NFR-008).
 *  - LANDMARK: a `<header>` is the page `banner` only outside `main` / `article`
 *    / `section`, so the portal channel (story 17) mounts it ABOVE its `main`, not
 *    inside it. (An explicit `role="banner"` inside `main` would fail axe's
 *    landmark-banner-is-top-level, so the element carries no role of its own.)
 *  - MOBILE: at 320 px the band is the name line (truncating, never scrolling
 *    sideways) plus the dateline; the tagline drops below 480 px.
 *
 * Must render inside `PortalSkinScope` (it reads the skin through `useSkin`).
 * World: participant. CSS Module over the skin variables; no COBRA, no MUI.
 */

import { useState, type CSSProperties, type ReactNode } from 'react'
import { ScenarioDateline, WatermarkSlot, useSkin } from '@/features/channels'
import { resolveSafeMediaUrl } from '@/core/media/player'
import { useShellContext } from '@/features/participant-shell/mountContract'
import type { PortalMastheadDto } from '../contract'
import { PORTAL_MASTHEAD_DATELINE_FORMAT } from './mastheadDateline'
import { mastheadTodayColor, splitMastheadName } from './mastheadTone'
import styles from './PortalMasthead.module.css'

/** The neutral name when a portal has none (Q-E3-1). */
export const PORTAL_FALLBACK_NAME = 'Local Today'

export interface PortalMastheadProps {
  readonly masthead: PortalMastheadDto
  /** The alerts entry (story 14), placed on the name line. */
  readonly alertsEntry?: ReactNode
  /** A hero area below the band; it gets the EXERCISE watermark slot. */
  readonly hero?: ReactNode
}

export function PortalMasthead({ masthead, alertsEntry, hero }: PortalMastheadProps) {
  const { tokens } = useSkin()
  const { scenarioNow } = useShellContext()
  const name = masthead.name.trim() === '' ? PORTAL_FALLBACK_NAME : masthead.name.trim()
  const { lead, today } = splitMastheadName(name)
  const tagline = masthead.tagline?.trim() ?? ''
  const logo = masthead.logo
  const logoSrc = logo && logo.kind === 'image' ? resolveSafeMediaUrl(logo.url) : undefined
  // A logo that fails to load is dropped, not shown as broken-image alt text on the band.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const bandStyle = { '--portal-masthead-today': mastheadTodayColor(tokens) } as CSSProperties

  return (
    <header className={styles.masthead} data-testid="portal-masthead">
      <div className={styles.band} style={bandStyle}>
        <div className={styles.nameLine}>
          <div className={styles.brand}>
            {logo && logoSrc && logoSrc !== failedSrc && (
              <img
                className={styles.logo}
                src={logoSrc}
                alt={logo.alt}
                data-testid="portal-masthead-logo"
                onError={() => setFailedSrc(logoSrc)}
              />
            )}
            <h1 className={styles.name}>
              {lead}
              {today !== '' && <span className={styles.today}>{today}</span>}
            </h1>
          </div>
          {alertsEntry != null && alertsEntry !== false && (
            <div className={styles.alertsEntry} data-testid="portal-masthead-alerts-entry">
              {alertsEntry}
            </div>
          )}
        </div>
        <div className={styles.metaLine}>
          {tagline !== '' && (
            <p className={styles.tagline} data-testid="portal-masthead-tagline">{tagline}</p>
          )}
          <ScenarioDateline
            className={styles.dateline}
            scenarioTime={scenarioNow.toISOString()}
            format={PORTAL_MASTHEAD_DATELINE_FORMAT}
          />
        </div>
      </div>
      {hero != null && hero !== false && (
        <div className={styles.hero} data-testid="portal-masthead-hero">
          {hero}
          <WatermarkSlot />
        </div>
      )}
    </header>
  )
}

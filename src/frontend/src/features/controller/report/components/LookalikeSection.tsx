/**
 * features/controller/report/components/LookalikeSection.tsx
 * ---------------------------------------------------------------------------
 * "Verified vs. lookalike" (story 29, SOC-052): each verified account beside its unverified
 * lookalike, with shown likes and reposts as bars on one shared scale and the numbers in text.
 * Omitted entirely by the caller when the report has no pairs. Verification is labeled in words
 * (VERIFIED / UNVERIFIED), never by color alone.
 *
 * Story 32 (DF-48): each row states its posts in the window, so engagement reads against
 * activity; the scale never drops below a range of 10, so 1 against 0 is a short bar, not a
 * full one; and the verdict sentence (the two totals) prints only for a pair the server marked
 * `outdrew`.
 *
 * Story 33 (DF-49): each pair says in text how it was found, "Named by a controller" (the
 * lookalike's Imitates setting) or "Handle match" (handle prefix); a named pair need not share
 * a prefix. `named` is optional at runtime (older API), read as a handle match.
 */

import type { ReportAccount, ReportLookalikePair } from '../types/report'
import styles from './report.module.css'

/** The widest bar, as a share of the row. */
const MAX_BAR_PERCENT = 60

/** The smallest value the widest bar stands for (DF-48). */
export const MIN_BAR_RANGE = 10

export interface LookalikeSectionProps {
  readonly pairs: readonly ReportLookalikePair[]
}

function VerificationChip({ verified }: { readonly verified: boolean }) {
  return verified
    ? <span className={styles.ver}>VERIFIED</span>
    : <span className={styles.unver}>UNVERIFIED</span>
}

interface AccountRowProps {
  readonly account: ReportAccount
  readonly scale: number
}

function AccountRow({ account, scale }: AccountRowProps) {
  return (
    <div className={styles.vsrow}>
      <div className={styles.vsname}>
        <strong>{account.displayName}</strong>
        <span>
          {account.handle} · <VerificationChip verified={account.verified} />
          {postsText(account.posts)}
        </span>
      </div>
      <div className={styles.vsbars}>
        <div className={styles.vsbar}>
          <i className={styles.lk} style={{ width: `${account.likes * scale}%` }} aria-hidden="true" />
          {account.likes.toLocaleString('en-US')} {account.likes === 1 ? 'like' : 'likes'}
        </div>
        <div className={styles.vsbar}>
          <i className={styles.rp} style={{ width: `${account.reposts * scale}%` }} aria-hidden="true" />
          {account.reposts.toLocaleString('en-US')} {account.reposts === 1 ? 'repost' : 'reposts'}
        </div>
      </div>
    </div>
  )
}

/**
 * One factual sentence when the server judged the lookalike out-drew the real account (DF-48).
 * It states the likes + reposts totals the rule compares, never a single measure, so a 1-vs-0
 * like is never singled out.
 */
function comparison({ verified, lookalike, outdrew }: ReportLookalikePair): string | null {
  if (!outdrew) return null
  const total = (account: ReportAccount) => (account.likes + account.reposts).toLocaleString('en-US')
  return `${lookalike.handle} drew more engagement than ${verified.handle}: `
    + `${total(lookalike)} likes and reposts against ${total(verified)}.`
}

/** How the pair was found, in words (NFR-001). An older server sends no flag: a handle match. */
function basisText(named: boolean | undefined): string {
  return named === true ? 'Named by a controller' : 'Handle match'
}

/** " · 3 posts"; empty when an older server sent no count. */
function postsText(posts: number | undefined): string {
  if (posts === undefined) return ''
  return ` · ${posts.toLocaleString('en-US')} ${posts === 1 ? 'post' : 'posts'}`
}

export function LookalikeSection({ pairs }: LookalikeSectionProps) {
  const peak = Math.max(
    MIN_BAR_RANGE,
    ...pairs.flatMap(p => [
      p.verified.likes,
      p.verified.reposts,
      p.lookalike.likes,
      p.lookalike.reposts,
    ]),
  )
  const scale = MAX_BAR_PERCENT / peak
  const notes = pairs.map(comparison).filter((note): note is string => note !== null)
  return (
    <section className={styles.section} aria-labelledby="report-lookalike-h">
      <h2 id="report-lookalike-h" className={styles.heading}>
        Verified vs. lookalike <small>Engagement as participants saw it</small>
      </h2>
      <div className={styles.vs}>
        {pairs.map(pair => (
          <div key={`${pair.verified.handle}-${pair.lookalike.handle}`} className={styles.vs}>
            <AccountRow account={pair.verified} scale={scale} />
            <AccountRow account={pair.lookalike} scale={scale} />
            <p className={styles.method} data-testid="lookalike-basis">
              {basisText(pair.named)}
            </p>
          </div>
        ))}
      </div>
      {notes.length > 0 && <p className={styles.method}>{notes.join(' ')}</p>}
    </section>
  )
}

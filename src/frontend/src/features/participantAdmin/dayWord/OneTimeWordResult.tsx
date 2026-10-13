/**
 * features/participantAdmin/dayWord/OneTimeWordResult.tsx
 * ---------------------------------------------------------------------------
 * The ONE place the plaintext day word is ever rendered (easy-login story 11).
 *
 * The server stores only a PBKDF2 hash of the word (EL-9), so the word can be
 * shown to staff exactly once - in the response to the `PUT` that set it. This
 * component is that one view. `DayWordPanel` mounts it with the result and
 * UNMOUNTS it when staff press Done (or the panel unmounts, or the active
 * exercise changes), which is what clears the word from the screen and from
 * component state. Nothing in here persists it: no storage, no toast, no log, no
 * document title, no URL, no query cache.
 *
 * WHAT STAFF GET
 *  - the word in a clearly framed block, with the standing notice "This is the
 *    only time Pulse shows this word";
 *  - a Copy button (the clipboard call runs inside the click handler, which is
 *    what Safari requires, and uses data already in memory - no await first; it goes
 *    through the shared `copyToClipboard`, which falls back to `execCommand('copy')`
 *    where the Clipboard API is missing or refused);
 *  - a Show large toggle that renders the word in very large, high-contrast type
 *    (black on white, 21:1) so it can be read out across a room or projected.
 *    It is still the STAFF look - COBRA buttons, a plain bordered block - and
 *    deliberately not a participant skin.
 *
 * ACCESSIBILITY (NFR-001)
 *  - On mount, focus moves to this view's heading so keyboard and screen-reader
 *    users land on the result. The result is NOT inside an `aria-live` region:
 *    the panel's separate live region announces "Word set ..." WITHOUT the word
 *    (the word is never read out unprompted; a user who wants it navigates to
 *    it). The word block is `translate="no"` so a browser translator cannot
 *    mangle it.
 *  - Show large is a real toggle button (`aria-pressed`), and its on/off state
 *    is shown by icon and by the block itself, not by colour.
 *  - A successful copy is announced (without the word) via `onAnnounce` and shown
 *    as text. A failed copy is shown, and announced, ONCE - by its own
 *    `role="alert"` block, not also through the live region - and tells staff to
 *    select the word instead.
 *
 * CONTENT SECURITY (NFR-004): the word is rendered as a React text node.
 *
 * World: STAFF (COBRA).
 */

import { useEffect, useId, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCheck,
  faCircleInfo,
  faCompress,
  faCopy,
  faExpand,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import {
  CobraLinkButton,
  CobraPrimaryButton,
  CobraSecondaryButton,
} from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'
import { copyToClipboard } from '../shared/copyToClipboard'
import { formatDateLabel, formatInstant } from './dayWordDates'
import type { DayWordSetResultDto } from './types'

export interface OneTimeWordResultProps {
  result: DayWordSetResultDto
  /** The exercise IANA zone, for "valid until". */
  timeZone: string
  /** Staff pressed Done: the parent drops the result, which unmounts this view. */
  onDone: () => void
  /** Sends a polite screen-reader message. Must never be given the word. */
  onAnnounce: (message: string) => void
}

/** The standing notice, verbatim from the story's acceptance criteria. */
export const ONLY_TIME_NOTICE = 'This is the only time Pulse shows this word'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

/**
 * Font size for the big view, in container-query width units so a short word fills
 * the block and a long one shrinks to fit (a 64-character word is still allowed to
 * wrap). Monospace glyphs are ~0.6em wide.
 */
function largeFontSize(length: number): string {
  const cqw = Math.max(2.4, Math.min(20, 150 / Math.max(length, 1)))
  return `clamp(2rem, ${cqw.toFixed(2)}cqw, 11rem)`
}

type CopyState = 'idle' | 'copied' | 'failed'

export function OneTimeWordResult({
  result,
  timeZone,
  onDone,
  onAnnounce,
}: OneTimeWordResultProps) {
  const [large, setLarge] = useState(false)
  const [copy, setCopy] = useState<CopyState>('idle')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const headingId = useId()

  // Land the user on the result as soon as it appears.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const handleCopy = () => {
    // Called synchronously inside the click so Safari allows the clipboard write: the
    // shared helper starts the write on its first line (no await before it) and, where the
    // async Clipboard API is missing or refused, falls back to `execCommand('copy')`
    // (Gate-2 S-5). A failure is reported ONCE, by the `role="alert"` block below; it is
    // not also sent to the live region, which would have a screen reader say it twice.
    void copyToClipboard(result.word).then(copied => {
      if (copied) {
        setCopy('copied')
        onAnnounce('Word copied to the clipboard.')
      } else {
        setCopy('failed')
      }
    })
  }

  const dateLabel = formatDateLabel(result.date)

  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      data-testid="day-word-result"
      sx={{
        border: '2px solid',
        borderColor: 'text.primary',
        borderRadius: 1,
        bgcolor: 'background.paper',
        padding: CobraStyles.Padding.DialogContent,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      <Typography
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        variant="subtitle1"
        component="h3"
        sx={{ fontWeight: 700, outline: 'none' }}
      >
        {result.replaced ? 'New word set' : 'Word set'} for {dateLabel}
      </Typography>

      <Box
        role="note"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: 'notifications.warning',
          color: 'text.primary',
          borderRadius: 1,
          padding: '6px 10px',
          fontWeight: 700,
        }}
      >
        <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
        <span>{ONLY_TIME_NOTICE}. Copy it or read it out now.</span>
      </Box>

      <Box
        data-testid="day-word-frame"
        sx={{
          containerType: 'inline-size',
          border: large ? '4px solid #000000' : '2px solid #000000',
          borderRadius: 1,
          bgcolor: '#ffffff',
          color: '#000000',
          padding: large ? '24px 16px' : '10px 14px',
          textAlign: large ? 'center' : 'left',
        }}
      >
        <Typography
          component="p"
          translate="no"
          data-testid="day-word-value"
          data-large={large ? 'true' : 'false'}
          sx={{
            m: 0,
            fontFamily: MONO,
            fontWeight: 700,
            letterSpacing: large ? '0.04em' : '0.02em',
            fontSize: large ? largeFontSize(result.word.length) : '1.5rem',
            lineHeight: 1.15,
            color: '#000000',
            overflowWrap: 'anywhere',
            // One click selects the whole word, for a manual copy.
            userSelect: 'all',
          }}
        >
          {result.word}
        </Typography>
      </Box>

      <Typography variant="body2" component="p" sx={{ m: 0 }}>
        {result.generated ? 'Generated by Pulse.' : 'The word you typed.'} Valid until{' '}
        {formatInstant(result.validUntil, timeZone)}.
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
        <CobraPrimaryButton
          onClick={handleCopy}
          startIcon={<FontAwesomeIcon icon={copy === 'copied' ? faCheck : faCopy} />}
        >
          Copy
        </CobraPrimaryButton>
        <CobraSecondaryButton
          aria-pressed={large}
          onClick={() => setLarge(value => !value)}
          startIcon={<FontAwesomeIcon icon={large ? faCompress : faExpand} />}
        >
          Show large
        </CobraSecondaryButton>
        <CobraLinkButton onClick={onDone}>Done</CobraLinkButton>
        {copy === 'copied' ? (
          <Typography component="span" variant="body2" data-testid="day-word-copied" aria-hidden>
            Copied
          </Typography>
        ) : null}
      </Box>

      {copy === 'failed' ? (
        <Box
          role="alert"
          sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, color: 'error.main' }}
        >
          <FontAwesomeIcon icon={faCircleInfo} aria-hidden />
          <Typography variant="body2">
            Could not copy automatically. Click the word to select it, then copy it.
          </Typography>
        </Box>
      ) : null}
    </Box>
  )
}

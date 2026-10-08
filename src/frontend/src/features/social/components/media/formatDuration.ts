/**
 * features/social/components/media/formatDuration.ts
 * ---------------------------------------------------------------------------
 * Formats a media LENGTH for the video duration badge (demo-polish F2):
 * `24 -> "0:24"`, `65 -> "1:05"`, `3725 -> "1:02:05"`. It is a length of
 * footage, NOT a clock reading, so COR-053 (scenario time only) is unaffected.
 *
 * Rounds to the nearest second; non-finite or negative input renders "0:00".
 */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00'
  const whole = Math.round(totalSeconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const seconds = whole % 60
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
  return `${minutes}:${ss}`
}

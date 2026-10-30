/**
 * features/portal/contract/forbiddenKeys.ts
 * ---------------------------------------------------------------------------
 * The XC-002 key check the portal contract tests (and story 23's conformance
 * kit) share. FAIL-SAFE: a key is forbidden when its lowercase form CONTAINS
 * any pattern from `portalWireContract.json`
 * (`participantForbiddenKeyPatterns`), after removing the known-harmless
 * words in `participantAllowedWords` (`hashtag` holds "hash", `conversation`
 * holds "version"). So `tokenHash`, `hashedPassword`, `accesstoken` and
 * `lastSeenAt` are forbidden while `hashtags` is not, and a new false positive
 * is fixed by allowlisting a word, never by loosening the match. Mirrors
 * `IsForbiddenMemberName` in `PortalContractParityTests.cs`.
 *
 * World: both (pure logic). No React, no MUI.
 */

/** Whether `key` holds a forbidden pattern once the allowed words are removed. */
export function isForbiddenKey(
  key: string,
  patterns: readonly string[],
  allowedWords: readonly string[],
): boolean {
  const normalized = allowedWords.reduce(
    (rest, word) => rest.split(word).join('|'),
    key.toLowerCase().replace(/[_\s-]/g, ''),
  )
  return patterns.some(p => normalized.includes(p))
}

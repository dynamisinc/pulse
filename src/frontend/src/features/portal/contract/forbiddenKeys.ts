/**
 * features/portal/contract/forbiddenKeys.ts
 * ---------------------------------------------------------------------------
 * The XC-002 key check the portal contract tests (and story 23's conformance
 * kit) share. A key is forbidden when a run of its camelCase / snake_case
 * WORDS spells a pattern from `portalWireContract.json`
 * (`participantForbiddenKeyPatterns`), optionally pluralised: `tokenHash`,
 * `actingHumanId`, `lastSeenAt` and `accessTokens` are forbidden, while
 * `hashtags` is not (a plain substring match would flag it). Mirrors
 * `IsForbiddenMemberName` in `PortalContractParityTests.cs`.
 *
 * World: both (pure logic). No React, no MUI.
 */

/** Splits a key into lowercase words at camelCase humps, `_`, `-` and spaces. */
export function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase())
}

/** Whether `key` contains a forbidden pattern as a run of whole words. */
export function isForbiddenKey(key: string, patterns: readonly string[]): boolean {
  const words = keyWords(key)
  for (let start = 0; start < words.length; start++) {
    let run = ''
    for (let end = start; end < words.length; end++) {
      run += words[end]
      if (patterns.some(p => run === p || run === `${p}s`)) return true
    }
  }
  return false
}

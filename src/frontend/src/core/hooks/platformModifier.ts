/**
 * core/hooks/platformModifier.ts
 * ---------------------------------------------------------------------------
 * PURE platform detection for keyboard-shortcut HINTS (mobile-tablet story 14, D5-024,
 * TABLET-AMENDMENT section 4). No React, no DOM access of its own: every function takes the
 * `navigator`-shaped value, so it is unit-tested with plain objects (Mac, iPadOS, Windows,
 * Linux) and the hook (`usePlatformModifier`) just passes the real `navigator`.
 *
 * WHAT IT DECIDES. Which modifier key a hint should name: the command key (the symbol
 * `⌘`) on Apple platforms, `Ctrl` everywhere else. A hint shows ONE keycap, never "⌘K / Ctrl+K".
 * It does NOT change behaviour: the console's key handlers accept `metaKey || ctrlKey` on every
 * platform, so a Windows keyboard on a Mac still works. This is label-only.
 *
 * THE iPadOS CASE. Since iPadOS 13, Safari reports itself as a Mac by default:
 * `navigator.platform === 'MacIntel'` and a desktop user agent. The documented tell is touch
 * support: `maxTouchPoints > 1` on a "Mac" means an iPad (a real Mac reports 0). Both are Apple
 * platforms and both use Command, so the label is the same; {@link isIpadOs} is exported so the
 * distinction is explicit and tested rather than implied by a `/Mac/` match.
 *
 * Detection order: `navigator.userAgentData.platform` (Chromium, may be absent), then the
 * legacy `navigator.platform` (deprecated but still the only signal Safari gives), then the iPadOS
 * rule. Anything unknown falls back to Ctrl.
 */

/** The slice of `Navigator` this module reads (a plain object satisfies it in tests). */
export interface PlatformNavigator {
  readonly platform?: string
  readonly maxTouchPoints?: number
  readonly userAgentData?: { readonly platform?: string }
}

/** The command-key glyph used on Apple platforms. */
export const APPLE_MODIFIER_LABEL = '⌘'
/** The control-key name used everywhere else. */
export const OTHER_MODIFIER_LABEL = 'Ctrl'

const APPLE_PLATFORM = /^(Mac|iPhone|iPad|iPod)/i

/** A `MacIntel` that reports more than one touch point is an iPad running iPadOS. */
export function isIpadOs(nav: PlatformNavigator): boolean {
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1
}

/** True on macOS, iOS and iPadOS (including the "desktop-class" iPad that reports MacIntel). */
export function isApplePlatform(nav: PlatformNavigator = defaultNavigator()): boolean {
  const hinted = nav.userAgentData?.platform
  if (hinted !== undefined && hinted !== '') return /^(macOS|iOS)$/i.test(hinted)
  const platform = nav.platform ?? ''
  return APPLE_PLATFORM.test(platform) || isIpadOs(nav)
}

/** `⌘` on Apple platforms, `Ctrl` elsewhere. */
export function platformModifierLabel(nav: PlatformNavigator = defaultNavigator()): string {
  return isApplePlatform(nav) ? APPLE_MODIFIER_LABEL : OTHER_MODIFIER_LABEL
}

/**
 * One keycap's text for a modifier chord: `⌘K` on Apple, `Ctrl+K` elsewhere (the symbol hugs the
 * key; the word needs a plus). `key` is shown as given ("K", "Enter").
 */
export function platformChordLabel(
  key: string,
  nav: PlatformNavigator = defaultNavigator(),
): string {
  return isApplePlatform(nav) ? `${APPLE_MODIFIER_LABEL}${key}` : `${OTHER_MODIFIER_LABEL}+${key}`
}

function defaultNavigator(): PlatformNavigator {
  return typeof navigator === 'undefined' ? {} : (navigator as PlatformNavigator)
}

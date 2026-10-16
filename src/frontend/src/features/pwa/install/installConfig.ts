/**
 * features/pwa/install/installConfig.ts - install-prompt feature switches (story 11).
 *
 * IOS_INSTALL_PROMPT_ENABLED: set to `false` to disable ONLY the iOS "Share -> Add to Home
 * Screen" sheet (the Android `beforeinstallprompt` banner is unaffected). Reason it may be
 * turned off: iOS Home Screen apps do not share storage with Safari, so the installed app opens
 * signed out (see story 11 known limitations).
 *
 * OFF for now: Tom, 10/16 ("iOS prompt off for now"). Android keeps its banner.
 */
export const IOS_INSTALL_PROMPT_ENABLED = false

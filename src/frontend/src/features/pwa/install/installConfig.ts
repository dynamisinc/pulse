/**
 * features/pwa/install/installConfig.ts - install-prompt feature switches (story 11).
 *
 * IOS_INSTALL_PROMPT_ENABLED: set to `false` to disable ONLY the iOS "Share -> Add to Home
 * Screen" sheet (the Android `beforeinstallprompt` banner is unaffected). Reason it may be
 * turned off: iOS Home Screen apps do not share storage with Safari, so the installed app opens
 * signed out (see story 11 known limitations).
 *
 * Was OFF (Tom, 10/16) until the installed app had a way in. Back ON with #606 option A: the
 * home-screen app's sign-in page leads with "Paste your sign-in link" (the existing /auth/join
 * token), with Today's word beside it, and the sheet's last step says so.
 */
export const IOS_INSTALL_PROMPT_ENABLED = true

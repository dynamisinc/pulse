/**
 * features/participantAdmin/email - public barrel (easy-login story 13).
 *
 * The one thing the roster screen needs from this folder, for the slot composition in
 * `ParticipantAdminSurface.tsx`:
 *
 *     renderEmailAction={selection => <EmailLinksButton selection={selection} />}
 *
 * The button renders nothing unless the loaded roster reports
 * `capabilities.emailLinks: true`, so it can be mounted unconditionally. Everything else
 * (the service, the mock adapter, the formatting helpers) is internal to the folder.
 *
 * World: STAFF (despite the folder name `participantAdmin`).
 */
export { EmailLinksButton } from './EmailLinksButton'
export type { EmailLinksButtonProps } from './EmailLinksButton'

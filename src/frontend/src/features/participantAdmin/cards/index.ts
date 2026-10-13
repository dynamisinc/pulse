/**
 * features/participantAdmin/cards - public barrel (easy-login story 12).
 *
 * The one thing the roster screen needs from this folder, for the orchestrator's slot
 * composition in `ParticipantAdminRoute.tsx`:
 *
 *     renderCardsAction={selection => <PrintCardsButton selection={selection} />}
 *
 * Everything else (the preview, the sheet, the card, the service, the mock adapter) is
 * internal to the folder.
 *
 * World: STAFF (despite the folder name `participantAdmin`).
 */
export { PrintCardsButton } from './PrintCardsButton'
export type { PrintCardsButtonProps } from './PrintCardsButton'

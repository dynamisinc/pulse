/**
 * features/participantAdmin - public barrel (feature: easy-login).
 *
 * The staff route registry (`@/features/staff/staffRouteRegistry`) mounts
 * `ParticipantAdminSurface` at `/staff/participant-admin`: the roster screen with the
 * day-word panel and the print-cards action composed into its slots. That is the one
 * thing outside this folder that needs to know about it. Everything else (the roster
 * page, the slot folders, the services) is internal.
 *
 * World: STAFF (COBRA), despite the folder name.
 */
export { ParticipantAdminSurface } from './ParticipantAdminSurface'

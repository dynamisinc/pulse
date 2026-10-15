/**
 * features/app-shell/staffRoleWords.ts
 * ---------------------------------------------------------------------------
 * Staff roles IN WORDS, for the "not allowed" page (demo-feedback story 15,
 * DF-20). Pure functions — no React, no router, no theme — so the wording is
 * testable on its own and the page stays a thin renderer.
 *
 * The words are what a person calls the role, not the wire literal: `orgAdmin`
 * is "org admin". A role list is joined the way a sentence would say it:
 *
 *   ['planner']                            → "the planner role"
 *   ['planner', 'controller']              → "the planner or controller role"
 *   ['planner', 'orgAdmin', 'controller']  → "the planner, org admin or controller role"
 *
 * Order follows the registry entry's `allowedRoles` exactly, so the sentence
 * names the roles in the order the entry declares them.
 */

import type { StaffSurfaceRole } from './staffRouting'

/** What a person calls each staff-surface role. */
export const STAFF_ROLE_WORDS: Readonly<Record<StaffSurfaceRole, string>> = {
  planner: 'planner',
  orgAdmin: 'org admin',
  controller: 'controller',
  evaluator: 'evaluator',
}

/**
 * Joins role words naturally: "a", "a or b", "a, b or c". An empty list is an
 * empty string — the caller decides what to say when no role may open a surface.
 */
export function joinRoleWords(roles: readonly StaffSurfaceRole[]): string {
  const words = roles.map(role => STAFF_ROLE_WORDS[role])
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`
}

/**
 * The full "You need the … role to open …" sentence. With no admitted role at
 * all (a registry entry nobody may open) it says so plainly instead of naming
 * an empty role.
 */
export function describeRequiredRoles(
  roles: readonly StaffSurfaceRole[],
  surfaceLabel: string,
): string {
  if (roles.length === 0) return `No role can open ${surfaceLabel} yet.`
  return `You need the ${joinRoleWords(roles)} role to open ${surfaceLabel}.`
}

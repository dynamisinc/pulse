/**
 * features/pwa/isStaffPath.ts - True for `/staff` and `/staff/...` (two-worlds:
 * staff routes never get a participant brand manifest; story 09).
 */
export function isStaffPath(pathname: string): boolean {
  return pathname === '/staff' || pathname.startsWith('/staff/')
}

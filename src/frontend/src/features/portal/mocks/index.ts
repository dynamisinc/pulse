/**
 * features/portal/mocks — PC-5 `mocks/` barrel (exercise-portal story 02,
 * #768): portal scenarios behind the shared axios client, one flip point.
 * Kiosk-lite reuses the same fixtures (the `kioskLite` scenario).
 */

export * from './fixtures'
export {
  USE_MOCK_PORTAL,
  getPortalMockScenario,
  portalMockAdapter,
  resetPortalMockScenario,
  setPortalMockScenario,
  withPortalMock,
} from './portalMock'

/**
 * features/press/mocks — PC-5 `mocks/` barrel (press-room story 01, #738):
 * org newsrooms and releases in every state, behind the shared axios client,
 * one flip point.
 */

export * from './fixtures'
export {
  USE_MOCK_PRESS,
  getPressMockScenario,
  pressMockAdapter,
  resetPressMockScenario,
  setPressMockScenario,
  withPressMock,
} from './pressMock'

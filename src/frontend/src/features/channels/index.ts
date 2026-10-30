/**
 * features/channels — the shared channels root (FC-8). Story 02 ships
 * `contract/` and `mocks/`, story 14 `primitives/`, story 13 `skin/`; later
 * foundation stories add `data/` and `routing/` exports here.
 */

export * from './contract'
export { USE_MOCK_CHANNELS, withChannelsMock } from './mocks'
export * from './primitives'
export * from './skin'

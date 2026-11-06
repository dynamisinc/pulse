/**
 * features/channels — the shared channels root (FC-8). Story 02 ships
 * `contract/` and `mocks/`, story 14 `primitives/`, story 13 `skin/`, story
 * 08 `routing/`; later foundation stories add `data/` exports here.
 */

export * from './contract'
export { USE_MOCK_CHANNELS, withChannelsMock } from './mocks'
export * from './primitives'
export * from './skin'
export * from './routing'

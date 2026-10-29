/**
 * features/channels/skin — the outlet skin system (FC-8 `skin/`, FC-8a;
 * channels-foundation story 13). See `README.md`.
 */

export {
  CAPTION_STYLES,
  BREAKING_STYLES,
  CLUTTER_MODULES,
  CROP_AGGRESSIONS,
  HED_CASES,
  HOME_LEADS,
  NEUTRAL_SKIN_KEY,
  SKIN_EXT_NAMESPACES,
  SKIN_SCHEMA_VERSION,
  SKIN_TOKEN_KEYS,
  TABLOID_SKIN_KEY,
  outletSkinTokensSchema,
  skinOverridesSchema,
} from './schema'
export type {
  BreakingStyle,
  CaptionStyle,
  ClutterModule,
  CropAggression,
  HedCase,
  HomeLead,
  OutletSkinOverrides,
  OutletSkinPalette,
  OutletSkinTokens,
  SkinExtBag,
  SkinExtNamespace,
  SkinExtValue,
} from './schema'
export { AA_BODY, AA_LARGE, CONTRAST_PAIRS, contrastRatio, onColor } from './contrast'
export {
  getSkinTokens,
  registerSkinExtension,
  registerSkinFonts,
  registerSkinTokens,
} from './registry'
export type { RegisterSkinTokensOptions, SkinExtKeySpec, SkinExtensionSchema } from './registry'
export type { SkinFontFace } from './fonts'
export { finalizeSkinTokens, mergeSkinTokens } from './resolve'
export { SKIN_BODY_SIZE, SKIN_CSS_VARS, skinExtColorVar } from './theme'
export { useSkin } from './skinContext'
export type { SkinContextValue } from './skinContext'
export { SkinScope } from './SkinScope'
export type { SkinScopeProps } from './SkinScope'
export { OutletSkinScope } from './OutletSkinScope'
export type { OutletSkinScopeProps } from './OutletSkinScope'
export { SkinResetBoundary } from './SkinResetBoundary'
export type { SkinResetBoundaryProps } from './SkinResetBoundary'
export { useOutletSkin } from './useOutletSkin'
export type { OutletSkinResult } from './useOutletSkin'
export { NEUTRAL_SKIN_TOKENS } from './tokens/neutral'

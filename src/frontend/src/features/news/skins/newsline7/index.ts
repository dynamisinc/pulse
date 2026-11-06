/**
 * features/news/skins/newsline7 — the local-TV skin (news story 10). Importing
 * it registers the token file and its fonts with F13 (FC-8a).
 */

import { registerSkinTokens } from '@/features/channels'
import { fonts } from './fonts'
import { NEWSLINE7_SKIN_KEY, tokens } from './tokens'

registerSkinTokens(NEWSLINE7_SKIN_KEY, tokens, { fonts })

export { fonts, NEWSLINE7_SKIN_KEY, tokens }

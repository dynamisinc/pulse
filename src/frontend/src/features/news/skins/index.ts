/**
 * features/news/skins — the news skin registrations (E4-C3).
 *
 * Importing this module registers the `ext.news` schema and every news skin
 * token file with F13 (side effects only). The news channel mount (story 02)
 * imports it once. One line per skin; adding a skin is a token folder plus
 * one line here, never layout code (NWS-002).
 */

import './newsExtension'
import './newsline7'
import './courier-ledger'

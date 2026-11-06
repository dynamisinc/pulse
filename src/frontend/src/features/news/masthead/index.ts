/**
 * features/news/masthead — the outlet masthead and section nav (story 03, D3-P1 slot 2).
 * Importing it also registers the `ext.news` skin extension (`../skins/newsExtension`).
 */

export { OutletMasthead } from './OutletMasthead'
export type { OutletMastheadProps } from './OutletMasthead'
export { SectionNav } from './SectionNav'
export type { SectionNavProps } from './SectionNav'
export {
  liveChipLabel,
  mastheadVariant,
  newsHomePath,
  newsSectionPath,
} from './mastheadModel'
export type { SectionNavCurrent } from './mastheadModel'

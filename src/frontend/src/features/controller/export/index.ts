/**
 * features/controller/export — the console's Export posts button (demo-feedback story 09).
 * STAFF world only. See `ExportPostsButton.tsx` for the surface and `exportService.ts` for the
 * download (blob + bearer token + server file name + one retry on 429).
 */
export { ExportPostsButton, type ExportPostsButtonProps } from './ExportPostsButton'
export {
  downloadPostsExport,
  ExportError,
  fileNameFromContentDisposition,
  type ExportDependencies,
} from './exportService'

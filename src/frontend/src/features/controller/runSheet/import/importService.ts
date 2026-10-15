/**
 * features/controller/runSheet/import/importService.ts
 * ---------------------------------------------------------------------------
 * The SERVICE SEAM of the run sheet's "Import from Excel" (demo-feedback story 10;
 * the server is story 03). STAFF world, no UI. Mirrors `../injectService.ts`:
 *
 *   1. `InjectImportService` — the one interface the dialog programs against.
 *   2. `createLiveInjectImportService()` — axios, through the shared client
 *      `@/core/services/api` (base `/api`), so `POST /injects/import` IS
 *      `POST /api/injects/import`. The file goes as `multipart/form-data` in the single
 *      part `file`; `dryRun` is ALWAYS sent explicitly (the server answers 400 to a
 *      missing flag, so a dry run can never become a real import by omission). The
 *      content type is set explicitly so the client's JSON default cannot serialise the
 *      FormData (the roster import's precedent).
 *   3. `getInjectImportService()` — the mock/live flip on the run sheet's ONE switch,
 *      `USE_MOCK_DATA`, read at CALL time (so a test can flip it), exactly like
 *      `getInjectService()`.
 *
 * ERRORS -> `InjectImportError` with a `kind` the dialog words:
 *   400 'refused'      the server's readable `detail` (wrong file type, too big, missing
 *                      column, ...). Nothing was written.
 *   401 'unauthenticated' the session expired: sign in again.
 *   403 'forbidden'    not allowed (evaluators: story 11 hides the button).
 *   409 'conflict'     the run sheet kept changing under the import; run it again.
 *   413 'tooLarge'     the body broke a size cap before the endpoint read it.
 *   other status       'server' (status + any `detail`); no response: 'unavailable'.
 *   (See `importErrors.ts`.)
 * A 2xx whose body is not the frozen contract, or whose echoed `dryRun` is not the one
 * requested, REJECTS (fail closed): "validated, nothing written" must never be shown for a
 * real import, or the reverse.
 *
 * NO `exerciseId` and no acting-human id in the request (COR-001 / COR-018: the server
 * scopes from the session). NO telemetry: the server emits `injects.imported` (XC-004).
 */

import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { parseImportResult, type InjectImportResultDto } from './importTypes'
import { injectImportMock } from './importMock'
import { InjectImportError, translateImportError } from './importErrors'

/** The import route, relative to the shared client's `/api` base. */
export const IMPORT_PATH = '/injects/import'

/** The multipart part name the server reads. */
export const IMPORT_FILE_PART = 'file'

export interface InjectImportService {
  /** `POST /injects/import?dryRun=…` with `file`. A dry run reports and writes nothing. */
  importFile(file: File, options: { readonly dryRun: boolean }): Promise<InjectImportResultDto>
}

/** The live implementation. Stateless. */
export function createLiveInjectImportService(): InjectImportService {
  return {
    async importFile(file, { dryRun }) {
      const form = new FormData()
      form.append(IMPORT_FILE_PART, file)
      let data: unknown
      try {
        const response = await api.post<unknown>(IMPORT_PATH, form, {
          params: { dryRun },
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        data = response.data
      } catch (error) {
        throw translateImportError(error)
      }
      const result = parseImportResult(data)
      if (!result) {
        throw new InjectImportError('malformed', `Unrecognised import report from POST /api${IMPORT_PATH}`)
      }
      if (result.dryRun !== dryRun) {
        throw new InjectImportError(
          'malformed',
          `The server answered for ${result.dryRun ? 'a preview' : 'a real import'}, not the one requested.`,
        )
      }
      return result
    },
  }
}

const liveInjectImportService = createLiveInjectImportService()

/**
 * The mock/live flip point, on the run sheet's mock switch (`USE_MOCK_DATA`), read at CALL
 * time. Absence of the flag in a deploy is the live service (fail closed, COR-001).
 */
export function getInjectImportService(): InjectImportService {
  return USE_MOCK_DATA ? injectImportMock : liveInjectImportService
}

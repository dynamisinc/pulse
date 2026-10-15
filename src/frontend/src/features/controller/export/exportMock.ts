/**
 * features/controller/export/exportMock.ts
 * ---------------------------------------------------------------------------
 * The MOCK post export (demo-feedback story 09 AC5), used only when `USE_MOCK_DATA` is on (the
 * console's existing mock switch). STAFF world, no UI.
 *
 * An axios adapter for `GET /staff/exports/posts.xlsx` that answers the way story 02's endpoint
 * does - a file body plus `Content-Disposition: attachment; filename="..."` - so the console's
 * blob download, file-name parsing and save all run in mock mode. Mock mode has no ClosedXML, so
 * the file is a small CSV with the export's header row (it opens in Excel), named `.csv` so it
 * never pretends to be a workbook.
 */

import { AxiosHeaders, type AxiosAdapter } from 'axios'

/** The file name the mock "server" sends. */
export const MOCK_EXPORT_FILE_NAME = 'pulse-posts-mock-exercise.csv'

/** The export's columns (implementation.md, "Export columns"). */
const COLUMNS = [
  'Scenario time',
  'Wall clock (UTC)',
  'Author handle',
  'Author name',
  'Author type',
  'Posted by',
  'Inject #',
  'Post id',
  'Reply to',
  'Text',
  'Media',
  'Likes',
  'Reposts',
  'Replies',
  'Shown likes',
  'Shown reposts',
  'Shown replies',
  'Pinned for all',
  'Status',
  'Taken down at',
]

export const mockExportAdapter: AxiosAdapter = config =>
  Promise.resolve({
    data: new Blob([`${COLUMNS.join(',')}\r\n`], { type: 'text/csv' }),
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders({
      'content-type': 'text/csv',
      'content-disposition': `attachment; filename="${MOCK_EXPORT_FILE_NAME}"`,
    }),
    config,
  })

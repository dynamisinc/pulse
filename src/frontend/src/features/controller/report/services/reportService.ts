/**
 * features/controller/report/services/reportService.ts
 * ---------------------------------------------------------------------------
 * Fetches the printable exercise report (demo-feedback story 29). STAFF world, no UI.
 *
 * THE CALL. `GET /api/staff/exports/report?includeNoise=<bool>` through the shared axios client,
 * so the staff bearer token rides on it (and the silent refresh covers an expired one). The
 * answer is the frozen `ExerciseReport` JSON. The exercise is resolved by the SERVER from the
 * session; nothing here names an exercise (XC-001).
 *
 * ERRORS are sentences (`ReportError.message`): 401 (no session / no exercise), 404 (exercise
 * gone) and 413 (more than 5,000 listed posts) get readable text, the server's ProblemDetails
 * `detail` winning when it sent a safe one.
 *
 * MOCK <-> LIVE. Under `USE_MOCK_DATA` the request goes through `mockReportAdapter`, the same
 * flip as the posts export, so the page works with no API.
 */

import axios from 'axios'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { api } from '@/core/services/api'
import { problemDetailFromBody } from '../../export/exportService'
import type { ExerciseReport } from '../types/report'
import { mockReportAdapter } from './reportMock'

/** The route, relative to the API base (`/api`). */
export const REPORT_PATH = '/staff/exports/report'

/** A big exercise takes a while to build. */
const REQUEST_TIMEOUT_MS = 120_000

/** A failed report fetch, with a message meant for the person looking at the page. */
export class ReportError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ReportError'
    this.status = status
  }
}

function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Your console session has expired or has no exercise. Sign in again, then reopen the report.'
    case 403:
      return 'Only staff assigned to this exercise can open its report.'
    case 404:
      return 'This exercise no longer exists, so there is no report to show.'
    case 413:
      return 'This exercise has too many posts for a printed report (the limit is 5,000 listed posts). Use Export posts for the full list.'
    default:
      return `The report could not be built (the server answered ${status}).`
  }
}

/** Fetches the report; rejects with a {@link ReportError}. */
export async function fetchExerciseReport(includeNoise: boolean): Promise<ExerciseReport> {
  try {
    const response = await api.get<ExerciseReport>(REPORT_PATH, {
      params: { includeNoise },
      timeout: REQUEST_TIMEOUT_MS,
      ...(USE_MOCK_DATA ? { adapter: mockReportAdapter } : {}),
    })
    const body: unknown = response.data
    if (typeof body !== 'object' || body === null || !('summary' in body) || !('posts' in body)) {
      throw new ReportError('The server sent something that is not a report.')
    }
    return response.data
  } catch (error) {
    if (error instanceof ReportError) throw error
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      if (status === undefined) {
        throw new ReportError('The server could not be reached. The report was not loaded.')
      }
      const detail = await problemDetailFromBody(error.response?.data)
      throw new ReportError(detail ?? messageForStatus(status), status)
    }
    throw new ReportError('The report could not be loaded. Try again.')
  }
}

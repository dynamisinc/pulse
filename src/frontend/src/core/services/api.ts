import axios from 'axios'

/**
 * Shared axios instance for the Pulse backend API.
 *
 * Base URL comes from VITE_API_URL. When unset, requests are relative to the
 * current origin (useful for a dev proxy) — see .env.example.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

export default api

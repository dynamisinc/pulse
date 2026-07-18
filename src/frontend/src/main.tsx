import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { checkEnvironment } from './core/utils/validateEnv'
import { warnIfMockDataActive } from './core/config/mockData'

// Validate environment variables on startup, and warn loudly if a production
// build is running on mock data (VITE_USE_MOCK_DATA) so a backend-less UAT is
// never mistaken for a real, backed environment.
checkEnvironment()
warnIfMockDataActive()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found — cannot mount the app.')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

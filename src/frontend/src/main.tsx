import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { checkEnvironment } from './core/utils/validateEnv'

// Validate environment variables on startup
checkEnvironment()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found — cannot mount the app.')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

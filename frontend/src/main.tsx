import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AccessGate } from './components/AccessGate'
import { readDeviceCapabilities } from './store/capabilitiesStore'

// Once per launch: what the native engine can do (the human SL net for now).
// No bridge, or a build without the call, leaves it unread and changes nothing.
void readDeviceCapabilities()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccessGate>
      <App />
    </AccessGate>
  </StrictMode>,
)

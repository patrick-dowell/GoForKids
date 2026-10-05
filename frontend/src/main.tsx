import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AccessGate } from './components/AccessGate'
import { readDeviceCapabilities } from './store/capabilitiesStore'
import { watchServer } from './store/serverReachStore'

// Once per launch: what the native engine can do (the human SL net for now).
// No bridge, or a build without the call, leaves it unread and changes nothing.
void readDeviceCapabilities()

// Whether the online bots can be reached, while they are the ones that play:
// asked now, on return to the foreground, and when the bots turn online.
watchServer()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccessGate>
      <App />
    </AccessGate>
  </StrictMode>,
)

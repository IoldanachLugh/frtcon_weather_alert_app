import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { sweepExpiredCache } from './lib/cache.js'

// The service worker's offline fallback page (public/sw.js) tracks its
// reload attempts in sessionStorage so a capped backoff survives the
// reloads it's causing. Reaching this line means a real page load just
// succeeded, so that count is stale -- clear it now rather than letting it
// carry over and make an unrelated later failure back off faster than it
// should.
try {
  sessionStorage.removeItem('frtcon_reconnect_attempts')
} catch {
  // Ignore storage failures (see lib/cache.js for why this can throw).
}

// One-time cleanup of any zone/alerts/zip cache entries that expired since
// the last visit -- see sweepExpiredCache's own comment for why this
// doesn't otherwise happen on its own.
sweepExpiredCache()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

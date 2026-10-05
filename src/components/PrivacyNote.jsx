// Collapsed-by-default privacy note at the bottom of the page. A native
// <details> handles open/close and keyboard access, so there's no state.
// The text is accurate only while the app has no cookies or analytics and
// stores nothing beyond localStorage/sessionStorage -- see CONTEXT.md.
export function PrivacyNote() {
  return (
    <details className="card privacy-note">
      <summary className="privacy-summary">Privacy</summary>
      <div className="privacy-body">
        <p>FRTCON doesn&apos;t use cookies, analytics, or ads.</p>
        <p>
          What&apos;s stored in your browser: your last ZIP code and lookup method, plus short-lived
          cached results so repeat lookups are faster. This stays on your device and is never sent
          to us. You can clear it any time in your browser&apos;s site settings.
        </p>
        <p>
          What&apos;s sent to others: when you enter a ZIP, it&apos;s sent to Zippopotam.us to find
          coordinates. Those coordinates are then sent to the National Weather Service
          (api.weather.gov) to get alerts. Both services can see your IP address. The site is
          delivered through Cloudflare, which also handles your connection.
        </p>
        <p>
          Location: if you tap &quot;Use Browser Location&quot;, the app asks your browser for your
          position. If that&apos;s how you looked up last time, it may ask again when you return.
          Your browser lets you allow or block this at any time.
        </p>
      </div>
    </details>
  );
}

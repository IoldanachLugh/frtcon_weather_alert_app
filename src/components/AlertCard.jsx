export function AlertCard({ feature }) {
  const p = feature.properties || {};

  return (
    <div className="nws-alert-card">
      <div className="nws-alert-header-row">
        <h3 className="nws-alert-event-name">{p.event || "Unnamed Alert"}</h3>
        <span className="alert-tag">{p.severity || "Unknown severity"}</span>
      </div>
      <p className="nws-alert-area-desc">{p.areaDesc || "Affected area unavailable"}</p>
      {p.headline ? (
        <p className="nws-alert-headline">
          <strong>{p.headline}</strong>
        </p>
      ) : null}
      <div className="nws-alert-meta-grid">
        <div>
          <strong>Urgency:</strong> {p.urgency || "Unknown"}
        </div>
        <div>
          <strong>Certainty:</strong> {p.certainty || "Unknown"}
        </div>
        <div>
          <strong>Expires:</strong> {p.expires ? new Date(p.expires).toLocaleString() : "Unknown"}
        </div>
      </div>
      {p.description ? <p className="nws-alert-description">{p.description}</p> : null}
    </div>
  );
}

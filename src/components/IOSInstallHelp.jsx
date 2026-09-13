import React, { useEffect } from "react";

export function IOSInstallHelp({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ios-install-help-title"
        className="modal-card modal-card--narrow"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header-row">
          <h2 id="ios-install-help-title" className="modal-title">
            Add to Home Screen
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="modal-close-button">
            ×
          </button>
        </div>

        <p className="modal-paragraph">
          iOS doesn't let apps trigger this automatically, so it takes a couple of manual taps:
        </p>
        <ol className="modal-list modal-section">
          <li className="modal-list-item--spaced">
            Tap the Share icon (the square with an arrow pointing up) in Safari's toolbar.
          </li>
          <li className="modal-list-item--spaced">
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </li>
          <li className="modal-list-item">Tap Add to confirm.</li>
        </ol>
      </div>
    </div>
  );
}

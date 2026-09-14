import { useRef } from "react";
import { RECIPE } from "../data/recipe";
import { useModalBehavior } from "../hooks/useModalBehavior";

export function RecipeModal({ open, onClose, returnFocusRef }) {
  const cardRef = useRef(null);
  useModalBehavior(open, onClose, cardRef, returnFocusRef);

  if (!open) return null;

  return (
    <div className="frtcon-recipe-overlay modal-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipe-modal-title"
        className="frtcon-recipe-card modal-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header-row">
          <h2 id="recipe-modal-title" className="modal-title">
            {RECIPE.title}
          </h2>
          <div className="frtcon-no-print modal-button-group">
            <button type="button" onClick={() => window.print()} className="modal-print-button">
              Print
            </button>
            <button type="button" onClick={onClose} aria-label="Close recipe" className="modal-close-button">
              ×
            </button>
          </div>
        </div>

        <div className="modal-section">
          <div className="modal-section-title">Ingredients</div>
          <ul className="modal-list">
            {RECIPE.ingredients.map((item, index) => (
              <li key={index} className="modal-list-item">
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="modal-section--spaced">
          <div className="modal-section-title">Steps</div>
          <ol className="modal-list">
            {RECIPE.steps.map((step, index) => {
              const waitMatch = step.match(/^(Wait\.?)(\s+[\s\S]*)$/);
              return (
                <li key={index} className="modal-list-item--spaced">
                  {waitMatch ? (
                    <>
                      <strong>
                        <em>{waitMatch[1]}</em>
                      </strong>
                      {waitMatch[2]}
                    </>
                  ) : (
                    step
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

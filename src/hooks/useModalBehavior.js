import { useEffect, useRef } from "react";

// Elements a keyboard user can land on. Good enough for the simple dialogs
// in this app (a handful of buttons/links per modal) -- not attempting to
// handle every edge case (inert content, custom widgets, etc.) that a full
// focus-trap library would.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null // skip anything hidden (display:none ancestor)
  );
}

// Shared behavior for the app's modal dialogs (RecipeModal, IOSInstallHelp):
//   - traps Tab/Shift+Tab focus inside the dialog while it's open
//   - moves focus into the dialog on open, and back to whatever triggered
//     it on close, so keyboard/screen-reader users aren't dropped onto
//     <body> or left on a hidden element
//   - locks background scroll while open
//   - closes on Escape
//
// `containerRef` should point at the dialog element itself (the card, not
// the overlay), so the focus trap only cycles through visible dialog
// content.
//
// `returnFocusRef`, if given, is used as a fallback for where to send focus
// on close when the element that had focus when the modal opened is gone by
// then -- e.g. a menu item that closes its menu (unmounting itself) in the
// same click handler that opens the modal, so `document.activeElement` is
// already `<body>` before this hook's effect ever runs.
export function useModalBehavior(open, onClose, containerRef, returnFocusRef) {
  const previouslyFocusedRef = useRef(null);

  // Read the latest onClose via a ref rather than putting it in the effect's
  // dependency array. App.jsx passes an inline arrow function as onClose, so
  // its identity changes on every parent render (e.g. the 5-minute alert
  // refresh) even while this modal stays open -- if onClose were a
  // dependency, the effect below would tear down and re-run on every one of
  // those renders, stealing focus back to the first element and toggling
  // the scroll lock off/on mid-interaction.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocusedRef.current = document.activeElement;

    const container = containerRef.current;
    const focusables = getFocusable(container);
    (focusables[0] || container)?.focus?.();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const currentFocusables = getFocusable(container);
      if (currentFocusables.length === 0) return;

      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;

      const previouslyFocused = previouslyFocusedRef.current;
      // document.body is always .isConnected, so it doesn't tell us
      // anything on its own -- but it's also what document.activeElement
      // falls back to when nothing else is focused, which is exactly what
      // happens when the trigger (e.g. a menu item) unmounts itself in the
      // same click handler that opens the modal. Treat that case the same
      // as a disconnected element: neither is a real "what to return to".
      const isRealPreviousFocus =
        previouslyFocused?.isConnected && previouslyFocused !== document.body;
      // returnFocusRef points at a long-lived element (e.g. the menu
      // button), not one this effect owns, so reading .current here at
      // cleanup time -- rather than a value captured back at mount --
      // is what we actually want.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const target = isRealPreviousFocus ? previouslyFocused : returnFocusRef?.current;
      target?.focus?.();
    };
    // containerRef and returnFocusRef are stable ref objects and onClose is
    // handled via onCloseRef above (see comment there) -- open is the only
    // real dependency this effect should re-run on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

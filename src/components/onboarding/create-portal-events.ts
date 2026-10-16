/*
 * Opening the Create Portal dialog from anywhere in the shell, such as the
 * sidebar's switcher and the Portals page, without a shared provider: an
 * opener dispatches the event, and the mounted dialog handles it.
 */

const OPEN_CREATE_PORTAL = "fabricate:open-create-portal";

/** Asks the mounted Create Portal dialog to open. False when no dialog handled it, so the opener can navigate instead. */
export function openCreatePortal(): boolean {
  const event = new Event(OPEN_CREATE_PORTAL, { cancelable: true });
  return !window.dispatchEvent(event);
}

/** Opens the dialog through +open+ whenever an opener asks; returns the unsubscribe. */
export function onOpenCreatePortal(open: () => void): () => void {
  const listener = (event: Event) => {
    event.preventDefault();
    open();
  };
  window.addEventListener(OPEN_CREATE_PORTAL, listener);
  return () => window.removeEventListener(OPEN_CREATE_PORTAL, listener);
}

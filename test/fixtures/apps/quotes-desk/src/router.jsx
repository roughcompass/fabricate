import { useSyncExternalStore } from "react";

/** Where the build is served from: the directory of its scripts, "/" in development or the preview's own path once built. */
const BASE = new URL(__webpack_public_path__, window.location.href).pathname;

function currentRoute() {
  const path = window.location.pathname;
  return path.startsWith(BASE) ? `/${path.slice(BASE.length)}` : path;
}

const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function hrefFor(route) {
  return `${BASE}${route.replace(/^\//, "")}`;
}

export function navigate(route) {
  window.history.pushState(null, "", hrefFor(route));
  for (const listener of listeners) listener();
}

export function useRoute() {
  return useSyncExternalStore(subscribe, currentRoute);
}

export function Link({ to, children, ...props }) {
  return (
    <a
      {...props}
      href={hrefFor(to)}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

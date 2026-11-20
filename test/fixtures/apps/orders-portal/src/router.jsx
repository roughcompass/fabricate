import { useSyncExternalStore } from "react";

/** Where the build is served from: "/" in development, the preview's own path once built under it. */
const BASE = import.meta.env.BASE_URL;

/** The route the address shows, relative to the base, such as "/accounts/42". */
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

export function navigate(route, { replace = false } = {}) {
  if (replace) window.history.replaceState(null, "", hrefFor(route));
  else window.history.pushState(null, "", hrefFor(route));
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

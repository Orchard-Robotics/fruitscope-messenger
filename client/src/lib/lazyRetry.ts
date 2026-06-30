import { lazy, type ComponentType, type LazyExoticComponent } from "react";

// After a deploy, the bucket may no longer hold the *previous* build's hashed
// chunks. A tab still running the old index.html then 404s when it lazy-loads
// one of those chunks ("Failed to fetch dynamically imported module"). The fix
// is to reload once so the browser fetches the fresh index.html (no-store) and
// its current chunk graph. Guarded by a short window so a genuinely-broken
// chunk can't spin in a reload loop.

const RELOAD_KEY = "stale-chunk-reloaded-at";
const RELOAD_WINDOW_MS = 15_000;

/** Reload once to pick up a fresh build; no-op if we just reloaded. */
export function reloadForStaleChunk(): void {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
  } catch {
    /* sessionStorage may be unavailable (private mode); fall through */
  }
  if (Date.now() - last < RELOAD_WINDOW_MS) return; // already tried — don't loop
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  window.location.reload();
}

/**
 * Like React.lazy, but a chunk-load failure triggers a one-shot reload into the
 * fresh build instead of surfacing an unrecoverable error boundary.
 */
// Mirrors React.lazy's own constraint so component props are preserved.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((err) => {
      reloadForStaleChunk();
      throw err; // a reload is in flight; rethrow so Suspense holds the fallback
    }),
  );
}

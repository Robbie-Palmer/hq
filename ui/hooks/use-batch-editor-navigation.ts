"use client";

import { type RefObject, useEffect } from "react";

function navigationAnchor(event: MouseEvent): HTMLAnchorElement | null {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return null;
  const anchor =
    event.target instanceof Element ? event.target.closest("a") : null;
  if (
    !anchor ||
    !anchor.hasAttribute("href") ||
    anchor.hasAttribute("download") ||
    (anchor.target && anchor.target !== "_self")
  )
    return null;
  return anchor;
}

export function useBatchEditorNavigation(
  flush: () => Promise<void>,
  dirty: RefObject<boolean>,
  acceptance: RefObject<unknown>,
  flushRef: RefObject<(() => Promise<void>) | null>,
) {
  useEffect(() => {
    flushRef.current = flush;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current || acceptance.current) event.preventDefault();
    };
    const onNavigate = (event: MouseEvent) => {
      if (!dirty.current) return;
      const anchor = navigationAnchor(event);
      if (!anchor) return;
      event.preventDefault();
      void flush()
        .then(() => window.location.assign(anchor.href))
        .catch(() => undefined);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onNavigate, true);
    return () => {
      flushRef.current = null;
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onNavigate, true);
    };
  }, [flush, dirty, acceptance, flushRef]);
}

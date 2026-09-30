"use client";

import { type MouseEvent, type RefObject, useCallback, useEffect } from "react";

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
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      flushRef.current = null;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [flush, dirty, acceptance, flushRef]);
  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor || !dirty.current) return;
      event.preventDefault();
      void flush()
        .then(() => window.location.assign(anchor.href))
        .catch(() => undefined);
    },
    [flush, dirty],
  );
}

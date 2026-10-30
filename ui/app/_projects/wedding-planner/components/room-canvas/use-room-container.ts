import { useEffect, useRef, useState } from "react";
import type { Palette } from "./types";

export function useRoomContainer() {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [palette, setPalette] = useState<Palette>({
    ink: "#23352e",
    paper: "#f8f8f3",
    sage: "#dbe9dd",
    line: "#e5e9e0",
    softInk: "#59675d",
  });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    const css = getComputedStyle(element);
    setPalette({
      ink: css.getPropertyValue("--ink").trim(),
      paper: css.getPropertyValue("--paper").trim(),
      sage: css.getPropertyValue("--sage").trim(),
      line: css.getPropertyValue("--line").trim(),
      softInk: css.getPropertyValue("--soft-ink").trim(),
    });
    return () => observer.disconnect();
  }, []);
  return { container, width, palette };
}

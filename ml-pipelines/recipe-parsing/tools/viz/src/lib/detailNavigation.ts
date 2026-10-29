import { useEffect } from "react";

interface DetailKeyboardOptions {
  dirty?: boolean;
  entryIndex: number;
  totalEntries: number;
  onBack: () => void;
  onNavigate: (index: number) => void;
  onSave?: () => void | Promise<void>;
}

interface KeyboardEventTarget {
  addEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void,
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void,
  ): void;
}

function isFormControl(target: EventTarget | null): boolean {
  if (typeof HTMLInputElement === "undefined") return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function handleDetailKeyDown(
  event: KeyboardEvent,
  options: DetailKeyboardOptions,
): void {
  const saveShortcut = (event.metaKey || event.ctrlKey) && event.key === "s";
  if (saveShortcut && options.onSave) {
    event.preventDefault();
    if (options.dirty) void options.onSave();
    return;
  }
  if (isFormControl(event.target)) return;
  if (event.key === "Escape") options.onBack();
  if (event.key === "ArrowLeft" && options.entryIndex > 0) {
    options.onNavigate(options.entryIndex - 1);
  }
  if (
    event.key === "ArrowRight" &&
    options.entryIndex < options.totalEntries - 1
  ) {
    options.onNavigate(options.entryIndex + 1);
  }
}

export function useDetailKeyboard(options: DetailKeyboardOptions): void {
  useEffect(() => subscribeDetailKeyboard(options), [options]);
}

export function subscribeDetailKeyboard(
  options: DetailKeyboardOptions,
  target: KeyboardEventTarget = window,
): () => void {
  const onKeyDown = (event: KeyboardEvent) =>
    handleDetailKeyDown(event, options);
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}

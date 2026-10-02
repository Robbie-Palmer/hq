import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBatchEditorNavigation } from "@/hooks/use-batch-editor-navigation";

function fixture() {
  const flush = vi.fn(() => new Promise<void>(() => undefined));
  const dirty = { current: true };
  const acceptance = { current: null as unknown };
  const flushRef = { current: null as (() => Promise<void>) | null };
  const hook = renderHook(() =>
    useBatchEditorNavigation(flush, dirty, acceptance, flushRef),
  );
  const anchor = document.createElement("a");
  anchor.href = "/recipes";
  document.body.append(anchor);
  return { flush, dirty, acceptance, flushRef, anchor, ...hook };
}

describe("batch editor navigation", () => {
  it("blocks a header link until edits flush and cleans up its global guard", () => {
    const f = fixture();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => f.anchor.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(f.flush).toHaveBeenCalledOnce();
    expect(f.flushRef.current).toBe(f.flush);
    f.unmount();
    const afterUnmount = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    f.anchor.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
    expect(f.flushRef.current).toBeNull();
    f.anchor.remove();
  });

  it("preserves opening a new tab and warns on closing with pending work", () => {
    const f = fixture();
    const modified = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    f.anchor.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    f.anchor.target = "_blank";
    const newTab = new MouseEvent("click", { bubbles: true, cancelable: true });
    f.anchor.dispatchEvent(newTab);
    expect(newTab.defaultPrevented).toBe(false);
    expect(f.flush).not.toHaveBeenCalled();
    const dirtyUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
    f.dirty.current = false;
    const cleanUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
    f.acceptance.current = {};
    const pendingUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(pendingUnload);
    expect(pendingUnload.defaultPrevented).toBe(true);
    f.unmount();
    f.anchor.remove();
  });
});

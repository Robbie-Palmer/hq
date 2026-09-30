import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TechOrbit } from "@/components/ui/tech-icon-orbit";

vi.mock("@/lib/api/tech-icons", () => ({
  getTechIconUrl: () => "/tech-icons/typescript.svg",
}));

const technologies = [{ name: "TypeScript" }, { name: "Python" }];

let resize: ResizeObserverCallback;
// Keyed by frame id so cancelAnimationFrame actually drops the callback, which
// is the only way a test can tell a cancelled frame from a queued one.
let frames: Map<number, FrameRequestCallback>;
let lastFrameId: number;
const disconnect = vi.fn();

function measure(width: number) {
  act(() => {
    resize(
      [{ contentRect: { width } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  });
}

function runFrames() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    for (const frame of pending) frame(performance.now());
  });
}

function orbitHeight(container: HTMLElement) {
  return container.querySelector<HTMLElement>("[style*='height']")?.style
    .height;
}

describe("TechOrbit", () => {
  beforeEach(() => {
    frames = new Map();
    lastFrameId = 0;
    disconnect.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {
          disconnect();
        }
      },
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
      lastFrameId += 1;
      frames.set(lastFrameId, frame);
      return lastFrameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defers the measured width so the observer never resizes what it just measured", () => {
    const { container } = render(<TechOrbit technologies={technologies} />);
    const initialHeight = orbitHeight(container);

    measure(160);

    // Writing state inside the callback is what makes browsers report
    // "ResizeObserver loop completed with undelivered notifications".
    expect(orbitHeight(container)).toBe(initialHeight);
    expect(frames.size).toBe(1);

    runFrames();

    expect(orbitHeight(container)).not.toBe(initialHeight);
  });

  it("supersedes a pending frame so a burst settles once on the newest width", () => {
    const { container } = render(<TechOrbit technologies={technologies} />);
    const initialHeight = orbitHeight(container);

    // 400 scales identically to the 600 default, so only the narrower 160 moves
    // the height - the settled value shows which width the surviving frame kept.
    measure(400);
    measure(160);

    expect(frames.size).toBe(1);

    runFrames();

    expect(orbitHeight(container)).not.toBe(initialHeight);
  });

  it("ignores sub-pixel width changes", () => {
    const { container } = render(<TechOrbit technologies={technologies} />);

    measure(160);
    runFrames();
    const settledHeight = orbitHeight(container);

    measure(160.4);
    runFrames();

    expect(orbitHeight(container)).toBe(settledHeight);
  });

  it("stops observing and drops the pending frame when unmounted", () => {
    const { unmount } = render(<TechOrbit technologies={technologies} />);

    measure(160);
    expect(frames.size).toBe(1);

    unmount();

    expect(disconnect).toHaveBeenCalled();
    // A frame left queued here would write state for a component that is gone.
    expect(frames.size).toBe(0);
  });

  it("clears the selected technology through a native button", async () => {
    const user = userEvent.setup();
    render(<TechOrbit technologies={technologies} />);

    const clearButton = screen.getByRole("button", {
      name: "Clear selected technology",
    });
    expect(clearButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "TypeScript" }));
    expect(clearButton).toBeEnabled();

    await user.click(clearButton);
    expect(clearButton).toBeDisabled();
  });
});

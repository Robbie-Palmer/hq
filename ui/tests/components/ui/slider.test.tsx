import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Slider } from "@/components/ui/slider";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("Slider", () => {
  it("labels each thumb and moves the focused value by one step", () => {
    const onValueChange = vi.fn();
    render(
      <Slider
        min={0}
        max={10}
        step={1}
        value={[2, 8]}
        thumbLabels={["Range start", "Range end"]}
        thumbValueTexts={["2 January", "8 January"]}
        onValueChange={onValueChange}
      />,
    );

    const start = screen.getByRole("slider", { name: "Range start" });
    const end = screen.getByRole("slider", { name: "Range end" });
    expect(start).toHaveAttribute("aria-valuenow", "2");
    expect(start).toHaveAttribute("aria-valuetext", "2 January");
    expect(end).toHaveAttribute("aria-valuenow", "8");
    expect(end).toHaveAttribute("aria-valuetext", "8 January");

    fireEvent.keyDown(start, { key: "ArrowRight" });

    expect(onValueChange).toHaveBeenCalledWith([3, 8]);
  });
});

import { describe, expect, it } from "vitest";
import { pinchTouches, pinchView } from "@/lib/wedding-planner/room-gestures";

describe("room pinch gestures", () => {
  const start = {
    center: { x: 200, y: 150 },
    distance: 100,
    zoom: 1,
    position: { x: 30, y: 20 },
  };
  const origin = { x: 10, y: 5 };

  it("zooms around the point between the fingers while panning", () => {
    const current = pinchTouches({ x: 150, y: 190 }, { x: 350, y: 190 });
    const view = pinchView(start, current, origin);
    expect(view.zoom).toBe(2);
    // The same room point stays beneath the new midpoint, even with an offset viewport.
    const roomPoint = {
      x: (start.center.x - start.position.x) / start.zoom,
      y: (start.center.y - start.position.y) / start.zoom,
    };
    expect(origin.x + view.x + roomPoint.x * view.zoom).toBe(current.center.x);
    expect(origin.y + view.y + roomPoint.y * view.zoom).toBe(current.center.y);
  });

  it("limits zoom while preserving the focal point", () => {
    const current = { center: start.center, distance: 2000 };
    const view = pinchView(start, current, origin);
    expect(view.zoom).toBe(5);
    expect(origin.x + view.x + (200 - 30) * view.zoom).toBe(200);
    expect(
      pinchView(start, { center: start.center, distance: 1 }, origin).zoom,
    ).toBe(0.5);
  });

  it("returns to the initial view when fingers return to their starting positions", () => {
    expect(pinchView(start, start, origin)).toEqual({ zoom: 1, x: 20, y: 15 });
  });
});

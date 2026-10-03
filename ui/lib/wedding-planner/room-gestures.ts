type Point = { x: number; y: number };
export type PinchStart = {
  center: Point;
  distance: number;
  zoom: number;
  position: Point;
};

export function pinchTouches(first: Point, second: Point) {
  return {
    center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.hypot(second.x - first.x, second.y - first.y),
  };
}

/** Keep the room point under the initial midpoint beneath the moving fingers. */
export function pinchView(
  start: PinchStart,
  current: ReturnType<typeof pinchTouches>,
  origin: Point,
) {
  const zoom = Math.max(
    0.5,
    Math.min(5, (start.zoom * current.distance) / start.distance),
  );
  const ratio = zoom / start.zoom;
  return {
    zoom,
    x:
      current.center.x - (start.center.x - start.position.x) * ratio - origin.x,
    y:
      current.center.y - (start.center.y - start.position.y) * ratio - origin.y,
  };
}

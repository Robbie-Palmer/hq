import { Button } from "@/components/ui/button";

export function ViewControls({
  zoom,
  zoomTo,
  fitRoom,
}: {
  zoom: number;
  zoomTo: (zoom: number) => void;
  fitRoom: () => void;
}) {
  return (
    <div className="room-map-view-controls">
      <Button
        variant="outline"
        aria-label="Zoom out"
        disabled={zoom <= 0.5}
        onClick={() => zoomTo(zoom / 1.25)}
      >
        −
      </Button>
      <span>{Math.round(zoom * 100)}%</span>
      <Button
        variant="outline"
        aria-label="Zoom in"
        disabled={zoom >= 5}
        onClick={() => zoomTo(zoom * 1.25)}
      >
        +
      </Button>
      <Button variant="outline" onClick={fitRoom}>
        Fit room
      </Button>
      <span className="editor-hint">
        Drag the background to pan. Drag the selected table&apos;s handle to
        rotate. Pinch with two fingers to zoom. Tap a guest to see their name.
      </span>
    </div>
  );
}

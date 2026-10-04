import type Konva from "konva";
import { type TouchEvent as ReactTouchEvent, useRef, useState } from "react";
import {
  type PinchStart,
  pinchTouches,
  pinchView,
} from "@/lib/wedding-planner/room-gestures";

export function useRoomViewport(
  width: number,
  height: number,
  onInteraction: () => void,
) {
  const stage = useRef<Konva.Stage>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const pinch = useRef<PinchStart | null>(null);
  const viewportHeight = Math.min(600, Math.max(360, width * 0.65));
  const fit = Math.min(width / 1000, viewportHeight / height);
  const origin = {
    x: (width - 1000 * fit) / 2,
    y: (viewportHeight - height * fit) / 2,
  };
  const scale = fit * view.zoom;
  function zoomTo(zoom: number, point?: { x: number; y: number }) {
    const focus = point ?? { x: width / 2, y: viewportHeight / 2 };
    const next = Math.max(0.5, Math.min(5, zoom));
    const ratio = next / view.zoom;
    setView({
      zoom: next,
      x: focus.x - (focus.x - origin.x - view.x) * ratio - origin.x,
      y: focus.y - (focus.y - origin.y - view.y) * ratio - origin.y,
    });
  }
  function touchPair(event: ReactTouchEvent<HTMLDivElement>) {
    const first = event.touches[0];
    const second = event.touches[1];
    const canvas = stage.current;
    if (!first || !second || !canvas) return null;
    const rect = canvas.container().getBoundingClientRect();
    return pinchTouches(
      { x: first.clientX - rect.left, y: first.clientY - rect.top },
      { x: second.clientX - rect.left, y: second.clientY - rect.top },
    );
  }
  function beginPinch(event: ReactTouchEvent<HTMLDivElement>) {
    const pair = touchPair(event);
    const canvas = stage.current;
    if (!pair || !canvas || !pair.distance) return;
    event.stopPropagation();
    if (pinch.current) return;
    pinch.current = { ...pair, zoom: view.zoom, position: canvas.position() };
    canvas.stopDrag();
    canvas.find<Konva.Group>("Group").forEach((node) => {
      node.stopDrag();
    });
    canvas.find<Konva.Transformer>("Transformer").forEach((node) => {
      node.stopTransform();
    });
    onInteraction();
  }
  function movePinch(event: ReactTouchEvent<HTMLDivElement>) {
    if (!pinch.current) beginPinch(event);
    const start = pinch.current;
    if (!start) return;
    event.stopPropagation();
    const pair = touchPair(event);
    if (pair) setView(pinchView(start, pair, origin));
  }
  function endPinch(event: ReactTouchEvent<HTMLDivElement>) {
    if (!pinch.current) return;
    event.stopPropagation();
    if (event.touches.length === 0) pinch.current = null;
  }
  function dismissBackground(
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) {
    if (event.target === stage.current || event.target.name() === "room-floor")
      onInteraction();
  }
  function pan(event: Konva.KonvaEventObject<DragEvent>) {
    if (pinch.current || event.target !== stage.current) return;
    setView((previous) => ({
      ...previous,
      x: event.target.x() - origin.x,
      y: event.target.y() - origin.y,
    }));
  }
  function wheel(event: Konva.KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    const point = event.target.getStage()?.getPointerPosition();
    if (point)
      zoomTo(view.zoom * (event.evt.deltaY > 0 ? 1 / 1.1 : 1.1), point);
  }
  return {
    stage,
    zoom: view.zoom,
    zoomTo,
    fitRoom: () => setView({ zoom: 1, x: 0, y: 0 }),
    isPinching: () => pinch.current !== null,
    touchHandlers: {
      onTouchStartCapture: beginPinch,
      onTouchMoveCapture: movePinch,
      onTouchEndCapture: endPinch,
      onTouchCancelCapture: endPinch,
    },
    stageProps: {
      width,
      height: viewportHeight,
      scaleX: scale,
      scaleY: scale,
      x: origin.x + view.x,
      y: origin.y + view.y,
      draggable: true,
      onClick: dismissBackground,
      onTap: dismissBackground,
      onDragStart: onInteraction,
      onDragEnd: pan,
      onWheel: wheel,
    },
    projection: {
      x: origin.x + view.x,
      y: origin.y + view.y,
      scale,
      width,
      height: viewportHeight,
    },
  };
}

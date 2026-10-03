"use client";

import type Konva from "konva";
import { type TouchEvent, useEffect, useRef, useState } from "react";
import {
  Circle,
  Group,
  Layer,
  Path,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import { Button } from "@/components/ui/button";
import {
  type PinchStart,
  pinchTouches,
  pinchView,
} from "@/lib/wedding-planner/room-gestures";
import {
  roomPosition,
  seatTooltipAnchor,
  type TableAppearance,
  tableRotation,
  tableSeats,
} from "@/lib/wedding-planner/room-layout";

type RoomTable = {
  id: string;
  capacity: number;
  appearance: TableAppearance;
  occupants: string[];
};
type Palette = {
  ink: string;
  paper: string;
  sage: string;
  line: string;
  softInk: string;
};

function CanvasTable({
  table,
  selected,
  height,
  palette,
  onSelect,
  onChange,
  onHover,
  onSeatSelect,
  isPinching,
}: Readonly<{
  table: RoomTable;
  selected: boolean;
  height: number;
  palette: Palette;
  onSelect: () => void;
  onChange: (patch: Partial<TableAppearance>) => void;
  onHover: (index: number | null) => void;
  onSeatSelect: (index: number) => void;
  isPinching: () => boolean;
}>) {
  const group = useRef<Konva.Group>(null);
  const transformer = useRef<Konva.Transformer>(null);
  const { appearance, occupants, capacity } = table;
  const name =
    appearance.name.trim() ||
    (table.id === "top" ? "Top table" : `Table ${table.id.slice(6)}`);
  const seats = tableSeats(
    appearance.shape,
    table.id === "top",
    Math.max(capacity, occupants.length),
  );
  const longSeatSpacing = table.id === "top" ? 65 : 130;
  const seatSpacing = appearance.shape === "round" ? 200 : longSeatSpacing;
  useEffect(() => {
    if (selected && transformer.current && group.current) {
      transformer.current.nodes([group.current]);
    }
  }, [selected]);
  function savePosition(node: Konva.Node) {
    const position = roomPosition(node.x(), node.y(), height);
    node.position(position);
    onChange(position);
  }
  return (
    <>
      <Group
        ref={group}
        name={`room-table-${table.id}`}
        x={appearance.x}
        y={Math.min(appearance.y, height - 100)}
        rotation={appearance.rotation}
        draggable
        _useStrictMode
        onClick={onSelect}
        onTap={onSelect}
        onDragStart={(event) => {
          event.cancelBubble = true;
          onSelect();
          onHover(null);
        }}
        onDragMove={(event) => {
          event.target.position(
            roomPosition(event.target.x(), event.target.y(), height),
          );
        }}
        onDragEnd={(event) => {
          event.cancelBubble = true;
          if (!isPinching()) savePosition(event.target);
        }}
        onTransformEnd={() => {
          if (isPinching()) return;
          const node = group.current;
          if (!node) return;
          const rotation = tableRotation(node.rotation());
          node.rotation(rotation);
          const position = roomPosition(node.x(), node.y(), height);
          node.position(position);
          onChange({ ...position, rotation });
        }}
        onMouseEnter={(event) => {
          const container = event.target.getStage()?.container();
          if (container) container.style.cursor = "grab";
        }}
        onMouseLeave={(event) => {
          const container = event.target.getStage()?.container();
          if (container) container.style.cursor = "default";
          onHover(null);
        }}
      >
        {appearance.shape === "round" ? (
          <Circle
            radius={48}
            fill={palette.sage}
            stroke={palette.ink}
            strokeWidth={selected ? 3 : 1}
          />
        ) : (
          <Rect
            x={-68}
            y={-27}
            width={136}
            height={54}
            cornerRadius={8}
            fill={palette.sage}
            stroke={palette.ink}
            strokeWidth={selected ? 3 : 1}
          />
        )}
        {seats.map((seat, index) => (
          <Group
            key={`${seat.x}:${seat.y}`}
            x={seat.x}
            y={seat.y}
            name="room-seat"
            onMouseEnter={() => onHover(index)}
            onMouseLeave={() => onHover(null)}
            onClick={(event) => {
              event.cancelBubble = true;
              onSeatSelect(index);
            }}
            onTap={(event) => {
              event.cancelBubble = true;
              onSeatSelect(index);
            }}
          >
            <Circle
              radius={Math.min(7, seatSpacing / seats.length)}
              fill={occupants[index] ? palette.ink : palette.paper}
              stroke={palette.softInk}
              strokeWidth={1}
              hitStrokeWidth={8}
            />
            {occupants[index] && (
              <Path
                data="M0 -4a2 2 0 1 0 0 4a2 2 0 1 0 0 -4 M-3 5v-1a3 3 0 0 1 6 0v1"
                stroke={palette.paper}
                strokeWidth={1}
                listening={false}
                scaleX={Math.min(1, 9 / seats.length)}
                scaleY={Math.min(1, 9 / seats.length)}
              />
            )}
          </Group>
        ))}
        <Text
          x={-60}
          y={-9}
          width={120}
          align="center"
          text={table.id === "top" ? "TOP" : table.id.slice(6)}
          fontSize={14}
          fill={palette.ink}
          listening={false}
        />
        <Text
          x={-60}
          y={9}
          width={120}
          align="center"
          text={`${occupants.length} / ${capacity} seats`}
          fontSize={10}
          fill={palette.ink}
          listening={false}
        />
        <Text
          x={-95}
          y={85}
          width={190}
          align="center"
          text={name}
          fontSize={13}
          fill={palette.ink}
          listening={false}
        />
      </Group>
      {selected && (
        <Transformer
          ref={transformer}
          resizeEnabled={false}
          rotateEnabled
          rotationSnaps={[0, 90, 180, 270]}
          rotateAnchorOffset={28}
          anchorSize={12}
          borderStroke={palette.softInk}
          anchorStroke={palette.ink}
          anchorFill={palette.paper}
        />
      )}
    </>
  );
}

export default function TableRoomCanvas({
  tables,
  height,
  selectedId,
  onSelect,
  onChange,
}: Readonly<{
  tables: RoomTable[];
  height: number;
  selectedId: string;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<TableAppearance>) => void;
}>) {
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const [width, setWidth] = useState(600);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const pinch = useRef<PinchStart | null>(null);
  const [tooltip, setTooltip] = useState<{
    tableId: string;
    index: number;
    pinned: boolean;
  } | null>(null);
  useEffect(() => {
    function dismiss(event: KeyboardEvent) {
      if (event.key === "Escape") setTooltip(null);
    }
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, []);
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
  const viewportHeight = Math.min(600, Math.max(360, width * 0.65));
  const fit = Math.min(width / 1000, viewportHeight / height);
  const origin = {
    x: (width - 1000 * fit) / 2,
    y: (viewportHeight - height * fit) / 2,
  };
  const scale = fit * view.zoom;
  const tooltipTable = tables.find((table) => table.id === tooltip?.tableId);
  const tooltipSeat =
    tooltipTable && tooltip
      ? tableSeats(
          tooltipTable.appearance.shape,
          tooltipTable.id === "top",
          Math.max(tooltipTable.capacity, tooltipTable.occupants.length),
        )[tooltip.index]
      : undefined;
  const tooltipPosition =
    tooltipTable && tooltipSeat
      ? seatTooltipAnchor(
          {
            ...tooltipTable.appearance,
            y: Math.min(tooltipTable.appearance.y, height - 100),
          },
          tooltipSeat,
          {
            x: origin.x + view.x,
            y: origin.y + view.y,
            scale,
            width,
            height: viewportHeight,
          },
        )
      : undefined;
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
  function touchPair(event: TouchEvent<HTMLDivElement>) {
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
  function beginPinch(event: TouchEvent<HTMLDivElement>) {
    const pair = touchPair(event);
    const canvas = stage.current;
    if (!pair || !canvas || !pair.distance) return;
    event.stopPropagation();
    if (pinch.current) return;
    pinch.current = { ...pair, zoom: view.zoom, position: canvas.position() };
    // Stop both pending and active drags before two fingers move the viewport.
    canvas.stopDrag();
    canvas.find<Konva.Group>("Group").forEach((node) => {
      node.stopDrag();
    });
    canvas.find<Konva.Transformer>("Transformer").forEach((node) => {
      node.stopTransform();
    });
    setTooltip(null);
  }
  function movePinch(event: TouchEvent<HTMLDivElement>) {
    if (!pinch.current) beginPinch(event);
    const start = pinch.current;
    if (!start) return;
    event.stopPropagation();
    const pair = touchPair(event);
    if (pair) setView(pinchView(start, pair, origin));
  }
  function endPinch(event: TouchEvent<HTMLDivElement>) {
    if (!pinch.current) return;
    event.stopPropagation();
    if (event.touches.length === 0) pinch.current = null;
  }
  return (
    <>
      <div className="room-map-view-controls">
        <Button
          variant="outline"
          aria-label="Zoom out"
          disabled={view.zoom <= 0.5}
          onClick={() => zoomTo(view.zoom / 1.25)}
        >
          −
        </Button>
        <span>{Math.round(view.zoom * 100)}%</span>
        <Button
          variant="outline"
          aria-label="Zoom in"
          disabled={view.zoom >= 5}
          onClick={() => zoomTo(view.zoom * 1.25)}
        >
          +
        </Button>
        <Button
          variant="outline"
          onClick={() => setView({ zoom: 1, x: 0, y: 0 })}
        >
          Fit room
        </Button>
        <span className="editor-hint">
          Drag the background to pan. Drag the selected table&apos;s handle to
          rotate. Pinch with two fingers to zoom. Tap a guest to see their name.
        </span>
      </div>
      <div
        ref={container}
        className="room-map-canvas"
        onTouchStartCapture={beginPinch}
        onTouchMoveCapture={movePinch}
        onTouchEndCapture={endPinch}
        onTouchCancelCapture={endPinch}
      >
        <div aria-hidden="true">
          <Stage
            ref={stage}
            width={width}
            height={viewportHeight}
            scaleX={scale}
            scaleY={scale}
            x={origin.x + view.x}
            y={origin.y + view.y}
            draggable
            onClick={(event) => {
              if (
                event.target === stage.current ||
                event.target.name() === "room-floor"
              )
                setTooltip(null);
            }}
            onTap={(event) => {
              if (
                event.target === stage.current ||
                event.target.name() === "room-floor"
              )
                setTooltip(null);
            }}
            onDragStart={() => setTooltip(null)}
            onDragEnd={(event) => {
              if (pinch.current || event.target !== stage.current) return;
              setView((previous) => ({
                ...previous,
                x: event.target.x() - origin.x,
                y: event.target.y() - origin.y,
              }));
            }}
            onWheel={(event) => {
              event.evt.preventDefault();
              const point = event.target.getStage()?.getPointerPosition();
              if (!point) return;
              zoomTo(view.zoom * (event.evt.deltaY > 0 ? 1 / 1.1 : 1.1), point);
            }}
          >
            <Layer>
              <Rect
                name="room-floor"
                width={1000}
                height={height}
                fill={palette.paper}
                stroke={palette.line}
                strokeWidth={2}
              />
              <Text
                x={0}
                y={18}
                width={1000}
                align="center"
                text="FRONT OF ROOM"
                letterSpacing={3}
                fontSize={12}
                fill={palette.softInk}
                listening={false}
              />
              {tables.map((table) => (
                <CanvasTable
                  key={table.id}
                  table={table}
                  selected={table.id === selectedId}
                  height={height}
                  palette={palette}
                  onSelect={() => {
                    setTooltip(null);
                    onSelect(table.id);
                  }}
                  onChange={(patch) => onChange(table.id, patch)}
                  onHover={(index) => {
                    if (index !== null)
                      setTooltip({ tableId: table.id, index, pinned: false });
                    else
                      setTooltip((previous) =>
                        previous?.pinned ? previous : null,
                      );
                  }}
                  isPinching={() => pinch.current !== null}
                  onSeatSelect={(index) => {
                    if (pinch.current) return;
                    onSelect(table.id);
                    setTooltip({ tableId: table.id, index, pinned: true });
                  }}
                />
              ))}
            </Layer>
          </Stage>
        </div>
        {tooltip && tooltipTable && tooltipPosition && (
          <div
            className="room-map-tooltip"
            role="tooltip"
            style={{ left: tooltipPosition.x, top: tooltipPosition.y }}
          >
            {tooltipTable.occupants[tooltip.index] ?? "Empty seat"}
          </div>
        )}
      </div>
    </>
  );
}

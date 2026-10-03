"use client";

import { Stage } from "react-konva";
import type { TableAppearance } from "@/lib/wedding-planner/room-layout";
import { RoomScene } from "./room-canvas/room-scene";
import { SeatTooltip, useSeatTooltip } from "./room-canvas/seat-tooltip";
import type { RoomTable } from "./room-canvas/types";
import { useRoomContainer } from "./room-canvas/use-room-container";
import { useRoomViewport } from "./room-canvas/use-room-viewport";
import { ViewControls } from "./room-canvas/view-controls";

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
  const { container, width, palette } = useRoomContainer();
  const tooltip = useSeatTooltip();
  const viewport = useRoomViewport(width, height, tooltip.dismiss);
  return (
    <>
      <ViewControls
        zoom={viewport.zoom}
        zoomTo={viewport.zoomTo}
        fitRoom={viewport.fitRoom}
      />
      <div
        ref={container}
        className="room-map-canvas"
        {...viewport.touchHandlers}
      >
        <div aria-hidden="true">
          <Stage ref={viewport.stage} {...viewport.stageProps}>
            <RoomScene
              tables={tables}
              selectedId={selectedId}
              height={height}
              palette={palette}
              tooltip={tooltip}
              isPinching={viewport.isPinching}
              onSelect={onSelect}
              onChange={onChange}
            />
          </Stage>
        </div>
        <SeatTooltip
          tables={tables}
          height={height}
          selection={tooltip.selection}
          projection={viewport.projection}
        />
      </div>
    </>
  );
}

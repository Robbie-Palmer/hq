import React from "react";
import { Layer, Rect, Text } from "react-konva";
import type { VenueElement } from "wedding-planner-domain/seating";
import type { TableAppearance } from "@/app/_projects/wedding-planner/application/room-layout";
import { CanvasTable } from "./canvas-table";
import type { useSeatTooltip } from "./seat-tooltip";
import type { Palette, RoomTable } from "./types";

function VenueElements({
  elements,
  palette,
}: Readonly<{ elements: VenueElement[]; palette: Palette }>) {
  return elements.map((element) => (
    <React.Fragment key={element.id}>
      <Rect
        name={`venue-element-${element.id}`}
        x={element.x - element.width / 2}
        y={element.y - element.height / 2}
        width={element.width}
        height={element.height}
        rotation={element.rotation}
        fill={palette.paper}
        stroke={palette.softInk}
        dash={[8, 5]}
        listening={false}
      />
      <Text
        x={element.x - element.width / 2}
        y={element.y - 7}
        width={element.width}
        align="center"
        text={element.name}
        fontSize={12}
        fill={palette.softInk}
        listening={false}
      />
    </React.Fragment>
  ));
}

export function RoomScene({
  tables,
  venueElements,
  selectedId,
  height,
  palette,
  tooltip,
  isPinching,
  onSelect,
  onChange,
}: Readonly<{
  tables: RoomTable[];
  venueElements: VenueElement[];
  selectedId: string;
  height: number;
  palette: Palette;
  tooltip: ReturnType<typeof useSeatTooltip>;
  isPinching: () => boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<TableAppearance>) => void;
}>) {
  return (
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
      <VenueElements elements={venueElements} palette={palette} />
      {tables.map((table) => (
        <CanvasTable
          key={table.id}
          table={table}
          selected={table.id === selectedId}
          height={height}
          palette={palette}
          onSelect={() => {
            tooltip.dismiss();
            onSelect(table.id);
          }}
          onChange={(patch) => onChange(table.id, patch)}
          onHover={(index) => tooltip.hover(table.id, index)}
          isPinching={isPinching}
          onSeatSelect={(index) => {
            if (isPinching()) return;
            onSelect(table.id);
            tooltip.pin(table.id, index);
          }}
        />
      ))}
    </Layer>
  );
}

import { Layer, Rect, Text } from "react-konva";
import type { TableAppearance } from "@/lib/wedding-planner/room-layout";
import { CanvasTable } from "./canvas-table";
import type { useSeatTooltip } from "./seat-tooltip";
import type { Palette, RoomTable } from "./types";

export function RoomScene({
  tables,
  selectedId,
  height,
  palette,
  tooltip,
  isPinching,
  onSelect,
  onChange,
}: {
  tables: RoomTable[];
  selectedId: string;
  height: number;
  palette: Palette;
  tooltip: ReturnType<typeof useSeatTooltip>;
  isPinching: () => boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<TableAppearance>) => void;
}) {
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

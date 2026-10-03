import { Circle, Group, Path, Rect, Text } from "react-konva";
import { tableSeats } from "@/lib/wedding-planner/room-layout";
import type { Palette, RoomTable } from "./types";

type TableDrawingProps = Readonly<{ table: RoomTable; palette: Palette }>;

export function TableShape({
  table,
  palette,
  selected,
}: Readonly<TableDrawingProps & { selected: boolean }>) {
  const { appearance } = table;
  return (
    <>
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
    </>
  );
}

export function TableSeats({
  table,
  palette,
  onHover,
  onSelect,
}: Readonly<
  TableDrawingProps & {
    onHover: (index: number | null) => void;
    onSelect: (index: number) => void;
  }
>) {
  const { appearance, occupants, capacity } = table;
  const seats = tableSeats(
    appearance.shape,
    table.id === "top",
    Math.max(capacity, occupants.length),
  );
  const longSeatSpacing = table.id === "top" ? 65 : 130;
  const seatSpacing = appearance.shape === "round" ? 200 : longSeatSpacing;
  return (
    <>
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
            onSelect(index);
          }}
          onTap={(event) => {
            event.cancelBubble = true;
            onSelect(index);
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
    </>
  );
}

export function TableLabels({ table, palette }: TableDrawingProps) {
  const { appearance, occupants, capacity } = table;
  const name =
    appearance.name.trim() ||
    (table.id === "top" ? "Top table" : `Table ${table.id.slice(6)}`);
  return (
    <>
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
    </>
  );
}

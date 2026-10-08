import type Konva from "konva";
import { useEffect, useRef } from "react";
import { Group, Transformer } from "react-konva";
import {
  roomPosition,
  type TableAppearance,
  tableRotation,
} from "@/lib/wedding-planner/room-layout";
import { TableLabels, TableSeats, TableShape } from "./table-contents";
import type { Palette, RoomTable } from "./types";

export function CanvasTable({
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
  const { appearance } = table;
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
        <TableShape table={table} palette={palette} selected={selected} />
        <TableSeats
          table={table}
          palette={palette}
          onHover={onHover}
          onSelect={onSeatSelect}
        />
        <TableLabels table={table} palette={palette} />
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

import { useEffect, useState } from "react";
import {
  seatTooltipAnchor,
  tableSeats,
} from "@/lib/wedding-planner/room-layout";
import type { RoomTable } from "./types";

type SeatTooltipSelection = { tableId: string; index: number; pinned: boolean };

export function useSeatTooltip() {
  const [tooltip, setTooltip] = useState<SeatTooltipSelection | null>(null);
  useEffect(() => {
    function dismiss(event: KeyboardEvent) {
      if (event.key === "Escape") setTooltip(null);
    }
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, []);
  return {
    selection: tooltip,
    dismiss: () => setTooltip(null),
    hover: (tableId: string, index: number | null) => {
      if (index !== null) setTooltip({ tableId, index, pinned: false });
      else setTooltip((previous) => (previous?.pinned ? previous : null));
    },
    pin: (tableId: string, index: number) =>
      setTooltip({ tableId, index, pinned: true }),
  };
}

export function SeatTooltip({
  tables,
  height,
  selection: tooltip,
  projection,
}: Readonly<{
  tables: RoomTable[];
  height: number;
  selection: SeatTooltipSelection | null;
  projection: Parameters<typeof seatTooltipAnchor>[2];
}>) {
  if (!tooltip) return null;
  const table = tables.find((table) => table.id === tooltip.tableId);
  if (!table) return null;
  const seat = tableSeats(
    table.appearance.shape,
    table.id === "top",
    Math.max(table.capacity, table.occupants.length),
  )[tooltip.index];
  if (!seat) return null;
  const position = seatTooltipAnchor(
    { ...table.appearance, y: Math.min(table.appearance.y, height - 100) },
    seat,
    projection,
  );
  return (
    <div
      className="room-map-tooltip"
      role="tooltip"
      style={{ left: position.x, top: position.y }}
    >
      {table.occupants[tooltip.index] ?? "Empty seat"}
    </div>
  );
}

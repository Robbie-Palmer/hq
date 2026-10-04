import type { TablePlan } from "./types";

export type TableAppearance = Required<
  NonNullable<TablePlan["table_layout"]>[string]
>;

export function tableAppearance(
  plan: TablePlan,
  id: string,
  index: number,
): TableAppearance {
  return {
    name: id === "top" ? "Top table" : `Table ${index}`,
    shape: id === "top" ? "long" : "round",
    x: index === 0 ? 500 : 170 + ((index - 1) % 3) * 330,
    y: index === 0 ? 110 : 330 + Math.floor((index - 1) / 3) * 230,
    rotation: 0,
    ...plan.table_layout?.[id],
  };
}

export function tableSeats(
  shape: "round" | "long",
  topTable: boolean,
  count: number,
) {
  return Array.from({ length: count }, (_, index) => {
    if (shape === "round") {
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(angle) * 70, y: Math.sin(angle) * 70 };
    }
    if (topTable) {
      return { x: count === 1 ? 0 : -68 + (index * 136) / (count - 1), y: -48 };
    }
    const upperCount = Math.ceil(count / 2);
    const upper = index < upperCount;
    const rowCount = upper ? upperCount : count - upperCount;
    const position = upper ? index : index - upperCount;
    return {
      x: rowCount === 1 ? 0 : -68 + (position * 136) / (rowCount - 1),
      y: upper ? -48 : 48,
    };
  });
}

export function roomPosition(x: number, y: number, height: number) {
  return {
    x: Math.max(100, Math.min(900, x)),
    y: Math.max(100, Math.min(height - 100, y)),
  };
}

export function tableRotation(angle: number) {
  return ((angle % 360) + 360) % 360;
}

export function seatTooltipAnchor(
  table: Pick<TableAppearance, "x" | "y" | "rotation">,
  seat: { x: number; y: number },
  viewport: {
    x: number;
    y: number;
    scale: number;
    width: number;
    height: number;
  },
) {
  const angle = (table.rotation * Math.PI) / 180;
  const x =
    viewport.x +
    (table.x + seat.x * Math.cos(angle) - seat.y * Math.sin(angle)) *
      viewport.scale;
  const y =
    viewport.y +
    (table.y + seat.x * Math.sin(angle) + seat.y * Math.cos(angle)) *
      viewport.scale;
  const margin = Math.min(120, viewport.width / 2);
  return {
    x: Math.max(margin, Math.min(viewport.width - margin, x)),
    y: Math.max(48, Math.min(viewport.height - 8, y - 14)),
  };
}

import type { WeddingGuest } from "../core/guests";
import type {
  TableAllocation,
  TableAppearance,
  TablePlan,
  VenueElement,
} from "./types";

function csvValue(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows: (string | number | boolean)[][]): string {
  return `${rows.map((row) => row.map(csvValue).join(",")).join("\r\n")}\r\n`;
}

export function exportSeatingAssignmentsCsv(
  allocation: TableAllocation,
  guests: WeddingGuest[],
): string {
  const byId = new Map(guests.map((guest) => [guest.id, guest]));
  return csv([
    [
      "Table",
      "Seat",
      "Guest",
      "Accessible seat",
      "High chair",
      "Locked",
      "Dietary needs",
      "Allergies",
    ],
    ...allocation.tables.flatMap((table) =>
      table.seats.flatMap((seat) => {
        if (!seat.guest_id) return [];
        const guest = byId.get(seat.guest_id);
        return [
          [
            table.name,
            seat.index + 1,
            guest?.name ?? seat.guest_id,
            seat.accessible,
            seat.high_chair,
            seat.locked || table.locked,
            guest?.dietary_needs.join("; ") ?? "",
            guest?.allergies.join("; ") ?? "",
          ],
        ];
      }),
    ),
  ]);
}

export function exportCateringSummaryCsv(
  allocation: TableAllocation,
  guests: WeddingGuest[],
): string {
  const seated = new Set(allocation.tables.flatMap((table) => table.guest_ids));
  const counts = new Map<string, number>();
  for (const guest of guests.filter((item) => seated.has(item.id))) {
    const meal = guest.custom_fields.meal;
    const mealName = typeof meal === "string" && meal ? meal : "Not selected";
    counts.set(`Meal: ${mealName}`, (counts.get(`Meal: ${mealName}`) ?? 0) + 1);
    for (const need of guest.dietary_needs)
      counts.set(`Dietary: ${need}`, (counts.get(`Dietary: ${need}`) ?? 0) + 1);
    for (const allergy of guest.allergies)
      counts.set(
        `Allergy: ${allergy}`,
        (counts.get(`Allergy: ${allergy}`) ?? 0) + 1,
      );
  }
  return csv([
    ["Category", "Count"],
    ...[...counts].sort(([first], [second]) => first.localeCompare(second)),
  ]);
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function venueElementSvg(element: VenueElement): string {
  return `<g transform="translate(${element.x} ${element.y}) rotate(${element.rotation})"><rect x="${-element.width / 2}" y="${-element.height / 2}" width="${element.width}" height="${element.height}" fill="#f4f1ea" stroke="#574f43" stroke-width="2"/><text text-anchor="middle" dominant-baseline="middle" font-size="13">${xml(element.name)}</text></g>`;
}

function tablePosition(
  appearance: TableAppearance | undefined,
  index: number,
): { x: number; y: number } {
  if (appearance?.x !== undefined && appearance.y !== undefined)
    return { x: appearance.x, y: appearance.y };
  if (index === 0) return { x: appearance?.x ?? 500, y: appearance?.y ?? 110 };
  return {
    x: appearance?.x ?? 170 + ((index - 1) % 3) * 330,
    y: appearance?.y ?? 330 + Math.floor((index - 1) / 3) * 230,
  };
}

function tableShapeSvg(shape: "round" | "long"): string {
  if (shape === "round")
    return '<circle r="48" fill="#dce6d8" stroke="#29251f" stroke-width="2"/>';
  return '<rect x="-68" y="-27" width="136" height="54" rx="8" fill="#dce6d8" stroke="#29251f" stroke-width="2"/>';
}

function tableDetails(table: TableAllocation["tables"][number]): string {
  const accessCount = table.seats.filter((seat) => seat.accessible).length;
  const highChairCount = table.seats.filter((seat) => seat.high_chair).length;
  return [
    `${table.guest_ids.length + table.fixed_guests.length}/${table.capacity} seats`,
    accessCount ? `${accessCount} accessible` : "",
    highChairCount ? `${highChairCount} high chair` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function tableSvg(
  plan: TablePlan,
  table: TableAllocation["tables"][number],
  index: number,
): string {
  const appearance = plan.table_layout?.[table.id];
  const { x, y } = tablePosition(appearance, index);
  const shape = appearance?.shape ?? (index === 0 ? "long" : "round");
  return `<g transform="translate(${x} ${y}) rotate(${appearance?.rotation ?? 0})">${tableShapeSvg(shape)}<text text-anchor="middle" y="-4" font-size="13" font-weight="700">${xml(table.name)}</text><text text-anchor="middle" y="14" font-size="10">${xml(tableDetails(table))}</text></g>`;
}

export function exportAccessibleFloorPlanSvg(
  plan: TablePlan,
  allocation: TableAllocation,
): string {
  const height = Math.max(
    600,
    220 + Math.ceil(plan.table_capacities.length / 3) * 230,
  );
  const tables = allocation.tables
    .map((table, index) => tableSvg(plan, table, index))
    .join("");
  const elements = (plan.venue_elements ?? []).map(venueElementSvg).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title description" viewBox="0 0 1000 ${height}"><title id="title">Wedding seating floor plan</title><desc id="description">Tables, capacities, accessible positions, high-chair positions, and fixed venue elements.</desc><rect width="1000" height="${height}" fill="#fff" stroke="#574f43" stroke-width="2"/><text x="500" y="32" text-anchor="middle" font-size="12" letter-spacing="3">FRONT OF ROOM</text>${elements}${tables}</svg>`;
}

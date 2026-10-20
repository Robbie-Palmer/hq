import type { IngredientCategory } from "@/lib/domain/recipe/ingredient";

/**
 * Shopping "aisles" — a coarser, supermarket-walk grouping of the finer
 * ingredient categories, so the by-aisle view reads like a store layout
 * rather than a taxonomy.
 */
export type Aisle = {
  id: string;
  name: string;
};

// Order = the order aisles appear in the by-aisle view (roughly a walk round
// a UK supermarket: fresh first, cupboard last).
export const AISLES: Aisle[] = [
  { id: "produce", name: "Fruit & veg" },
  { id: "meat-fish", name: "Meat & fish" },
  { id: "dairy", name: "Dairy & chilled" },
  { id: "bakery-grains", name: "Bakery & grains" },
  { id: "tins-cooking", name: "Tins, pasta & cooking" },
  { id: "herbs-spices", name: "Herbs & spices" },
  { id: "sweets-baking", name: "Sweets & baking" },
  { id: "other", name: "Other" },
];

const AISLE_ORDER = new Map(AISLES.map((aisle, index) => [aisle.id, index]));
const OTHER_AISLE_ID = "other";

const CATEGORY_TO_AISLE: Record<IngredientCategory, string> = {
  vegetable: "produce",
  fruit: "produce",
  herb: "produce",
  protein: "meat-fish",
  dairy: "dairy",
  grain: "bakery-grains",
  nuts: "sweets-baking",
  legume: "tins-cooking",
  condiment: "tins-cooking",
  "oil-fat": "tins-cooking",
  // "liquid" is dominated by cooking liquids (stock, wine, pasta water) rather
  // than drinks, so it belongs with the cooking staples, not on its own aisle.
  liquid: "tins-cooking",
  spice: "herbs-spices",
  leavening: "sweets-baking",
  sweets: "sweets-baking",
  other: "other",
};

export function aisleForCategory(category?: IngredientCategory): string {
  if (!category) return OTHER_AISLE_ID;
  return CATEGORY_TO_AISLE[category] ?? OTHER_AISLE_ID;
}

export function aisleName(id: string): string {
  return AISLES.find((aisle) => aisle.id === id)?.name ?? "Other";
}

/** Comparator to sort aisle ids into the store-walk order defined above. */
export function compareAisles(a: string, b: string): number {
  const ai = AISLE_ORDER.get(a) ?? AISLE_ORDER.size;
  const bi = AISLE_ORDER.get(b) ?? AISLE_ORDER.size;
  return ai - bi;
}

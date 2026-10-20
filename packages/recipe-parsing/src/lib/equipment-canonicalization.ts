import { normalizeSlug } from "recipe-domain/slugs";
import {
  pluralizeIngredientTerm,
  singularizeIngredientTerm,
} from "recipe-domain/pluralization";
import {
  detokenize,
  matchSlug,
  tokenize,
  uniqueSlugs,
  type CandidateScore,
  type CanonicalizationMethod,
  type CanonicalizationReason,
  type OntologyIndex,
} from "./slug-matching.js";

export interface EquipmentCanonicalizationDecision {
  originalName: string;
  baseSlug: string;
  canonicalSlug: string;
  method: CanonicalizationMethod;
  reason?: CanonicalizationReason;
  score?: number;
  threshold?: number;
  margin?: number;
  candidates: CandidateScore[];
}

const EQUIPMENT_ALIASES: Record<string, string> = {
  skillet: "frying-pan",
  frypan: "frying-pan",
  "fry-pan": "frying-pan",
  "saute-pan": "frying-pan",
  "saut-pan": "frying-pan",
  "sautee-pan": "frying-pan",
  "sauce-pan": "saucepan",
  "stock-pot": "stockpot",
  "soup-pot": "stockpot",
  "casserole-pot": "dutch-oven",
  "sheet-pan": "baking-tray",
  "sheet-tray": "baking-tray",
  "baking-sheet": "baking-tray",
  "baking-pan": "baking-tray",
  "oven-tray": "baking-tray",
  tray: "baking-tray",
  "baking-dish": "oven-dish",
  "casserole-dish": "oven-dish",
  "ovenproof-dish": "oven-dish",
  "gratin-dish": "oven-dish",
  "roasting-pan": "roasting-tin",
  "roasting-dish": "roasting-tin",
  "roasting-tray": "roasting-tin",
  "cake-pan": "cake-tin",
  "springform-pan": "springform-tin",
  "loaf-pan": "loaf-tin",
  "muffin-pan": "muffin-tin",
  "muffin-tray": "muffin-tin",
  "cupcake-tin": "muffin-tin",
  "wire-rack": "cooling-rack",
  rack: "cooling-rack",
  strainer: "sieve",
  colander: "sieve",
  sifter: "sieve",
  griddle: "griddle-pan",
  "grill-pan": "griddle-pan",
  bbq: "barbecue",
  "immersion-blender": "stick-blender",
  "hand-blender": "stick-blender",
  liquidiser: "blender",
  liquidizer: "blender",
  "electric-mixer": "hand-mixer",
  "electric-whisk": "hand-mixer",
  "balloon-whisk": "whisk",
  "chefs-knife": "knife",
  "cooks-knife": "knife",
  "cutting-board": "chopping-board",
  board: "chopping-board",
  "mortar-and-pestle": "pestle-and-mortar",
  mortar: "pestle-and-mortar",
  pestle: "pestle-and-mortar",
  "vegetable-peeler": "peeler",
  "potato-peeler": "peeler",
  "box-grater": "grater",
  "cheese-grater": "grater",
  microplane: "grater",
  "lemon-zester": "zester",
  "fish-slice": "spatula",
  turner: "spatula",
  "kitchen-scissors": "scissors",
  "kitchen-shears": "scissors",
  shears: "scissors",
  "kitchen-scales": "scales",
  "weighing-scales": "scales",
  "measuring-cup": "measuring-jug",
  "meat-thermometer": "thermometer",
  "food-thermometer": "thermometer",
  probe: "thermometer",
  "microwave-oven": "microwave",
  stove: "hob",
  stovetop: "hob",
  hotplate: "hob",
  cooker: "hob",
  "deep-fat-fryer": "deep-fryer",
  "crock-pot": "slow-cooker",
  crockpot: "slow-cooker",
  "instant-pot": "pressure-cooker",
  "steamer-basket": "steamer",
  "bamboo-steamer": "steamer",
  "tin-foil": "foil",
  "kitchen-foil": "foil",
  "aluminium-foil": "foil",
  "aluminum-foil": "foil",
  "greaseproof-paper": "baking-paper",
  "parchment-paper": "baking-paper",
  parchment: "baking-paper",
  "baking-parchment": "baking-paper",
  "plastic-wrap": "cling-film",
  tenderizer: "tenderiser",
  "meat-tenderiser": "tenderiser",
};

const EQUIPMENT_SIZE_TOKENS = new Set([
  "large",
  "small",
  "medium",
  "big",
  "wide",
  "deep",
  "shallow",
  "heavy",
  "bottomed",
  "based",
  "sided",
  "high",
  "fine",
  "mesh",
  "sturdy",
  "clean",
  "sharp",
  "nonstick",
  "non",
  "stick",
]);

// Material and quantity words can each be part of a canonical name
// ("wooden spoon", "mixing bowl"), so they are dropped in their own passes
// only after the fuller forms fail to match.
const EQUIPMENT_MATERIAL_TOKENS = new Set([
  "cast",
  "iron",
  "stainless",
  "steel",
  "metal",
  "wooden",
  "silicone",
  "plastic",
  "glass",
  "ceramic",
]);

const EQUIPMENT_QUANTITY_TOKENS = new Set([
  "mixing",
  "separate",
  "another",
  "second",
  "spare",
]);

export function equipmentDisplayName(slug: string): string {
  return slug.replaceAll("-", " ");
}

const PRESERVED_EQUIPMENT_PAIRS = new Set([
  "mortar and pestle",
  "pestle and mortar",
]);

export function splitEquipmentAlternatives(rawName: string): string[] {
  const name = rawName.trim().replace(/\s+/gu, " ");
  if (!name) return [];
  if (PRESERVED_EQUIPMENT_PAIRS.has(name.toLowerCase())) return [name];

  const measuringPair = name.match(/^measuring\s+(.+?)\s+and\s+(.+)$/iu);
  if (measuringPair) {
    return [
      `measuring ${measuringPair[1]}`,
      `measuring ${measuringPair[2]}`,
    ];
  }

  const alternatives = name
    .split(/\s+(?:or|and\/or)\s+|\s*\/\s*/iu)
    .map((value) => value.trim())
    .filter(Boolean);
  return alternatives.length > 1 ? alternatives : [name];
}

/**
 * Strips one tier of modifiers at a time so the fuller name still gets to
 * match first — "large wooden spoon" must reach "wooden-spoon" before "spoon".
 */
function equipmentStems(baseSlug: string): string[] {
  const tokens = tokenize(baseSlug);
  const withoutSize = tokens.filter(
    (token) => !EQUIPMENT_SIZE_TOKENS.has(token),
  );
  const withoutMaterial = withoutSize.filter(
    (token) => !EQUIPMENT_MATERIAL_TOKENS.has(token),
  );
  const withoutQuantity = withoutMaterial.filter(
    (token) => !EQUIPMENT_QUANTITY_TOKENS.has(token),
  );

  return uniqueSlugs([
    baseSlug,
    detokenize(withoutSize),
    detokenize(withoutMaterial),
    detokenize(withoutQuantity),
  ]);
}

function generateEquipmentCandidates(baseSlug: string): string[] {
  const forms = equipmentStems(baseSlug).flatMap((stem) => {
    const phrase = equipmentDisplayName(stem);
    return [
      stem,
      normalizeSlug(singularizeIngredientTerm(phrase)),
      normalizeSlug(pluralizeIngredientTerm(phrase)),
    ];
  });

  return uniqueSlugs([
    ...forms,
    ...forms.map((form) => EQUIPMENT_ALIASES[form] ?? ""),
  ]);
}

export function canonicalizeEquipmentName(params: {
  rawName: string;
  ontology: Set<string>;
  ontologyIndex?: OntologyIndex;
}): EquipmentCanonicalizationDecision {
  const baseSlug = normalizeSlug(params.rawName);
  const match = matchSlug({
    baseSlug,
    candidateSlugs: generateEquipmentCandidates(baseSlug),
    ontology: params.ontology,
    ontologyIndex: params.ontologyIndex,
  });

  return { originalName: params.rawName, ...match };
}

export function cookwareFromDecisions(
  decisions: EquipmentCanonicalizationDecision[],
): string[] {
  return [
    ...new Set(
      decisions.map((decision) => equipmentDisplayName(decision.canonicalSlug)),
    ),
  ];
}

export function canonicalizeCookwareList(
  cookware: string[],
  ontology: Set<string>,
  ontologyIndex?: OntologyIndex,
): {
  cookware: string[];
  decisions: EquipmentCanonicalizationDecision[];
} {
  const decisions = cookware
    .flatMap(splitEquipmentAlternatives)
    .map((rawName) =>
      canonicalizeEquipmentName({ rawName, ontology, ontologyIndex }),
    );

  return { cookware: cookwareFromDecisions(decisions), decisions };
}

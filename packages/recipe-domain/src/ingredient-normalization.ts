import { singularizeIngredientTerm } from "./pluralization";
import { normalizeSlug } from "./slugs";

export const TOKEN_FIXUPS: Record<string, string> = {
  clov: "clove",
  flak: "flakes",
  sausag: "sausages",
  veg: "vegetable",
  chili: "chilli",
};

export const EXACT_ALIASES: Record<string, string> = {
  "active-dry-yeast": "dry-yeast",
  "all-purpose-flour": "plain-flour",
  "bay-leaf": "dried-bay-leaves",
  "bay-leaves": "dried-bay-leaves",
  "beef-broth": "beef-stock",
  "cajun-powder": "cajun-seasoning",
  "chicken-fillet": "chicken-breast",
  "chicken-broth": "chicken-stock",
  "chopped-fresh-basil": "fresh-basil",
  "chopped-fresh-cilantro": "fresh-coriander",
  "cider-vinegar": "apple-cider-vinegar",
  cilantro: "fresh-coriander",
  "confectioners-sugar": "icing-sugar",
  "crushed-red-pepper-flakes": "chilli-flakes",
  "dry-bread-crumbs": "bread-crumbs",
  "distilled-white-vinegar": "white-vinegar",
  "garlic-clove": "garlic",
  "red-pepper": "bell-pepper",
  "yellow-pepper": "bell-pepper",
  "green-pepper": "bell-pepper",
  "green-onion": "spring-onion",
  "green-onions": "spring-onion",
  "green-bell-pepper": "bell-pepper",
  "granulated-sugar": "sugar",
  "heavy-whipping-cream": "heavy-cream",
  "ice-cubes": "ice",
  "lemon-juiced": "lemon-juice",
  "lime-juiced": "lime-juice",
  sausage: "pork-sausage",
  tomato: "fresh-tomatoes",
  tomatoes: "fresh-tomatoes",
  parsley: "fresh-parsley",
  cheese: "cheddar-cheese",
  cheddar: "cheddar-cheese",
  "burrito-wrap": "tortilla-wrap",
  scallion: "spring-onion",
  scallions: "spring-onion",
  mayo: "mayonnaise",
  mayonaise: "mayonnaise",
  "neutral-oil": "vegetable-oil",
  "nonstick-cooking-spray": "cooking-spray",
  "quick-cooking-oats": "quick-oats",
  "powdered-sugar": "icing-sugar",
  "red-bell-pepper": "bell-pepper",
  "red-pepper-flakes": "chilli-flakes",
  "rice-vinegar": "rice-wine-vinegar",
  "self-rising-flour": "self-raising-flour",
  "tomato-paste": "tomato-puree",
  "vegetable-broth": "vegetable-stock",
};

function tokenize(slug: string): string[] {
  return slug.split("-").filter(Boolean);
}

function detokenize(tokens: string[]): string {
  return tokens.join("-");
}

export function applyIngredientTokenFixups(tokens: string[]): string[] {
  return tokens.map((token) => TOKEN_FIXUPS[token] ?? token);
}

export function normalizeIngredientSlugForOutput(rawSlug: string): string {
  const baseSlug = normalizeSlug(rawSlug);
  if (!baseSlug) return baseSlug;

  const fixedSlug = detokenize(applyIngredientTokenFixups(tokenize(baseSlug)));
  const exactAlias = EXACT_ALIASES[fixedSlug];
  if (exactAlias) return exactAlias;

  const singularSlug = normalizeSlug(
    singularizeIngredientTerm(fixedSlug.replaceAll("-", " ")),
  );
  const singularAlias = EXACT_ALIASES[singularSlug];
  if (singularAlias) return singularAlias;

  return fixedSlug;
}

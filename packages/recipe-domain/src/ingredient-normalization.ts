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
  "cajun-powder": "cajun-seasoning",
  "chicken-fillet": "chicken-breast",
  "garlic-clove": "garlic",
  "red-pepper": "bell-pepper",
  "yellow-pepper": "bell-pepper",
  "green-pepper": "bell-pepper",
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

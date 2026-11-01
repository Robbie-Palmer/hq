export type CooklangTokenKind =
  | "instruction"
  | "ingredient"
  | "cookware"
  | "timer"
  | "quantity"
  | "unit"
  | "punctuation";

interface CooklangHighlightPattern {
  readonly name: "ingredient" | "cookware" | "timer";
  readonly prefix: "@" | "#" | "~";
  readonly source: string;
  readonly captures: Readonly<Record<number, CooklangTokenKind>>;
}

const ingredient = "ingredient" satisfies CooklangTokenKind;
const cookware = "cookware" satisfies CooklangTokenKind;
const timer = "timer" satisfies CooklangTokenKind;
const quantity = "quantity" satisfies CooklangTokenKind;
const unit = "unit" satisfies CooklangTokenKind;
const punctuation = "punctuation" satisfies CooklangTokenKind;

const ingredientWithQuantityAndUnit = {
  name: "ingredient",
  prefix: "@",
  source: String.raw`(@)([^@#~{}\n]+?)(\{)([^%{}\n]+)(%)([^{}\n]+)(\})`,
  captures: {
    1: punctuation,
    2: ingredient,
    3: punctuation,
    4: quantity,
    5: punctuation,
    6: unit,
    7: punctuation,
  },
} as const satisfies CooklangHighlightPattern;

const ingredientWithQuantity = {
  name: "ingredient",
  prefix: "@",
  source: String.raw`(@)([^@#~{}\n]+?)(\{)([^{}\n]+)(\})`,
  captures: {
    1: punctuation,
    2: ingredient,
    3: punctuation,
    4: quantity,
    5: punctuation,
  },
} as const satisfies CooklangHighlightPattern;

const bracedIngredient = {
  name: "ingredient",
  prefix: "@",
  source: String.raw`(@)([^@#~{}\n]+?)(\{\})`,
  captures: { 1: punctuation, 2: ingredient, 3: punctuation },
} as const satisfies CooklangHighlightPattern;

const shortIngredient = {
  name: "ingredient",
  prefix: "@",
  source: String.raw`(@)([\p{L}\p{N}_'-]+)`,
  captures: { 1: punctuation, 2: ingredient },
} as const satisfies CooklangHighlightPattern;

const bracedCookware = {
  name: "cookware",
  prefix: "#",
  source: String.raw`(#)([^@#~{}\n]+?)(\{\})`,
  captures: { 1: punctuation, 2: cookware, 3: punctuation },
} as const satisfies CooklangHighlightPattern;

const shortCookware = {
  name: "cookware",
  prefix: "#",
  source: String.raw`(#)([\p{L}\p{N}_'-]+)`,
  captures: { 1: punctuation, 2: cookware },
} as const satisfies CooklangHighlightPattern;

const timerWithQuantityAndUnit = {
  name: "timer",
  prefix: "~",
  source: String.raw`(~)([^@#~{}\n]*?)(\{)([^%{}\n]+)(%)([^{}\n]+)(\})`,
  captures: {
    1: timer,
    2: timer,
    3: punctuation,
    4: quantity,
    5: punctuation,
    6: unit,
    7: punctuation,
  },
} as const satisfies CooklangHighlightPattern;

const timerWithQuantity = {
  name: "timer",
  prefix: "~",
  source: String.raw`(~)([^@#~{}\n]*?)(\{)([^{}\n]+)(\})`,
  captures: {
    1: timer,
    2: timer,
    3: punctuation,
    4: quantity,
    5: punctuation,
  },
} as const satisfies CooklangHighlightPattern;

export const COOKLANG_HIGHLIGHT_PATTERNS = [
  ingredientWithQuantityAndUnit,
  ingredientWithQuantity,
  bracedIngredient,
  shortIngredient,
  bracedCookware,
  shortCookware,
  timerWithQuantityAndUnit,
  timerWithQuantity,
] as const satisfies readonly CooklangHighlightPattern[];

export interface CooklangToken {
  readonly start: number;
  readonly end: number;
  readonly kind: CooklangTokenKind;
}

const compiledHighlightPatterns = COOKLANG_HIGHLIGHT_PATTERNS.map(
  (pattern) => ({
    ...pattern,
    expression: new RegExp(pattern.source, "uy"),
  }),
);
const cooklangTokenPrefixes: ReadonlySet<string> = new Set(
  COOKLANG_HIGHLIGHT_PATTERNS.map((pattern) => pattern.prefix),
);

function pushToken(
  tokens: CooklangToken[],
  start: number,
  end: number,
  kind: CooklangTokenKind,
) {
  if (start === end) return;
  const previous = tokens.at(-1);
  if (previous?.end === start && previous.kind === kind) {
    tokens[tokens.length - 1] = { ...previous, end };
    return;
  }
  tokens.push({ start, end, kind });
}

function appendMatchTokens(
  tokens: CooklangToken[],
  match: RegExpExecArray,
  captures: Readonly<Record<number, CooklangTokenKind>>,
  start: number,
) {
  let offset = start;
  for (let index = 1; index < match.length; index += 1) {
    const text = match[index];
    const kind = captures[index];
    if (!text || !kind) continue;
    const captureStart = start + match[0].indexOf(text, offset - start);
    pushToken(tokens, captureStart, captureStart + text.length, kind);
    offset = captureStart + text.length;
  }
}

export function tokenizeCooklang(source: string): CooklangToken[] {
  const tokens: CooklangToken[] = [];
  let instructionStart = 0;
  let cursor = 0;

  while (cursor < source.length) {
    const character = source[cursor];
    if (!character || !cooklangTokenPrefixes.has(character)) {
      cursor += 1;
      continue;
    }

    let matched = false;
    for (const pattern of compiledHighlightPatterns) {
      pattern.expression.lastIndex = cursor;
      const match = pattern.expression.exec(source);
      if (!match) continue;

      pushToken(tokens, instructionStart, cursor, "instruction");
      appendMatchTokens(tokens, match, pattern.captures, cursor);
      cursor += match[0].length;
      instructionStart = cursor;
      matched = true;
      break;
    }
    if (!matched) cursor += 1;
  }

  pushToken(tokens, instructionStart, source.length, "instruction");
  return tokens;
}

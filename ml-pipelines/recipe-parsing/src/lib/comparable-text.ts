const SMALL_NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS_NUMBER_WORDS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALE_NUMBER_WORDS: Record<string, number> = {
  hundred: 100,
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

const ORDINAL_NUMBER_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  thirtieth: 30,
  fortieth: 40,
  fiftieth: 50,
  sixtieth: 60,
  seventieth: 70,
  eightieth: 80,
  ninetieth: 90,
};

const SIGN_WORDS = new Set(["minus", "negative"]);
const CONNECTOR_WORDS = new Set(["and"]);
const ARTICLE_WORDS = new Set(["a", "an"]);
const DECIMAL_WORD = "point";

function isCandidateNumberToken(token: string): boolean {
  return token in SMALL_NUMBER_WORDS ||
    token in TENS_NUMBER_WORDS ||
    token in SCALE_NUMBER_WORDS ||
    token in ORDINAL_NUMBER_WORDS ||
    SIGN_WORDS.has(token) ||
    CONNECTOR_WORDS.has(token) ||
    ARTICLE_WORDS.has(token) ||
    token === DECIMAL_WORD;
}

function parseDigitWord(token: string): number | undefined {
  const small = SMALL_NUMBER_WORDS[token];
  if (small != null && small >= 0 && small <= 9) return small;
  const ordinal = ORDINAL_NUMBER_WORDS[token];
  if (ordinal != null && ordinal >= 0 && ordinal <= 9) return ordinal;
  return undefined;
}

function integerTokenValue(token: string): number | undefined {
  return SMALL_NUMBER_WORDS[token] ??
    TENS_NUMBER_WORDS[token] ??
    ORDINAL_NUMBER_WORDS[token];
}

function isValidArticle(tokens: string[], index: number): boolean {
  const next = tokens[index + 1];
  return next !== undefined &&
    (next in SCALE_NUMBER_WORDS || next === DECIMAL_WORD);
}

interface IntegerParseState {
  total: number;
  current: number;
  sawNumber: boolean;
}

function consumeIntegerToken(
  state: IntegerParseState,
  tokens: string[],
  index: number,
): boolean {
  const token = tokens[index]!;
  if (CONNECTOR_WORDS.has(token)) return true;
  if (ARTICLE_WORDS.has(token)) {
    if (!isValidArticle(tokens, index)) return false;
    state.current += 1;
    state.sawNumber = true;
    return true;
  }

  const value = integerTokenValue(token);
  if (value !== undefined) {
    state.current += value;
    state.sawNumber = true;
    return true;
  }

  const scale = SCALE_NUMBER_WORDS[token];
  if (scale === undefined) return false;
  state.sawNumber = true;
  if (token === "hundred") {
    state.current = (state.current || 1) * scale;
  } else {
    state.total += (state.current || 1) * scale;
    state.current = 0;
  }
  return true;
}

function parseIntegerTokens(tokens: string[]): number | null {
  if (tokens.length === 0) return null;

  const state: IntegerParseState = {
    total: 0,
    current: 0,
    sawNumber: false,
  };

  for (let index = 0; index < tokens.length; index++) {
    if (!consumeIntegerToken(state, tokens, index)) return null;
  }

  return state.sawNumber ? state.total + state.current : null;
}

function parseEnglishNumberTokens(tokens: string[]): number | null {
  if (tokens.length === 0) return null;

  let sign = 1;
  let start = 0;
  if (SIGN_WORDS.has(tokens[0]!)) {
    sign = -1;
    start = 1;
  }

  if (start >= tokens.length) return null;

  const decimalIndex = tokens.indexOf(DECIMAL_WORD, start);
  if (decimalIndex >= 0) {
    const whole = parseIntegerTokens(tokens.slice(start, decimalIndex));
    if (whole == null) return null;

    const decimalDigits = tokens
      .slice(decimalIndex + 1)
      .map(parseDigitWord);

    if (
      decimalDigits.length === 0 ||
      decimalDigits.some((digit) => digit == null)
    ) {
      return null;
    }

    return sign * Number(`${whole}.${decimalDigits.join("")}`);
  }

  const integer = parseIntegerTokens(tokens.slice(start));
  return integer == null ? null : sign * integer;
}

function tokenizeComparableText(text: string): string[] {
  if (!text.trim()) return [];

  return text
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    .replace(/(?<=\p{L})-(?=\p{L})/gu, " ")
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function canonicalizeNumberWordTokens(tokens: string[]): string[] {
  const result: string[] = [];

  for (let index = 0; index < tokens.length;) {
    const token = tokens[index]!;
    if (!isCandidateNumberToken(token)) {
      result.push(token);
      index++;
      continue;
    }

    let runEnd = index;
    while (runEnd < tokens.length && isCandidateNumberToken(tokens[runEnd]!)) {
      runEnd++;
    }

    let matchedEnd = -1;
    let matchedValue: number | null = null;

    for (let end = runEnd; end > index; end--) {
      const value = parseEnglishNumberTokens(tokens.slice(index, end));
      if (value != null) {
        matchedEnd = end;
        matchedValue = value;
        break;
      }
    }

    if (matchedEnd > index && matchedValue != null) {
      // matchedValue is numeric, so String also canonicalizes trailing zeroes.
      result.push(String(matchedValue));
      index = matchedEnd;
      continue;
    }

    result.push(token);
    index++;
  }

  return result;
}

export function normalizeComparableText(text: string): string {
  return canonicalizeNumberWordTokens(tokenizeComparableText(text)).join(" ");
}

export function splitComparableWords(text: string): string[] {
  const normalized = normalizeComparableText(text);
  return normalized.match(/[+-]?\p{N}+(?:\.\p{N}+)?|\p{L}+/gu) ?? [];
}

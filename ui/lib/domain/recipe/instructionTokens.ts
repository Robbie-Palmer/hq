import type {
  RecipeInstructionItem,
  RecipeInstructionSdk,
} from "@/lib/domain/recipe/recipe";

export type InstructionDisplayToken =
  | {
      type: "text";
      value: string;
    }
  | {
      type: "ingredient";
      value: string;
      canonicalName: string;
      amount: number | null;
      unit: string | null;
    }
  | {
      type: "cookware";
      value: string;
    }
  | {
      type: "inlineQuantity";
      value: string;
    }
  | {
      type: "timer";
      value: string;
      durationSeconds: number | null;
    };

export type InstructionTokenizationResult =
  | { ok: true; steps: InstructionDisplayToken[][] }
  | { ok: false; reason: string };

function fromIndex(values: string[], index: number): string | null {
  const value = values[index];
  return typeof value === "string" ? value : null;
}

type DisplayTokenResult =
  | { ok: true; token: InstructionDisplayToken }
  | { ok: false; reason: string };

function indexedDisplayToken(
  values: string[],
  index: number,
  type: "cookware" | "inlineQuantity",
  malformedLabel: string,
): DisplayTokenResult {
  const value = fromIndex(values, index);
  if (value === null) {
    return {
      ok: false,
      reason: `Malformed ${malformedLabel} item index: ${index}`,
    };
  }
  return { ok: true, token: { type, value } };
}

function ingredientToken(
  instructionSdk: RecipeInstructionSdk,
  index: number,
): DisplayTokenResult {
  const canonicalName = fromIndex(instructionSdk.ingredientNames, index);
  if (canonicalName === null) {
    return { ok: false, reason: `Malformed ingredient item index: ${index}` };
  }

  const value = fromIndex(instructionSdk.ingredientDisplayValues, index);
  if (value === null) {
    return {
      ok: false,
      reason: `Malformed ingredient display item index: ${index}`,
    };
  }
  return {
    ok: true,
    token: {
      type: "ingredient",
      value,
      canonicalName,
      amount: instructionSdk.ingredientAmounts[index] ?? null,
      unit: instructionSdk.ingredientUnits[index] ?? null,
    },
  };
}

function timerToken(
  instructionSdk: RecipeInstructionSdk,
  index: number,
): DisplayTokenResult {
  const value = fromIndex(instructionSdk.timerDisplayValues, index);
  if (value === null) {
    return { ok: false, reason: `Malformed timer item index: ${index}` };
  }
  return {
    ok: true,
    token: {
      type: "timer",
      value,
      durationSeconds: instructionSdk.timerDurationSeconds[index] ?? null,
    },
  };
}

function displayTokenForItem(
  item: RecipeInstructionItem,
  instructionSdk: RecipeInstructionSdk,
): DisplayTokenResult {
  switch (item.type) {
    case "text":
      return { ok: true, token: { type: "text", value: item.value } };
    case "ingredient":
      return ingredientToken(instructionSdk, item.index);
    case "cookware":
      return indexedDisplayToken(
        instructionSdk.cookwareDisplayValues,
        item.index,
        "cookware",
        "cookware",
      );
    case "inlineQuantity":
      return indexedDisplayToken(
        instructionSdk.inlineQuantityDisplayValues,
        item.index,
        "inlineQuantity",
        "inline quantity",
      );
    case "timer":
      return timerToken(instructionSdk, item.index);
    default:
      return {
        ok: false,
        reason: `Unknown step item type: ${String((item as { type?: unknown }).type)}`,
      };
  }
}

function trimBoundaryText(tokens: InstructionDisplayToken[]): void {
  while (tokens[0]?.type === "text" && tokens[0].value.trimStart() === "") {
    tokens.shift();
  }
  const first = tokens[0];
  if (first?.type === "text") {
    tokens[0] = { type: "text", value: first.value.trimStart() };
  }

  while (
    tokens.at(-1)?.type === "text" &&
    tokens.at(-1)?.value.trimEnd() === ""
  ) {
    tokens.pop();
  }
  const lastIndex = tokens.length - 1;
  const last = tokens[lastIndex];
  if (last?.type === "text") {
    tokens[lastIndex] = { type: "text", value: last.value.trimEnd() };
  }
}

function tokenizeStep(
  items: RecipeInstructionItem[],
  instructionSdk: RecipeInstructionSdk,
):
  | { ok: true; tokens: InstructionDisplayToken[] }
  | { ok: false; reason: string } {
  const tokens: InstructionDisplayToken[] = [];
  for (const item of items) {
    const result = displayTokenForItem(item, instructionSdk);
    if (!result.ok) return result;
    tokens.push(result.token);
  }
  trimBoundaryText(tokens);
  return { ok: true, tokens };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function tokenizeInstructionSdk(
  instructionSdk: RecipeInstructionSdk,
): InstructionTokenizationResult {
  const steps: InstructionDisplayToken[][] = [];

  for (const section of instructionSdk.sections) {
    for (const content of section.content) {
      if (content.type === "text") {
        continue;
      }

      if (content.type !== "step") {
        return {
          ok: false,
          reason: `Unknown section content type: ${String((content as { type?: unknown }).type)}`,
        };
      }

      const result = tokenizeStep(content.value.items, instructionSdk);
      if (!result.ok) return result;
      if (result.tokens.length > 0) steps.push(result.tokens);
    }
  }

  if (steps.length === 0) {
    return {
      ok: false,
      reason: "No instruction steps produced from SDK sections",
    };
  }

  return { ok: true, steps };
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("openrouter-client", () => ({
  openRouterClient: () => ({ chat: { completions: { create } } }),
}));

const { disambiguateEquipment, disambiguateIngredients } = await import(
  "../../src/lib/openrouter.js"
);

function respondWith(choices: unknown, usage?: Record<string, number>) {
  create.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ choices }) } }],
    usage,
  });
}

function promptOf(callIndex = 0): string {
  return create.mock.calls[callIndex]![0].messages[0].content as string;
}

const unresolvedItems = [
  {
    slug: "oven-thing",
    candidates: [
      { slug: "baking-tray", category: "bakeware" },
      { slug: "oven-dish", category: "bakeware" },
    ],
  },
];

describe("disambiguateEquipment", () => {
  beforeEach(() => {
    create.mockReset();
  });

  it("should prompt with the recipe context and return the parsed choices", async () => {
    respondWith(
      [{ slug: "oven-thing", canonicalSlug: "baking-tray", confidence: "high" }],
      { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    );

    const result = await disambiguateEquipment({
      apiKey: "key",
      unresolvedItems,
      equipmentContext: {
        title: "Traybake",
        cuisine: ["British"],
        otherEquipment: ["frying pan"],
        instructions: ["Roast everything."],
      },
      model: "test-model",
      requestTimeoutMs: 1000,
    });

    expect(result.value).toEqual([
      { slug: "oven-thing", canonicalSlug: "baking-tray", confidence: "high" },
    ]);
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
    });

    const prompt = promptOf();
    expect(prompt).toContain("Traybake");
    expect(prompt).toContain("frying pan");
    expect(prompt).toContain("Roast everything.");
    expect(prompt).toContain(
      '- "oven-thing" → candidates: [baking-tray (bakeware), oven-dish (bakeware)]',
    );
  });

  it("should describe empty context as unknown or none", async () => {
    respondWith([]);

    await disambiguateEquipment({
      apiKey: "key",
      unresolvedItems,
      equipmentContext: {
        title: "Traybake",
        cuisine: [],
        otherEquipment: [],
        instructions: [],
      },
      model: "test-model",
      requestTimeoutMs: 1000,
    });

    const prompt = promptOf();
    expect(prompt).toContain("- Cuisine: unknown");
    expect(prompt).toContain("- Other equipment: none");
  });

  it("should reject a response that does not match the schema", async () => {
    respondWith([{ slug: "oven-thing", canonicalSlug: "baking-tray" }]);

    await expect(
      disambiguateEquipment({
        apiKey: "key",
        unresolvedItems,
        equipmentContext: {
          title: "Traybake",
          cuisine: [],
          otherEquipment: [],
          instructions: [],
        },
        model: "test-model",
        requestTimeoutMs: 1000,
      }),
    ).rejects.toThrow();
  });
});

describe("disambiguateIngredients", () => {
  beforeEach(() => {
    create.mockReset();
  });

  it("should prompt with the ingredient context", async () => {
    respondWith([
      { slug: "pepper", canonicalSlug: "bell-pepper", confidence: "medium" },
    ]);

    const result = await disambiguateIngredients({
      apiKey: "key",
      unresolvedItems: [
        {
          slug: "pepper",
          candidates: [{ slug: "bell-pepper", category: "vegetable" }],
        },
      ],
      recipeContext: {
        title: "Traybake",
        cuisine: ["British"],
        otherIngredients: ["garlic"],
      },
      model: "test-model",
      requestTimeoutMs: 1000,
    });

    expect(result.value[0]?.canonicalSlug).toBe("bell-pepper");
    expect(result.usage).toBeUndefined();

    const prompt = promptOf();
    expect(prompt).toContain("recipe ingredient classifier");
    expect(prompt).toContain("- Other ingredients: garlic");
  });
});

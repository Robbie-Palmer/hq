import { describe, expect, it } from "vitest";
import {
	buildCooklangDraftFromExtraction,
	buildCooklangDraftFromStructuredText,
	deriveRecipeFromCooklang,
	deriveRecipeFromStructuredText,
	extractIngredientSlugsFromBody,
	inferCooklangIngredientLine,
	recipeToCooklang,
} from "../../src/lib/cooklang.js";

describe("cooklang helpers", () => {
	it.each([
		["200g flour", "@flour{200%g}"],
		["200 grams flour", "@flour{200%g}"],
		["2 red onions", "@red onions{2}"],
		["red onions - 2 g sliced", "@red onions{2%g} sliced"],
		["red onions-2 g", "@red onions{2%g}"],
		["flour:2g", "@flour{2%g}"],
		["200 g crème fraîche", "@crème fraîche{200%g}"],
		["1 1/2 cups flour", "@flour{1 1/2%us_cup}"],
		["½ teaspoon salt", "@salt{1/2%tsp}"],
		["1 ½ teaspoons paprika", "@paprika{1 1/2%tsp}"],
		["¾ cup milk", "@milk{3/4%us_cup}"],
		["flour 2.", "@flour{2} ."],
		["flour 2/", "@flour{2} /"],
		["flour 1-2 cups", "@flour 1-2 cups{}"],
		["onions 1–2", "@onions 1–2{}"],
		["1 - 2 cups flour", "@1 - 2 cups flour{}"],
		["red onions 2 sliced", "@red onions{2} sliced"],
		["salt", "@salt{}"],
		["@salt{}", "@salt{}"],
	])("infers a bounded Cooklang token from %s", (line, expected) => {
		expect(inferCooklangIngredientLine(line)).toBe(expected);
	});

	it("round-trips a normalized recipe through Cooklang text", () => {
		const input = {
			title: "Tomato Pasta",
			description: "A quick pasta.",
			cuisine: ["Italian"],
			servings: 2,
			prepTime: 10,
			cookTime: 15,
			ingredientGroups: [
				{
					name: "Sauce",
					items: [
						{ ingredient: "olive-oil", amount: 1, unit: "tbsp" as const },
						{ ingredient: "fresh-tomatoes", amount: 400, unit: "g" as const },
					],
				},
			],
			instructions: [
				"Heat @olive oil{1%tbsp} in a #pan{}.",
				"Simmer for ~{15%minutes}.",
			],
			cookware: ["pan"],
		};

		const cooklang = recipeToCooklang(input);
		const derived = deriveRecipeFromCooklang(cooklang);

		expect(derived.derived).toEqual({
			title: input.title,
			description: input.description,
			cuisine: input.cuisine,
			servings: input.servings,
			prepTime: input.prepTime,
			cookTime: input.cookTime,
			ingredientGroups: [
				{
					name: "Sauce",
					items: [
						// The instruction is a back-reference, so only the declaration counts.
						{ ingredient: "olive-oil", amount: 1, unit: "tbsp" },
						{ ingredient: "fresh-tomatoes", amount: 400, unit: "g" },
					],
				},
			],
			instructions: ["Heat olive oil in a pan.", "Simmer for 15 minutes."],
			cookware: ["pan"],
		});
	});

	it("builds a deterministic Cooklang draft from structured text", () => {
		const cooklang = buildCooklangDraftFromStructuredText({
			title: "Traybake",
			description: "Roast everything together.",
			servingsText: "4",
			prepTimeText: "15",
			cookTimeText: "45",
			ingredientSections: [
				{
					name: "Main",
					lines: ["@chicken thighs{4%piece}", "@potatoes{600%g}"],
				},
			],
			instructionLines: ["1. Roast the tray for ~{45%minutes}."],
			notes: [],
			equipment: ["tray"],
			timers: [],
		});

		expect(cooklang.frontmatter.servings).toBe(4);
		expect(cooklang.derived?.ingredientGroups[0]?.items[0]?.ingredient).toBe(
			"chicken-thighs",
		);
		expect(cooklang.derived?.instructions[0]).toBe(
			"Roast the tray for 45 minutes.",
		);
		expect(cooklang.derived?.cookware).toEqual(["tray"]);
	});

	it("separates fallback extraction instructions into distinct Cooklang steps", () => {
		const cooklang = buildCooklangDraftFromExtraction({
			title: "Traybake",
			description: "Roast everything together.",
			cuisine: [],
			servings: "4",
			prepTime: "15",
			cookTime: "45",
			ingredientGroups: [
				{
					name: "Main",
					lines: ["4 chicken thighs", "600g potatoes"],
				},
			],
			instructions: [
				"1. Roast the tray for 45 minutes.",
				"2. Rest before serving.",
			],
			equipment: ["tray"],
		});

		expect(cooklang.derived?.instructions).toEqual([
			"Roast the tray for 45 minutes.",
			"Rest before serving.",
		]);
	});

	it("keeps invalid spaced units as ingredient descriptors", () => {
		const cooklang = buildCooklangDraftFromStructuredText({
			title: "Omelette",
			description: "Simple eggs.",
			servingsText: "1",
			ingredientSections: [{ lines: ["2 large eggs"] }],
			instructionLines: ["Whisk eggs."],
			notes: [],
			equipment: [],
			timers: [],
		});

		expect(cooklang.derived?.ingredientGroups[0]?.items[0]).toEqual({
			ingredient: "large-eggs",
			amount: 2,
		});
	});

	it("normalizes oz and bag units from structured ingredient lines", () => {
		const cooklang = buildCooklangDraftFromExtraction({
			title: "Mac and Cheese",
			description: "Quick stovetop version.",
			cuisine: [],
			servings: "2",
			ingredientGroups: [
				{
					name: "Main",
					lines: ["8oz cheddar cheese", "2 bags spinach"],
				},
			],
			instructions: ["Cook everything together."],
			equipment: [],
		});

		expect(cooklang.derived?.ingredientGroups[0]?.items).toEqual([
			{ ingredient: "cheddar-cheese", amount: 8, unit: "oz" },
			{ ingredient: "spinach", amount: 2, unit: "bag" },
		]);
	});

	it("normalizes can units to tin from structured ingredient lines", () => {
		const cooklang = buildCooklangDraftFromExtraction({
			title: "Tomato Soup",
			description: "Pantry version.",
			cuisine: [],
			servings: "2",
			ingredientGroups: [
				{
					name: "Main",
					lines: ["1 can chopped tomatoes"],
				},
			],
			instructions: ["Cook everything together."],
			equipment: [],
		});

		expect(cooklang.derived?.ingredientGroups[0]?.items).toEqual([
			{ ingredient: "chopped-tomatoes", amount: 1, unit: "tin" },
		]);
	});

	it("normalizes plural and full-word units from structured ingredient lines", () => {
		const cooklang = buildCooklangDraftFromExtraction({
			title: "Pantry Mix",
			description: "Unit coverage.",
			cuisine: [],
			servings: "2",
			ingredientGroups: [
				{
					name: "Main",
					lines: [
						"200 grams flour",
						"2 kilograms potatoes",
						"3 litres stock",
						"2 pints milk",
						"2 tbsps sugar",
						"3 tsps salt",
						"4 cloves garlic",
						"3 slices bread",
					],
				},
			],
			instructions: ["Cook everything together."],
			equipment: [],
		});

		expect(cooklang.derived?.ingredientGroups[0]?.items).toEqual([
			{ ingredient: "flour", amount: 200, unit: "g" },
			{ ingredient: "potatoes", amount: 2, unit: "kg" },
			{ ingredient: "stock", amount: 3, unit: "l" },
			{ ingredient: "milk", amount: 2, unit: "uk_pint" },
			{ ingredient: "sugar", amount: 2, unit: "tbsp" },
			{ ingredient: "salt", amount: 3, unit: "tsp" },
			{ ingredient: "garlic", amount: 4, unit: "clove" },
			{ ingredient: "bread", amount: 3, unit: "slice" },
		]);
	});

	it("dedupes quantified and bare Cooklang ingredients by normalized name", () => {
		const derived = deriveRecipeFromCooklang({
			frontmatter: {
				title: "Toast",
				description: "Buttered toast.",
				servings: 1,
				tags: [],
			},
			body: "@olive oil{1%tbsp} @olive oil{}\nServe.",
			diagnostics: [],
		});

		expect(derived.derived?.ingredientGroups[0]?.items).toEqual([
			{ ingredient: "olive-oil", amount: 1, unit: "tbsp" },
		]);
	});

	it("suppresses declared references but keeps inline-only ingredients", () => {
		const derived = deriveRecipeFromCooklang({
			frontmatter: {
				title: "Fried Noodles",
				description: "Quick fried noodles.",
				servings: 2,
				tags: [],
			},
			body: [
				"== Main ==",
				"Cook the @chicken breast{2}.",
				"",
				"@dried noodles{250%g}",
				"",
				"== Sauce ==",
				"@soy sauce{2%tbsp}",
				"",
				"Cook the @dried noodles{}.",
				"",
				"Stir in the @soy sauce{2%tbsp}.",
				"",
				"Drizzle over @sesame oil{1%tbsp}.",
			].join("\n"),
			diagnostics: [],
		});

		expect(derived.derived?.ingredientGroups).toEqual([
			{
				name: "Main",
				items: [
					{ ingredient: "chicken-breast", amount: 2 },
					{ ingredient: "dried-noodles", amount: 250, unit: "g" },
				],
			},
			{
				name: "Sauce",
				items: [
					{ ingredient: "soy-sauce", amount: 2, unit: "tbsp" },
					{ ingredient: "sesame-oil", amount: 1, unit: "tbsp" },
				],
			},
		]);
	});

	it("drops groups left empty after declaration suppression", () => {
		const derived = deriveRecipeFromCooklang({
			frontmatter: {
				title: "Steamed Rice",
				description: "Plain steamed rice.",
				servings: 2,
				tags: [],
			},
			body: [
				"== Ingredients ==",
				"@rice{200%g}",
				"",
				"== Method ==",
				"Cook the @rice{}.",
			].join("\n"),
			diagnostics: [],
		});

		expect(derived.derived?.ingredientGroups).toEqual([
			{
				name: "Ingredients",
				items: [{ ingredient: "rice", amount: 200, unit: "g" }],
			},
		]);
	});

	it("postprocesses safe ingredient aliases in derived output", () => {
		const derived = deriveRecipeFromCooklang({
			frontmatter: {
				title: "Pasta",
				description: "Cheesy pasta.",
				servings: 2,
				tags: [],
			},
			body: "@cheddar{80%g}\n@chicken fillets{2%piece}\n@garlic powder{1%tsp}\n@cajun powder{1%tbsp}\n\nCook and stir—serve.",
			diagnostics: [],
		});

		expect(derived.derived?.ingredientGroups[0]?.items).toEqual([
			{ ingredient: "cheddar-cheese", amount: 80, unit: "g" },
			{ ingredient: "chicken-breast", amount: 2, unit: "piece" },
			{ ingredient: "garlic-powder", amount: 1, unit: "tsp" },
			{ ingredient: "cajun-seasoning", amount: 1, unit: "tbsp" },
		]);
		expect(derived.derived?.instructions).toEqual(["Cook and stir-serve."]);
	});

	it("drops zero-valued times from derived output", () => {
		const derived = deriveRecipeFromCooklang({
			frontmatter: {
				title: "Paella",
				description: "Rice dish.",
				servings: 4,
				prepTime: 0,
				cookTime: 38,
				tags: [],
			},
			body: "@rice{300%g}\n\nCook gently.",
			diagnostics: [],
		});

		expect(derived.derived?.prepTime).toBeUndefined();
		expect(derived.derived?.cookTime).toBe(38);
	});

	it("splits non-allowlisted hyphenated cuisines in derived output", () => {
		const derived = deriveRecipeFromCooklang({
			frontmatter: {
				title: "Alfredo",
				description: "Creamy pasta.",
				servings: 2,
				cuisine: ["Italian-American"],
				tags: [],
			},
			body: "@pasta{200%g}\n\nCook pasta.",
			diagnostics: [],
		});

		expect(derived.derived?.cuisine).toEqual(["Italian", "American"]);
	});

	it("can derive a best-effort normalized recipe directly from structured text", () => {
		const derived = deriveRecipeFromStructuredText({
			title: "Cajun Sausage Pasta",
			ingredientSections: [
				{
					lines: [
						"320g pasta",
						"6 sausages",
						"4 tomatoes - diced",
						"2 tbsp tomato puree",
					],
				},
			],
			instructionLines: ["1) Cook pasta.", "2) Stir through the sauce."],
			notes: [],
			equipment: [],
			timers: [],
		});

		expect(derived.recipe?.title).toBe("Cajun Sausage Pasta");
		expect(derived.recipe?.servings).toBe(1);
		expect(derived.recipe?.ingredientGroups[0]?.items[0]?.ingredient).toBe(
			"pasta",
		);
		expect(derived.recipe?.instructions[0]).toBe("Cook pasta.");
		expect(derived.recipe?.cookware).toEqual([]);
		expect(derived.diagnostics).toContain(
			"Structured extraction inferred missing servings as 1.",
		);
	});

	it("diagnoses explicit serving inference for unparseable structured servings", () => {
		const derived = deriveRecipeFromStructuredText({
			title: "Soup",
			servingsText: "many",
			ingredientSections: [{ lines: ["1 onion"] }],
			instructionLines: ["Cook onion."],
			notes: [],
			equipment: [],
			timers: [],
		});

		expect(derived.recipe?.servings).toBe(1);
		expect(derived.diagnostics).toContain(
			"Structured extraction inferred unparseable servings as 1.",
		);
	});

	it("merges ingredientAnnotations into derived ingredients", () => {
		const derived = deriveRecipeFromCooklang({
			frontmatter: {
				title: "Stir Fry",
				description: "Quick stir fry.",
				servings: 2,
				tags: [],
				ingredientAnnotations: {
					"chicken-breast": { preparation: "sliced" },
					"bell-pepper": { preparation: "chopped", note: "any color" },
				},
			},
			body: "@chicken breast{500%g}\n@bell pepper{2%piece}\nStir fry everything.",
			diagnostics: [],
		});

		const items = derived.derived!.ingredientGroups[0]!.items;
		expect(items[0]).toEqual({
			ingredient: "chicken-breast",
			amount: 500,
			unit: "g",
			preparation: "sliced",
		});
		expect(items[1]).toEqual({
			ingredient: "bell-pepper",
			amount: 2,
			unit: "piece",
			preparation: "chopped",
			note: "any color",
		});
	});

	it("ignores annotations for ingredients not in the body", () => {
		const derived = deriveRecipeFromCooklang({
			frontmatter: {
				title: "Simple",
				description: "Simple recipe.",
				servings: 1,
				tags: [],
				ingredientAnnotations: {
					"olive-oil": { preparation: "extra virgin" },
					"ghost-ingredient": { preparation: "diced" },
				},
			},
			body: "@olive oil{1%tbsp}\nDrizzle oil.",
			diagnostics: [],
		});

		const items = derived.derived!.ingredientGroups[0]!.items;
		expect(items).toHaveLength(1);
		expect(items[0]!.preparation).toBe("extra virgin");
	});

	it("round-trips ingredient annotations through recipeToCooklang", () => {
		const input = {
			title: "Salad",
			description: "Fresh salad.",
			cuisine: [],
			servings: 1,
			ingredientGroups: [
				{
					items: [
						{
							ingredient: "tomatoes" as const,
							amount: 2,
							unit: "piece" as const,
							preparation: "diced",
						},
						{
							ingredient: "feta-cheese" as const,
							amount: 100,
							unit: "g" as const,
							note: "optional",
						},
					],
				},
			],
			instructions: ["Combine ingredients."],
			cookware: [],
		};

		const cooklang = recipeToCooklang(input);
		expect(cooklang.frontmatter.ingredientAnnotations).toEqual({
			tomatoes: { preparation: "diced" },
			"feta-cheese": { note: "optional" },
		});

		const derived = deriveRecipeFromCooklang(cooklang);
		expect(derived.derived!.ingredientGroups[0]!.items[0]!.preparation).toBe(
			"diced",
		);
		expect(derived.derived!.ingredientGroups[0]!.items[1]!.note).toBe(
			"optional",
		);
	});

	it("handles paragraph-format body with inline ingredients", () => {
		const derived = deriveRecipeFromCooklang({
			frontmatter: {
				title: "Jambalaya",
				description: "Spicy rice dish.",
				servings: 4,
				tags: [],
				ingredientAnnotations: {
					"pork-sausages": { preparation: "cut into pieces" },
				},
			},
			body: "Heat @olive oil{1%tbsp} in a pan. Add @pork sausages{8%piece} and brown them. Add @rice{200%g} and stir.",
			diagnostics: [],
		});

		expect(derived.diagnostics).toEqual([]);
		// Ingredients extracted from inline annotations
		const items = derived.derived!.ingredientGroups[0]!.items;
		expect(items).toHaveLength(3);
		expect(items[0]).toMatchObject({
			ingredient: "olive-oil",
			amount: 1,
			unit: "tbsp",
		});
		expect(items[1]).toMatchObject({
			ingredient: "pork-sausages",
			amount: 8,
			unit: "piece",
			preparation: "cut into pieces",
		});
		expect(items[2]).toMatchObject({
			ingredient: "rice",
			amount: 200,
			unit: "g",
		});
		// Parser treats paragraph as a single step/instruction
		expect(derived.derived!.instructions).toHaveLength(1);
		expect(derived.derived!.instructions[0]).toContain(
			"Heat olive oil in a pan.",
		);
		expect(derived.derived!.instructions[0]).toContain(
			"Add pork sausages and brown them.",
		);
		expect(derived.derived!.instructions[0]).toContain("Add rice and stir.");
	});

	it("extracts ingredient slugs from body text", () => {
		const body =
			"@chicken breast{500%g}\n@olive oil{1%tbsp}\n@salt\nCook everything.";
		const slugs = extractIngredientSlugsFromBody(body);
		expect(slugs.sort()).toEqual(["chicken-breast", "olive-oil", "salt"]);
	});
});

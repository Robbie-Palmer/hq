import assert from "node:assert/strict";
import test from "node:test";
import {
  CooklangParser,
  getFlatCookware,
  getFlatIngredients,
  getFlatTimers,
  quantity_display,
} from "@cooklang/cooklang";

test("Cooklang exposes the parser contract used by dataset preparation", () => {
  const source = `---
title: Parser contract
servings: 2
---
Mix @flour{100%g} and @?chives{} in a #bowl{} for ~{5%minutes}.
`;

  const [recipe, diagnostics] = new CooklangParser().parse(source);

  assert.equal(diagnostics, "");
  assert.equal(recipe.title, "Parser contract");
  assert.equal(recipe.servings, 2);
  assert.equal(quantity_display(recipe.ingredients[0].quantity), "100 g");
  assert.deepEqual(getFlatIngredients(recipe), [
    {
      name: "flour",
      quantity: 100,
      unit: "g",
      displayText: "100 g",
      note: null,
    },
    {
      name: "chives",
      quantity: null,
      unit: null,
      displayText: null,
      note: null,
    },
  ]);
  assert.deepEqual(getFlatCookware(recipe), [
    {
      name: "bowl",
      quantity: null,
      displayText: null,
      note: null,
    },
  ]);
  assert.deepEqual(getFlatTimers(recipe), [
    {
      name: null,
      quantity: 5,
      unit: "minutes",
      displayText: "5 minutes",
    },
  ]);
});

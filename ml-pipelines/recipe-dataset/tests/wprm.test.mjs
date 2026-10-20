import assert from "node:assert/strict";
import test from "node:test";
import { parseWprmRecipe } from "../src/lib/wprm.mjs";

const ingredientTable = `
  <div class="wprm-recipe-ingredient-group">
    <h4 class="wprm-recipe-ingredient-group-name">50 Servings</h4>
  </div>
  <div class="wprm-recipe-ingredient-group">
    <h4 class="wprm-recipe-ingredient-group-name">Weight</h4>
    <ul><li class="wprm-recipe-ingredient">
      <span class="wprm-recipe-ingredient-amount">7</span>
      <span class="wprm-recipe-ingredient-unit">lb</span>
      <span class="wprm-recipe-ingredient-name">tomatoes, canned</span>
    </li><li class="wprm-recipe-ingredient">
      <span class="wprm-recipe-ingredient-amount">3 cups</span>
      <span class="wprm-recipe-ingredient-unit">2 Tbsp</span>
      <span class="wprm-recipe-ingredient-name">stock</span>
    </li></ul>
  </div>`;

test("extracts WPRM sections, structured ingredients, equipment, and metadata", () => {
  const parsed = parseWprmRecipe(`
    <div class="wprm-recipe-container">
      <div class="wprm-recipe-summary">A batch recipe.</div>
      ${ingredientTable}
      ${ingredientTable}
      <div class="wprm-recipe-instruction-group">
        <h4 class="wprm-recipe-instruction-group-name">Method</h4>
        <div class="wprm-recipe-instruction-text">Mix well.</div>
      </div>
      <li class="wprm-recipe-equipment">Stock pot</li>
      <div class="wprm-recipe-prep-time-container">
        <span class="wprm-recipe-details">30<span> minutes</span></span>
        <span class="wprm-recipe-details-unit">mins</span>
      </div>
      <div class="wprm-user-rating" data-average="4.5" data-count="8"></div>
      <div class="wprm-recipe-notes"><span>Use low-sodium tomatoes.</span></div>
    </div>
  `);

  assert.equal(parsed.description, "A batch recipe.");
  assert.deepEqual(parsed.ingredientSections, [
    {
      name: "50 Servings / Weight",
      items: [
        {
          text: "7 lb tomatoes, canned",
          name: "tomatoes, canned",
          quantity: "7",
          unit: "lb",
        },
        {
          text: "3 cups 2 Tbsp stock",
          name: "stock",
          quantity: "3 cups 2 Tbsp",
          unit: undefined,
        },
      ],
    },
  ]);
  assert.deepEqual(parsed.instructionSections, [
    { name: "Method", items: ["Mix well."] },
  ]);
  assert.deepEqual(parsed.equipment, ["Stock pot"]);
  assert.equal(parsed.metadata.prepTime, "30 mins");
  assert.deepEqual(parsed.metadata.yields, ["50 Servings"]);
  assert.deepEqual(parsed.metadata.rating, { value: "4.5", count: "8" });
  assert.deepEqual(parsed.metadata.notes, ["Use low-sodium tomatoes."]);
});

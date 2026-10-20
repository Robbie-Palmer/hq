import * as cheerio from "cheerio";

function elementText($, element) {
  return $(element).text().replace(/\s+/g, " ").trim();
}

function uniqueSections(sections) {
  const seen = new Set();
  return sections.filter((section) => {
    const signature = JSON.stringify(section);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function parseWprmRecipe(html) {
  const $ = cheerio.load(html);
  const root = $(".wprm-recipe-container").first();
  const scope = root.length ? root : $.root();
  let servingHeading;
  const yields = [];
  const ingredientSections = [];
  scope.find(".wprm-recipe-ingredient-group").each((_, group) => {
    const element = $(group);
    const heading = elementText(
      $,
      element.children(".wprm-recipe-ingredient-group-name").first(),
    );
    const ingredients = element
      .find(".wprm-recipe-ingredient")
      .toArray()
      .map((ingredient) => {
        const entry = $(ingredient);
        const amount = elementText(
          $,
          entry.find(".wprm-recipe-ingredient-amount").first(),
        );
        const unit = elementText(
          $,
          entry.find(".wprm-recipe-ingredient-unit").first(),
        );
        const name = elementText(
          $,
          entry.find(".wprm-recipe-ingredient-name").first(),
        );
        const simpleUnit = unit && !/[\d¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/u.test(unit);
        const simpleAmount = amount && !/[A-Za-z]/.test(amount);
        const quantity = simpleAmount && simpleUnit
          ? amount
          : [amount, unit].filter((part) => part && part !== "-").join(" ");
        return {
          text: elementText($, ingredient),
          name: name || undefined,
          quantity: quantity || undefined,
          unit: simpleAmount && simpleUnit ? unit : undefined,
        };
      })
      .filter((ingredient) => ingredient.text);
    if (!ingredients.length) {
      if (heading) {
        servingHeading = heading;
        if (/\b(?:servings?|yield)\b/i.test(heading)) yields.push(heading);
      }
      return;
    }
    const name = [servingHeading, heading].filter(Boolean).join(" / ");
    ingredientSections.push({ ...(name ? { name } : {}), items: ingredients });
  });

  const instructionSections = scope
    .find(".wprm-recipe-instruction-group")
    .toArray()
    .flatMap((group) => {
      const element = $(group);
      const name = elementText(
        $,
        element.children(".wprm-recipe-instruction-group-name").first(),
      );
      const items = element
        .find(".wprm-recipe-instruction-text")
        .toArray()
        .map((step) => elementText($, step))
        .filter(Boolean);
      return items.length ? [{ ...(name ? { name } : {}), items }] : [];
    });
  if (!instructionSections.length) {
    const items = scope
      .find(".wprm-recipe-instruction")
      .toArray()
      .map((step) => elementText($, step))
      .filter(Boolean);
    if (items.length) instructionSections.push({ items });
  }

  const time = (kind) => {
    const container = scope.find(`.wprm-recipe-${kind}-time-container`).first();
    const amount = elementText($, container.find(".wprm-recipe-details").first()).replace(
      /\s+(minutes?|hours?)$/i,
      "",
    );
    const unit = elementText($, container.find(".wprm-recipe-details-unit").first());
    return [amount, unit].filter(Boolean).join(" ");
  };
  const rating = scope.find(".wprm-user-rating").first();
  const ratingValue =
    rating.attr("data-average") ||
    elementText($, scope.find(".wprm-recipe-rating-average").first());
  const ratingCount =
    rating.attr("data-count") ||
    elementText($, scope.find(".wprm-recipe-rating-count").first());
  return {
    description: elementText($, scope.find(".wprm-recipe-summary").first()),
    ingredientSections: uniqueSections(ingredientSections),
    instructionSections: uniqueSections(instructionSections),
    equipment: [
      ...new Set(
        scope
          .find(".wprm-recipe-equipment")
          .toArray()
          .map((item) => elementText($, item))
          .filter(Boolean),
      ),
    ],
    metadata: {
      prepTime: time("prep"),
      cookTime: time("cook"),
      totalTime: time("total"),
      yields: [...new Set(yields)],
      notes: scope
        .find(".wprm-recipe-notes > *")
        .toArray()
        .map((note) => elementText($, note))
        .filter(Boolean),
      rating: ratingValue
        ? { value: ratingValue, count: ratingCount || undefined }
        : undefined,
    },
  };
}

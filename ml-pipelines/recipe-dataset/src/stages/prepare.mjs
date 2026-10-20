import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  CooklangParser,
  getFlatCookware,
  getFlatIngredients,
  getFlatTimers,
  quantity_display,
} from "@cooklang/cooklang";
import {
  createExtractedRecipe,
  toLegacyRecipe,
} from "../lib/extracted-recipe.mjs";
import { parseWprmRecipe } from "../lib/wprm.mjs";

const projectRoot = new URL("../..", import.meta.url).pathname;
const raw = `${projectRoot}/data/raw`;
const outputs = `${projectRoot}/outputs`;
const sourceCatalog = JSON.parse(await readFile(`${projectRoot}/sources.json`, "utf8"));
const sourcesById = new Map(sourceCatalog.map((source) => [source.id, source]));
const snapshot = JSON.parse(await readFile(`${projectRoot}/snapshot.json`, "utf8"));
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.retrievedAt)) {
  throw new Error("snapshot.json retrievedAt must use YYYY-MM-DD format");
}
await mkdir(outputs, { recursive: true });
const recipesTemporary = `${outputs}/recipes.jsonl.part`;
const rejectsTemporary = `${outputs}/rejects.jsonl.part`;
const extractedRecipesTemporary = `${outputs}/extracted-recipes.jsonl.part`;
const recipes = createWriteStream(recipesTemporary, { encoding: "utf8" });
const rejects = createWriteStream(rejectsTemporary, { encoding: "utf8" });
const extractedRecipes = createWriteStream(extractedRecipesTemporary, { encoding: "utf8" });
const gutenbergCandidatesTemporary = `${outputs}/gutenberg-candidates.jsonl.part`;
const gutenbergCandidates = createWriteStream(gutenbergCandidatesTemporary, { encoding: "utf8" });
const ingredientOnlyTemporary = `${outputs}/ingredient-only.jsonl.part`;
const ingredientOnly = createWriteStream(ingredientOnlyTemporary, { encoding: "utf8" });
let accepted = 0;
let rejected = 0;
let extracted = 0;

function catalogSource(id) {
  const source = sourcesById.get(id);
  if (!source) throw new Error(`Unknown source dataset: ${id}`);
  return source;
}

function emitReject(source, error, value) {
  rejects.write(`${JSON.stringify({ sourceDataset: source.id, error: error.message, value })}\n`);
  rejected += 1;
}

function strings(value) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function instructionText(value) {
  return typeof value === "string"
    ? value.replace(/^\s*\d+[.)]\s*/, "").trim()
    : "";
}

function stripTags(value) {
  let text = "";
  let insideTag = false;
  for (const character of String(value || "")) {
    if (character === "<") {
      insideTag = true;
      if (text && !text.endsWith(" ")) text += " ";
    }
    else if (character === ">") insideTag = false;
    else if (!insideTag) text += character;
  }
  return text;
}

function htmlText(value) {
  const entities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return stripTags(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

function schemaInstructionTexts(value) {
  let items = [];
  if (Array.isArray(value)) items = value;
  else if (value != null) items = [value];
  return items.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object") return [];
    if (typeof item.text === "string") return [item.text];
    return schemaInstructionTexts(item.itemListElement);
  });
}

function schemaInstructionEntry(entry) {
  if (typeof entry === "string") return { ungrouped: [entry] };
  if (!entry || typeof entry !== "object") return {};
  const sectionItems = schemaInstructionTexts(entry.itemListElement);
  if (sectionItems.length) {
    return { section: { name: entry.name, items: sectionItems } };
  }
  return typeof entry.text === "string" ? { ungrouped: [entry.text] } : {};
}

function schemaInstructionSections(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const normalized = values.map(schemaInstructionEntry);
  const sections = normalized.flatMap(({ section }) =>
    section ? [section] : [],
  );
  const ungrouped = normalized.flatMap(({ ungrouped: items }) => items ?? []);
  return ungrouped.length ? [{ items: ungrouped }, ...sections] : sections;
}

function schemaParties(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap((entry) => {
    if (typeof entry === "string") return entry.trim() ? [{ name: entry.trim() }] : [];
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string") return [];
    return [{ name: entry.name, url: typeof entry.url === "string" ? entry.url : undefined }];
  });
}

function schemaImages(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (entry && typeof entry === "object" && typeof entry.url === "string") return [entry.url];
    return [];
  });
}

function ingredientSectionsFromLines(value) {
  const sections = [];
  let current = { items: [] };
  for (const line of strings(value)) {
    if (line.endsWith(":")) {
      if (current.items.length) sections.push(current);
      current = { name: line.slice(0, -1).trim(), items: [] };
    } else {
      current.items.push(line);
    }
  }
  if (current.items.length) sections.push(current);
  return sections;
}

function emit(source, value) {
  try {
    const recipe = createExtractedRecipe(source, snapshot, value);
    extractedRecipes.write(`${JSON.stringify(recipe)}\n`);
    recipes.write(`${JSON.stringify(toLegacyRecipe(recipe, value))}\n`);
    accepted += 1;
    extracted += 1;
  } catch (error) {
    emitReject(source, error, value);
  }
}

function emitIngredientsOnly(source, value) {
  try {
    const recipe = createExtractedRecipe(source, snapshot, value, {
      completeness: "ingredients-only",
    });
    extractedRecipes.write(`${JSON.stringify(recipe)}\n`);
    extracted += 1;
  } catch (error) {
    emitReject(source, error, value);
  }
}

async function linesFromStream(stream, callback) {
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (line.trim()) callback(JSON.parse(line));
  }
}

const kaggle = catalogSource("kaggle-64k");
const unzip = spawn("/usr/bin/unzip", ["-p", `${raw}/kaggle-64k/archive.zip`, "2_Recipe_json.json"]);
const unzipClosed = new Promise((resolve, reject) => {
  unzip.on("close", resolve);
  unzip.on("error", reject);
});
await linesFromStream(unzip.stdout, (row) => {
  const sourceChecksum = createHash("sha256").update(JSON.stringify(row)).digest("hex");
  emit(kaggle, {
    sourceRecordId: sourceChecksum,
    sourceChecksum,
    title: row.recipe_title,
    description: row.description,
    metadata: { categories: [row.category, row.subcategory] },
    ingredientGroups: [{ items: row.ingredients }],
    instructions: row.directions,
  });
});
if ((await unzipClosed) !== 0) throw new Error("unzip failed");

const myplate = catalogSource("usda-myplate");
await linesFromStream(createReadStream(`${raw}/usda-myplate/recipes.jsonl`), (row) => {
  const recipe = row.recipe;
  emit(myplate, {
    sourceRecordId: new URL(row.sourceUrl).pathname.split("/").pop(),
    sourceUrl: row.sourceUrl,
    sourceChecksum: row.sourceChecksum,
    title: recipe.name,
    description: recipe.description,
    ingredientSections: ingredientSectionsFromLines(recipe.recipeIngredient),
    instructionSections: schemaInstructionSections(recipe.recipeInstructions),
    metadata: {
      cuisines: recipe.recipeCuisine,
      categories: recipe.recipeCategory,
      tags: typeof recipe.keywords === "string"
        ? recipe.keywords.split(",").map((item) => item.trim())
        : recipe.keywords,
      servings: recipe.recipeYield,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      totalTime: recipe.totalTime,
      authors: schemaParties(recipe.author),
      publishers: schemaParties(recipe.publisher),
      sourceOrganizations: schemaParties(recipe.sourceOrganization),
      datePublished: recipe.datePublished,
      images: schemaImages(recipe.image),
      rating: recipe.aggregateRating && {
        value: recipe.aggregateRating.ratingValue,
        count: recipe.aggregateRating.ratingCount,
        best: recipe.aggregateRating.bestRating,
        worst: recipe.aggregateRating.worstRating,
      },
      nutrition: recipe.nutrition,
      sourceMetadata: {
        isBasedOn: recipe.isBasedOn,
        isAccessibleForFree: recipe.isAccessibleForFree,
      },
    },
  });
});

const wikibooks = catalogSource("wikibooks-cookbook");
const wikibooksRows = JSON.parse(await readFile(`${raw}/wikibooks-cookbook/recipes_parsed.json`, "utf8"));
for (const row of wikibooksRows) {
  const data = row.recipe_data;
  const linesBySection = new Map();
  for (const line of data.text_lines) {
    if (!line.section) continue;
    const sectionLines = linesBySection.get(line.section) || [];
    sectionLines.push(line);
    linesBySection.set(line.section, sectionLines);
  }
  const mixedRecipeSections = new Set(
    [...linesBySection]
      .filter(
        ([section, lines]) =>
          !/note|equipment|warning|reference|external|conversion|use/i.test(section) &&
          lines.some((line) => line.line_type === "ul") &&
          lines.some((line) => line.line_type === "ol"),
      )
      .map(([section]) => section),
  );
  const firstUnsectionedInstruction = data.text_lines.findIndex(
    (line) => !line.section && line.line_type === "ol",
  );
  const ingredientSections = [...linesBySection].flatMap(([section, lines]) => {
    const items = lines
      .filter((line) =>
        (/ingredient/i.test(section) && ["ul", "ol", "p"].includes(line.line_type)) ||
        (mixedRecipeSections.has(section) && line.line_type === "ul"),
      )
      .map((line) => line.text);
    return items.length ? [{ name: section, items }] : [];
  });
  const unsectionedIngredients = data.text_lines
    .filter(
      (line, index) =>
        firstUnsectionedInstruction >= 0 &&
        index < firstUnsectionedInstruction &&
        !line.section &&
        line.line_type === "ul",
    )
    .map((line) => line.text);
  if (unsectionedIngredients.length) ingredientSections.unshift({ items: unsectionedIngredients });
  const equipment = data.text_lines
    .filter(
      (line) =>
        /equipment|utensil|cookware/i.test(line.section || "") &&
        ["ul", "ol", "p"].includes(line.line_type),
    )
    .map((line) => line.text);
  const instructionSections = [...linesBySection].flatMap(([section, lines]) => {
    const items = lines
      .filter((line) =>
        (/procedure|instruction|direction|method|preparation|process|^recipe$/i.test(section) &&
          ["ol", "ul", "p"].includes(line.line_type)) ||
        (mixedRecipeSections.has(section) && line.line_type === "ol"),
      )
      .map((line) => instructionText(line.text))
      .filter(Boolean);
    return items.length ? [{ name: section, items }] : [];
  });
  const unsectionedInstructions = data.text_lines
    .filter((line) => !line.section && line.line_type === "ol")
    .map((line) => instructionText(line.text))
    .filter(Boolean);
  if (unsectionedInstructions.length) instructionSections.unshift({ items: unsectionedInstructions });
  const notes = data.text_lines
    .filter((line) => /note|tip|variation|warning/i.test(line.section || ""))
    .map((line) => line.text)
    .filter(Boolean);
  const description = data.text_lines
    .filter((line) => !line.section && ["p", "blockquote"].includes(line.line_type))
    .map((line) => line.text)
    .join("\n");
  emit(wikibooks, {
    sourceRecordId: row.filename,
    sourceUrl: data.url,
    sourceChecksum: createHash("sha256").update(JSON.stringify(row)).digest("hex"),
    title: data.title,
    description,
    ingredientSections,
    instructionSections,
    equipment,
    metadata: {
      categories: data.infobox?.category,
      servings: data.infobox?.servings,
      totalTime: data.infobox?.time,
      difficulty: data.infobox?.difficulty,
      notes,
    },
  });
}

function archiveFiles(archive, pattern) {
  const result = spawnSync("/usr/bin/tar", ["-tzf", archive], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Could not list ${archive}`);
  return result.stdout.split("\n").filter((name) => pattern.test(name));
}

function archiveText(archive, name) {
  const result = spawnSync("/usr/bin/tar", ["-xOzf", archive, name], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || `Could not read ${name}`);
  return result.stdout;
}

function cooklangStepItemText(item, parsed, flatIngredients, flatCookware, flatTimers) {
  switch (item.type) {
    case "text":
      return item.value;
    case "ingredient":
      return flatIngredients[item.index]?.name ?? "";
    case "cookware":
      return flatCookware[item.index]?.name ?? "";
    case "timer": {
      const timer = flatTimers[item.index];
      return timer?.displayText ?? timer?.name ?? "";
    }
    case "inlineQuantity": {
      const quantity = parsed.inlineQuantities[item.index];
      return quantity ? quantity_display(quantity) : "";
    }
    default:
      return "";
  }
}

function cooklangStepText(step, parsed, flatIngredients, flatCookware, flatTimers) {
  return step.items
    .map((item) =>
      cooklangStepItemText(item, parsed, flatIngredients, flatCookware, flatTimers),
    )
    .join("")
    .trim();
}

function isCooklangIngredientListStep(step) {
  let ingredientFound = false;
  for (const item of step.items) {
    if (item.type === "ingredient") ingredientFound = true;
    else if (item.type !== "text" || !/^[\s,;:.]*$/.test(item.value)) return false;
  }
  return ingredientFound;
}

function normalizeCooklangSource(source) {
  // A bare tilde before a number is commonly used to mean "approximately",
  // but Cooklang reserves it for timers and its parser aborts on forms such as ~5cm.
  return source.replace(/~(?=\d+(?:[.,]\d+)?\s*(?:cm|mm|m|in)\b)/gi, "");
}

const cooklangParser = new CooklangParser();
for (const source of sourceCatalog.filter((item) => item.format === "Cooklang")) {
  await linesFromStream(createReadStream(`${raw}/${source.id}/recipes.jsonl`), (row) => {
    try {
      const [parsed, diagnostics] = cooklangParser.parse(normalizeCooklangSource(row.text));
      const flatIngredients = getFlatIngredients(parsed);
      const flatCookware = getFlatCookware(parsed);
      const flatTimers = getFlatTimers(parsed);
      const instructionSections = parsed.sections.flatMap((section) => {
        const items = section.content.flatMap((content) => {
          if (content.type !== "step" || isCooklangIngredientListStep(content.value)) return [];
          const text = cooklangStepText(content.value, parsed, flatIngredients, flatCookware, flatTimers);
          return text ? [text] : [];
        });
        return items.length ? [{ name: section.name || undefined, items }] : [];
      });
      const title = parsed.title || row.path.split("/").pop().replace(/\.cook$/i, "");
      emit(source, {
        sourceRecordId: row.path,
        sourceUrl: row.sourceUrl,
        sourceChecksum: row.sourceChecksum,
        title,
        description: parsed.description,
        ingredientGroups: [{
          items: flatIngredients.map((ingredient) => ({
            text: [
              ingredient.displayText,
              ingredient.name,
              ingredient.note ? `(${ingredient.note})` : undefined,
            ].filter(Boolean).join(" "),
            name: ingredient.name,
            quantity: ingredient.quantity ?? undefined,
            unit: ingredient.unit ?? undefined,
            note: ingredient.note ?? undefined,
          })),
        }],
        instructionSections,
        equipment: flatCookware.map((item) => ({
          text: [item.displayText, item.name, item.note ? `(${item.note})` : undefined]
            .filter(Boolean)
            .join(" "),
          name: item.name,
          quantity: item.quantity ?? undefined,
          note: item.note ?? undefined,
        })),
        timers: flatTimers.map((timer) => ({
          text: [timer.name, timer.displayText].filter(Boolean).join(" "),
          name: timer.name ?? undefined,
          quantity: timer.quantity ?? undefined,
          unit: timer.unit ?? undefined,
        })),
        metadata: {
          cuisines: parsed.cuisine,
          categories: parsed.course,
          tags: [...parsed.tags, ...strings(parsed.diet)],
          servings: parsed.servings,
          totalTime: parsed.time,
          difficulty: parsed.difficulty,
          authors: schemaParties(parsed.author),
          images: schemaImages(parsed.images),
          sourceMetadata: {
            locale: parsed.locale,
            source: parsed.source,
            custom: Object.fromEntries(parsed.custom_metadata),
            raw: Object.fromEntries(parsed.rawMetadata),
          },
        },
        cooklangSource: row.text,
        parserDiagnostics: diagnostics,
        originalSource: parsed.source,
      });
    } catch (error) {
      emitReject(source, error, row);
    }
  });
}

function markdownHeading(line) {
  let hashes = 0;
  while (line[hashes] === "#") hashes += 1;
  if (hashes < 1 || hashes > 2 || !/\s/.test(line[hashes] || "")) return undefined;
  const heading = line.slice(hashes).trim();
  return heading.endsWith(":") ? heading.slice(0, -1).trim() : heading;
}

function markdownSection(source, heading) {
  const lines = source.split("\n");
  const headingPattern = new RegExp(`^(?:${heading})$`, "i");
  const start = lines.findIndex((line) => headingPattern.test(markdownHeading(line) || ""));
  if (start < 0) return "";
  const endOffset = lines.slice(start + 1).findIndex((line) => markdownHeading(line));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  return lines.slice(start + 1, end).join("\n");
}

function frontmatterValue(source, key) {
  const prefix = `${key}:`;
  const line = source.split("\n").find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

function bulletItems(source) {
  return source.split("\n").flatMap((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith("- ") || trimmed.startsWith("* ")
      ? [trimmed.slice(2).trim()]
      : [];
  }).filter(Boolean);
}

function bulletSections(source) {
  const sections = [];
  let current = { items: [] };
  for (const line of source.split("\n")) {
    const heading = /^#{3,6}\s+(.+?)\s*$/.exec(line)?.[1]?.replace(/:$/, "").trim();
    if (heading) {
      if (current.items.length) sections.push(current);
      current = { name: heading, items: [] };
      continue;
    }
    const item = bulletItems(line)[0];
    if (item) current.items.push(item);
  }
  if (current.items.length) sections.push(current);
  return sections;
}

function frontmatterList(source, key) {
  const value = frontmatterValue(source, key);
  if (!value) return [];
  const unwrapped = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return unwrapped.split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

function removeListMarker(value) {
  const text = value.trimStart();
  if (text.startsWith("- ") || text.startsWith("* ")) return text.slice(2).trim();
  let index = 0;
  while (/\d/.test(text[index] || "")) index += 1;
  if (index && (text[index] === "." || text[index] === ")") && /\s/.test(text[index + 1] || "")) {
    return text.slice(index + 2).trim();
  }
  return text.trim();
}

function paragraphBlocks(source) {
  const blocks = [];
  let lines = [];
  for (const line of source.split("\n")) {
    if (line.trim()) lines.push(line.trim());
    else if (lines.length) {
      blocks.push(lines.join(" "));
      lines = [];
    }
  }
  if (lines.length) blocks.push(lines.join(" "));
  return blocks;
}

function numberedList(source) {
  const steps = [];
  let current;
  for (const line of source.split("\n")) {
    const text = line.trimStart();
    const withoutMarker = removeListMarker(text);
    const isNumbered = withoutMarker !== text.trim() && /^\d/.test(text);
    if (isNumbered) {
      if (current) steps.push(current);
      current = withoutMarker;
    } else if (current && /^\s/.test(line) && text && !text.startsWith(".. ")) {
      current += ` ${text}`;
    } else if (current && text && !/^\s/.test(line)) {
      steps.push(current);
      current = undefined;
    }
  }
  if (current) steps.push(current);
  return steps;
}

const foss = catalogSource("fossrecipes");
const fossArchive = `${raw}/fossrecipes/a6d8d27ba1cd7a2dcaf4dc5d84b7d5a7ab0eaf9c.tar.gz`;
for (const name of archiveFiles(fossArchive, /\/_recipes\/.*\.md$/)) {
  const source = archiveText(fossArchive, name);
  const title = frontmatterValue(source, "title");
  const ingredientSource = markdownSection(source, "Ingredients");
  const directionSource = markdownSection(source, "Directions?|Instructions?|Method|Preparation");
  const equipmentSource = markdownSection(source, "Equipment|Utensils?|Cookware");
  emit(foss, {
    sourceRecordId: name.split("/").pop(),
    sourceUrl: `${foss.url}/blob/a6d8d27ba1cd7a2dcaf4dc5d84b7d5a7ab0eaf9c/${name.split("/").slice(1).join("/")}`,
    sourceChecksum: createHash("sha256").update(source).digest("hex"),
    title,
    ingredientSections: bulletSections(ingredientSource),
    instructions: paragraphBlocks(directionSource)
      .map(removeListMarker)
      .filter((block) => block && !/^#{1,6}\s/.test(block)),
    equipment: bulletItems(equipmentSource),
    metadata: { tags: frontmatterList(source, "tags") },
  });
}

const koha = catalogSource("koha-cookbook");
const kohaArchive = `${raw}/koha-cookbook/908b2244.tar.gz`;
for (const name of archiveFiles(kohaArchive, /\/source\/(?!index|conf)[^/]+\.rst$/)) {
  const source = archiveText(kohaArchive, name);
  const lines = source.split("\n");
  const titleIndex = lines.findIndex((line, index) => /^=+$/.test(lines[index + 1] || "") && line.trim());
  const title = titleIndex >= 0 ? lines[titleIndex].trim() : "";
  const ingredientStart = lines.findIndex((line) => /^Ingredients?$/i.test(line.trim()));
  const preparationStart = lines.findIndex((line) => /^(Preparation|Directions?|Method|Instructions?)$/i.test(line.trim()));
  const ingredientLines = ingredientStart >= 0 && preparationStart > ingredientStart
    ? lines.slice(ingredientStart + 2, preparationStart)
    : [];
  const instructionLines = preparationStart >= 0 ? lines.slice(preparationStart + 2) : [];
  emit(koha, {
    sourceRecordId: name.split("/").pop(),
    sourceUrl: `${koha.url}/-/blob/908b2244/${name.split("/").slice(1).join("/")}`,
    sourceChecksum: createHash("sha256").update(source).digest("hex"),
    title,
    ingredientGroups: [{ items: ingredientLines.filter((line) => /^\s*-\s+\S/.test(line)).map((line) => line.replace(/^\s*-\s+/, "").trim()) }],
    instructions: numberedList(instructionLines.join("\n")),
  });
}

const icnPath = `${raw}/icn-child-nutrition/recipes.jsonl`;
try {
  const icn = catalogSource("icn-child-nutrition");
  await linesFromStream(createReadStream(icnPath), (row) => {
    const parsed = parseWprmRecipe(row.html);
    emit(icn, {
      sourceRecordId: row.sourceRecordId,
      sourceUrl: row.sourceUrl,
      sourceChecksum: row.sourceChecksum,
      title: htmlText(row.title),
      ...parsed,
    });
  });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const gutenbergIds = JSON.parse(await readFile(`${raw}/gutenberg-cookbooks/ebook-ids.json`, "utf8"));
let gutenbergCandidateCount = 0;
for (const ebookId of gutenbergIds) {
  let book;
  try {
    book = await readFile(`${raw}/gutenberg-cookbooks/books/${ebookId}.txt`, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  const lines = book.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].trim();
    if (!heading || heading.length > 90 || !/^[A-Z][A-Z0-9 '\-(),.&]+$/.test(heading)) continue;
    const bodyLines = [];
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 35); cursor += 1) {
      const line = lines[cursor].trim();
      if (bodyLines.length && /^[A-Z][A-Z0-9 '\-(),.&]+$/.test(line) && line.length <= 90) break;
      if (line) bodyLines.push(line);
    }
    const body = bodyLines.join(" ");
    if (body.length < 100 || !/\b(cup|tablespoon|teaspoon|ounce|pound|quart|lb\.?|oz\.?)\b/i.test(body)) continue;
    if (!/\b(add|bake|boil|cook|mix|stir|serve|heat|cut|chop|beat|place)\b/i.test(body)) continue;
    const sourceChecksum = createHash("sha256").update(`${ebookId}:${heading}:${body}`).digest("hex");
    gutenbergCandidates.write(`${JSON.stringify({
      sourceDataset: "gutenberg-cookbooks",
      sourceRecordId: `${ebookId}:${index + 1}`,
      sourceUrl: `https://www.gutenberg.org/ebooks/${ebookId}`,
      license: "Public domain in the USA; ebook header retained in raw source",
      sourceChecksum,
      ebookId,
      lineNumber: index + 1,
      title: heading.replace(/\s+/g, " "),
      body,
    })}\n`);
    gutenbergCandidateCount += 1;
  }
}

function consumeQuotedCharacter(character, nextCharacter) {
  if (character !== '"') return { text: character, quoted: true, skipNext: false };
  if (nextCharacter === '"') return { text: '"', quoted: true, skipNext: true };
  return { text: "", quoted: false, skipNext: false };
}

function appendCsvRow(rows, row, field) {
  const completed = [...row, field];
  if (completed.some(Boolean)) rows.push(completed);
}

function isLineBreak(character) {
  return character === "\n" || character === "\r";
}

function lineBreakWidth(character, nextCharacter) {
  return character === "\r" && nextCharacter === "\n" ? 2 : 1;
}

function csvRows(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      const consumed = consumeQuotedCharacter(character, source[index + 1]);
      field += consumed.text;
      if (consumed.skipNext) index += 1;
      quoted = consumed.quoted;
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (isLineBreak(character)) {
      index += lineBreakWidth(character, source[index + 1]) - 1;
      appendCsvRow(rows, row, field);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) appendCsvRow(rows, row, field);
  return rows;
}

function splitIngredientList(value) {
  return value
    .split(/,\s+(?=(?:\d+(?:[./]\d+)?|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])\s)/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

let ingredientOnlyCount = 0;
const tastyr = catalogSource("tastyr");
for (const filename of ["all_recipes.csv", "cuisines.csv"]) {
  const rows = csvRows(await readFile(`${raw}/tastyr/${filename}`, "utf8"));
  const headers = rows.shift();
  for (const fields of rows) {
    const value = Object.fromEntries(headers.map((header, index) => [header, fields[index] || ""]));
    if (!value.name || !value.ingredients) continue;
    const sourceChecksum = createHash("sha256").update(fields.join("\u0000")).digest("hex");
    emitIngredientsOnly(tastyr, {
      sourceRecordId: sourceChecksum,
      sourceUrl: value.url,
      sourceChecksum,
      title: value.name,
      ingredientGroups: [{ items: splitIngredientList(value.ingredients) }],
      metadata: {
        categories: value.country,
        servings: value.servings,
        prepTime: value.prep_time,
        cookTime: value.cook_time,
        totalTime: value.total_time,
        authors: value.author,
        datePublished: value.date_published,
        rating: value.avg_rating
          ? { value: value.avg_rating, count: value.total_ratings }
          : undefined,
        nutrition: {
          calories: value.calories,
          fat: value.fat,
          carbohydrates: value.carbs,
          protein: value.protein,
        },
        sourceMetadata: {
          collection: filename.replace(".csv", ""),
          reviews: value.reviews,
          ingredientsText: value.ingredients,
        },
      },
    });
    ingredientOnly.write(`${JSON.stringify({
      sourceDataset: "tastyr",
      sourceRecordId: sourceChecksum,
      sourceUrl: value.url,
      license: "CC0",
      retrievedAt: snapshot.retrievedAt,
      sourceChecksum,
      collection: filename.replace(".csv", ""),
      title: value.name,
      ingredientsText: value.ingredients,
      nutrition: {
        calories: value.calories,
        fat: value.fat,
        carbs: value.carbs,
        protein: value.protein,
      },
      prepTime: value.prep_time,
      cookTime: value.cook_time,
      totalTime: value.total_time,
      servings: value.servings,
      rating: value.avg_rating,
    })}\n`);
    ingredientOnlyCount += 1;
  }
}

await Promise.all([
  new Promise((resolve, reject) => recipes.end((error) => error ? reject(error) : resolve())),
  new Promise((resolve, reject) => rejects.end((error) => error ? reject(error) : resolve())),
  new Promise((resolve, reject) => extractedRecipes.end((error) => error ? reject(error) : resolve())),
  new Promise((resolve, reject) => gutenbergCandidates.end((error) => error ? reject(error) : resolve())),
  new Promise((resolve, reject) => ingredientOnly.end((error) => error ? reject(error) : resolve())),
]);
await rename(recipesTemporary, `${outputs}/recipes.jsonl`);
await rename(rejectsTemporary, `${outputs}/rejects.jsonl`);
await rename(extractedRecipesTemporary, `${outputs}/extracted-recipes.jsonl`);
await rename(gutenbergCandidatesTemporary, `${outputs}/gutenberg-candidates.jsonl`);
await rename(ingredientOnlyTemporary, `${outputs}/ingredient-only.jsonl`);
console.log(`Prepared ${accepted} complete recipes and ${extracted} total extracted recipes; rejected ${rejected} records; found ${gutenbergCandidateCount} Gutenberg candidates and ${ingredientOnlyCount} ingredient-only records.`);

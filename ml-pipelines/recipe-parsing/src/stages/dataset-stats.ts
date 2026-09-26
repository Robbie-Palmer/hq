import {
  CUISINE_DISTRIBUTION_PLOT_PATH,
  DATASET_STATS_PATH,
  IMAGES_PER_RECIPE_HISTOGRAM_PATH,
  TOP_INGREDIENTS_PLOT_PATH,
  listImageFiles,
  loadPreparedData,
  writeJson,
} from "../lib/io";

interface DatasetStats {
  recipes: {
    count: number;
  };
  images: {
    referencedCount: number;
    uniqueReferencedCount: number;
    localFileCount: number;
    missingReferencedCount: number;
    averagePerRecipe: number;
    maxPerRecipe: number;
    minPerRecipe: number;
  };
  cuisines: {
    distinctCount: number;
    unknownCount: number;
    mostCommon: { cuisine: string; count: number }[];
  };
  ingredients: {
    uniqueCount: number;
    totalMentions: number;
    mostCommon: { ingredient: string; count: number }[];
  };
}

function toCountRows<K extends string>(counts: Map<string, number>, key: K): Array<{
  [P in K]: string;
} & { count: number }> {
  return [...counts.entries()]
    .map(([label, count]) => ({ [key]: label, count }) as {
      [P in K]: string;
    } & { count: number })
    .sort((a, b) => {
      const countDiff = b.count - a.count;
      if (countDiff !== 0) return countDiff;
      return String(a[key]).localeCompare(String(b[key]));
    });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
async function main() {
  console.log("Loading prepared dataset...");

  const [prepared, localImageFiles] = await Promise.all([
    loadPreparedData(),
    listImageFiles(),
  ]);

  const referencedImages = prepared.entries.flatMap((entry) => entry.images);
  const uniqueReferencedImages = new Set(referencedImages);
  const localImageSet = new Set(localImageFiles);
  const missingReferencedCount = [...uniqueReferencedImages].filter(
    (image) => !localImageSet.has(image),
  ).length;

  const imagesPerRecipe = prepared.entries
    .map((entry, index) => ({
      recipe: entry.expected.title,
      recipe_index: index + 1,
      image_count: entry.images.length,
    }))
    .sort((a, b) => {
      const countDiff = b.image_count - a.image_count;
      if (countDiff !== 0) return countDiff;
      return a.recipe.localeCompare(b.recipe);
    });

  const imageCountHistogramMap = new Map<number, number>();
  for (const entry of imagesPerRecipe) {
    imageCountHistogramMap.set(
      entry.image_count,
      (imageCountHistogramMap.get(entry.image_count) ?? 0) + 1,
    );
  }
  const imageCountHistogram = [...imageCountHistogramMap.entries()]
    .map(([image_count, recipe_count]) => ({ image_count, recipe_count }))
    .sort((a, b) => a.image_count - b.image_count);

  const cuisineCounts = new Map<string, number>();
  const ingredientCounts = new Map<string, number>();
  let unknownCuisineCount = 0;

  for (const entry of prepared.entries) {
    if (entry.expected.cuisine.length > 0) {
      for (const cuisine of entry.expected.cuisine) {
        const trimmed = cuisine.trim();
        if (trimmed) {
          cuisineCounts.set(trimmed, (cuisineCounts.get(trimmed) ?? 0) + 1);
        }
      }
    } else {
      unknownCuisineCount += 1;
    }

    for (const group of entry.expected.ingredientGroups) {
      for (const item of group.items) {
        ingredientCounts.set(
          item.ingredient,
          (ingredientCounts.get(item.ingredient) ?? 0) + 1,
        );
      }
    }
  }

  const cuisineDistribution = toCountRows(cuisineCounts, "cuisine");
  const topIngredients = toCountRows(ingredientCounts, "ingredient").slice(0, 20);

  const imageCounts = imagesPerRecipe.map((entry) => entry.image_count);
  const stats: DatasetStats = {
    recipes: {
      count: prepared.entries.length,
    },
    images: {
      referencedCount: referencedImages.length,
      uniqueReferencedCount: uniqueReferencedImages.size,
      localFileCount: localImageFiles.length,
      missingReferencedCount,
      averagePerRecipe:
        imageCounts.length === 0
          ? 0
          : Number(
              (
                imageCounts.reduce((sum, count) => sum + count, 0) /
                imageCounts.length
              ).toFixed(2),
            ),
      maxPerRecipe: imageCounts.reduce((max, c) => (c > max ? c : max), 0),
      minPerRecipe: imageCounts.reduce(
        (min, c) => (c < min ? c : min),
        imageCounts[0] ?? 0,
      ),
    },
    cuisines: {
      distinctCount: cuisineCounts.size,
      unknownCount: unknownCuisineCount,
      mostCommon: cuisineDistribution.slice(0, 10),
    },
    ingredients: {
      uniqueCount: ingredientCounts.size,
      totalMentions: [...ingredientCounts.values()].reduce(
        (sum, count) => sum + count,
        0,
      ),
      mostCommon: topIngredients.slice(0, 10),
    },
  };

  await Promise.all([
    writeJson(DATASET_STATS_PATH, stats),
    writeJson(IMAGES_PER_RECIPE_HISTOGRAM_PATH, imageCountHistogram),
    writeJson(CUISINE_DISTRIBUTION_PLOT_PATH, cuisineDistribution.slice(0, 20)),
    writeJson(TOP_INGREDIENTS_PLOT_PATH, topIngredients),
  ]);

  console.log(`\nDataset stats (${stats.recipes.count} recipes):`);
  console.log(`  Referenced Images:       ${stats.images.referencedCount}`);
  console.log(`  Unique Referenced:       ${stats.images.uniqueReferencedCount}`);
  console.log(`  Local Image Files:       ${stats.images.localFileCount}`);
  console.log(`  Missing Referenced:      ${stats.images.missingReferencedCount}`);
  console.log(`  Distinct Cuisines:       ${stats.cuisines.distinctCount}`);
  console.log(`  Unique Ingredients:      ${stats.ingredients.uniqueCount}`);
  console.log(`\nMetrics written to ${DATASET_STATS_PATH}`);
  console.log(`Plot data written to ${IMAGES_PER_RECIPE_HISTOGRAM_PATH}`);
  console.log(`Plot data written to ${CUISINE_DISTRIBUTION_PLOT_PATH}`);
  console.log(`Plot data written to ${TOP_INGREDIENTS_PLOT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

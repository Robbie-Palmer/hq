import { eq, inArray } from "drizzle-orm";
import { requiredEnv } from "node-base/env";
import { createAuth } from "../src/auth";
import { createDb, schema } from "recipe-db";
import { RecipeContentSchema } from "recipe-domain";
import type { PantryLocation } from "recipe-domain/pantry";
import { previewScenarios } from "../src/preview-scenarios";
import { syncCanonicalUserEmail } from "../src/user-emails";

function previewRecipeBody(
  slug: string,
  title: string,
  description: string,
  cookBody: string,
  ingredients: Array<{ ingredient: string; amount: number; unit?: string }>,
  instructions: string[],
): string {
  const recipe = RecipeContentSchema.parse({
    slug,
    title,
    description,
    cookBody,
    date: "2026-07-15",
    cuisine: [],
    servings: 2,
    tags: [],
    cookware: [],
    ingredientGroups: [{ items: ingredients }],
    instructions,
  });
  return JSON.stringify({ version: 1, source: cookBody, recipe });
}

const databaseURL = requiredEnv("DATABASE_URL");
const betterAuthURL = requiredEnv("BETTER_AUTH_URL");
const betterAuthSecret = requiredEnv("BETTER_AUTH_SECRET");
const previewPassword = requiredEnv("PREVIEW_AUTH_PASSWORD");

const { db, client } = createDb(databaseURL);

try {
  const auth = createAuth(
    db,
    {
      DEPLOYMENT_ENV: "preview",
      BETTER_AUTH_URL: betterAuthURL,
      BETTER_AUTH_SECRET: betterAuthSecret,
    },
    { allowPreviewSignUp: true },
  );

  for (const scenario of previewScenarios) {
    const [existingUser] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, scenario.email))
      .limit(1);

    if (!existingUser) {
      await auth.api.signUpEmail({
        body: {
          name: scenario.name,
          email: scenario.email,
          password: previewPassword,
        },
      });
    }

    await db
      .update(schema.user)
      .set({
        name: scenario.name,
        role: scenario.role,
        emailVerified: true,
      })
      .where(eq(schema.user.email, scenario.email));
  }

  const seededUsers = await db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      emailVerified: schema.user.emailVerified,
    })
    .from(schema.user)
    .where(
      inArray(
        schema.user.email,
        previewScenarios.map((scenario) => scenario.email),
      ),
    );
  await Promise.all(
    seededUsers.map((seededUser) =>
      syncCanonicalUserEmail(db, seededUser),
    ),
  );
  const userIdByEmail = new Map(
    seededUsers.map((seededUser) => [seededUser.email, seededUser.id]),
  );
  const requireUserId = (email: string): string => {
    const id = userIdByEmail.get(email);
    if (!id) throw new Error(`Preview user was not created correctly: ${email}`);
    return id;
  };
  const recipesUserId = requireUserId("recipes-user@preview.invalid");
  const adminUserId = requireUserId("admin-user@preview.invalid");
  const householdOwnerUserId = requireUserId("household-owner@preview.invalid");
  const householdMemberUserId = requireUserId(
    "household-member@preview.invalid",
  );

  const previewRecipes: Array<typeof schema.recipe.$inferInsert> = [
    {
        slug: "preview-private-weeknight-pasta",
        title: "Preview Weeknight Pasta",
        description: "Private fixture for authenticated recipe QA.",
        body: previewRecipeBody(
          "preview-private-weeknight-pasta",
          "Preview Weeknight Pasta",
          "Private fixture for authenticated recipe QA.",
          "Cook the @pasta{200%g}, then combine with @tomato passata{150%g}.",
          [
            { ingredient: "pasta", amount: 200, unit: "g" },
            { ingredient: "tomato-passata", amount: 150, unit: "g" },
          ],
          ["Cook the pasta, then combine with tomato passata."],
        ),
        userId: recipesUserId,
        visibility: "private",
    },
    {
        slug: "preview-public-tomato-toast",
        title: "Preview Tomato Toast",
        description: "Public fixture for visibility and listing QA.",
        body: previewRecipeBody(
          "preview-public-tomato-toast",
          "Preview Tomato Toast",
          "Public fixture for visibility and listing QA.",
          "Toast the @bread{2%slices} and top with @vine tomato{1}.",
          [
            { ingredient: "bread", amount: 2 },
            { ingredient: "vine-tomato", amount: 1 },
          ],
          ["Toast the bread and top with vine tomato."],
        ),
        userId: recipesUserId,
        visibility: "public",
    },
    {
        slug: "preview-admin-soup",
        title: "Preview Admin Soup",
        description: "Administrator-owned fixture.",
        body: previewRecipeBody(
          "preview-admin-soup",
          "Preview Admin Soup",
          "Administrator-owned fixture.",
          "Simmer @chicken stock{500%ml} with @frozen vegetables{300%g}.",
          [
            { ingredient: "chicken-stock", amount: 500, unit: "ml" },
            { ingredient: "frozen-vegetables", amount: 300, unit: "g" },
          ],
          ["Simmer the chicken stock with the frozen vegetables."],
        ),
        userId: adminUserId,
        visibility: "private",
    },
    {
        slug: "preview-household-veggie-curry",
        title: "Preview Household Veggie Curry",
        description: "Household-only fixture for shared feed and pantry QA.",
        body: previewRecipeBody(
          "preview-household-veggie-curry",
          "Preview Household Veggie Curry",
          "Household-only fixture for shared feed and pantry QA.",
          "Fry the @garlic{2%cloves} and @carrot{1}, add @frozen vegetables{300%g}, then simmer in @coconut milk{200%ml} and @vegetable stock{200%ml}.",
          [
            { ingredient: "garlic", amount: 2 },
            { ingredient: "carrot", amount: 1 },
            { ingredient: "frozen-vegetables", amount: 300, unit: "g" },
            { ingredient: "coconut-milk", amount: 200, unit: "ml" },
            { ingredient: "vegetable-stock", amount: 200, unit: "ml" },
          ],
          [
            "Fry the garlic and carrot, add the frozen vegetables, then simmer in coconut milk and vegetable stock.",
          ],
        ),
        userId: householdOwnerUserId,
        visibility: "household",
    },
    {
        slug: "preview-public-household-flatbread",
        title: "Preview Household Flatbread",
        description:
          "Public fixture from a household cook for cross-household following QA.",
        body: previewRecipeBody(
          "preview-public-household-flatbread",
          "Preview Household Flatbread",
          "Public fixture from a household cook for cross-household following QA.",
          "Top the @bread{2%slices} with @cheddar cheese{80%g} and @vine tomato{1}.",
          [
            { ingredient: "bread", amount: 2 },
            { ingredient: "cheddar-cheese", amount: 80, unit: "g" },
            { ingredient: "vine-tomato", amount: 1 },
          ],
          ["Top the bread with cheddar cheese and vine tomato, then grill."],
        ),
        userId: householdOwnerUserId,
        visibility: "public",
    },
  ];

  for (const previewRecipe of previewRecipes) {
    await db
      .insert(schema.recipe)
      .values(previewRecipe)
      .onConflictDoUpdate({
        target: schema.recipe.slug,
        set: previewRecipe,
      });
  }

  // A ready-made household so household features (shared pantry, member list,
  // household-only recipes, invitations) have data on first sign-in. Both
  // members belong to one household from the start. The IDs are deterministic
  // (keeping the seed idempotent across retries within a run) and must be valid
  // UUIDs: the household routes accept `householdId`/`memberId` only as
  // `z.string().uuid()`, the same shape `crypto.randomUUID()` produces for
  // households created at runtime.
  const HOUSEHOLD_ID = "11111111-1111-4111-8111-111111111111";
  const HOUSEHOLD_SLUG = "preview-shared-household";

  await db
    .insert(schema.organization)
    .values({
      id: HOUSEHOLD_ID,
      name: "Preview Shared Household",
      slug: HOUSEHOLD_SLUG,
    })
    .onConflictDoUpdate({
      target: schema.organization.id,
      set: { name: "Preview Shared Household", slug: HOUSEHOLD_SLUG },
    });

  const householdMembers: Array<typeof schema.member.$inferInsert> = [
    {
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: HOUSEHOLD_ID,
      userId: householdOwnerUserId,
      role: "owner",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      organizationId: HOUSEHOLD_ID,
      userId: householdMemberUserId,
      role: "member",
    },
  ];
  for (const householdMember of householdMembers) {
    await db
      .insert(schema.member)
      .values(householdMember)
      .onConflictDoUpdate({
        target: schema.member.userId,
        set: {
          organizationId: householdMember.organizationId,
          role: householdMember.role,
        },
      });
  }

  // A reciprocal connection across household boundaries. This gives both the
  // household owner and the solo recipes cook a ready-made Following feed and
  // exercises the public-only visibility boundary for non-household followers.
  await db
    .insert(schema.userFollow)
    .values([
      {
        followerUserId: householdOwnerUserId,
        followedUserId: recipesUserId,
      },
      {
        followerUserId: recipesUserId,
        followedUserId: householdOwnerUserId,
      },
    ])
    .onConflictDoNothing();

  // Shared household pantry: owned by the organization, so every member sees the
  // same stock. Ingredients are canonical slugs that also appear in the seeded
  // recipes, so "what can I cook" style matching lights up.
  const sharedPantry: Array<{ slug: string; location: PantryLocation }> = [
    { slug: "butter", location: "fridge" },
    { slug: "milk", location: "fridge" },
    { slug: "cheddar-cheese", location: "fridge" },
    { slug: "chicken-breast", location: "fridge" },
    { slug: "pasta", location: "cupboards" },
    { slug: "rice", location: "cupboards" },
    { slug: "vegetable-stock", location: "cupboards" },
    { slug: "tomato-passata", location: "cupboards" },
    { slug: "olive-oil", location: "cupboards" },
    { slug: "coconut-milk", location: "cupboards" },
    { slug: "frozen-vegetables", location: "fridge" },
    { slug: "garlic", location: "fresh" },
    { slug: "carrot", location: "fresh" },
    { slug: "spinach", location: "fresh" },
  ];
  for (const item of sharedPantry) {
    await db
      .insert(schema.pantryItem)
      .values({
        organizationId: HOUSEHOLD_ID,
        ingredientSlug: item.slug,
        location: item.location,
      })
      .onConflictDoUpdate({
        target: [
          schema.pantryItem.organizationId,
          schema.pantryItem.ingredientSlug,
        ],
        set: { location: item.location },
      });
  }

  // Solo pantry for the recipes user, who is not in a household. This exercises
  // the personal (user-owned) pantry path alongside the shared one.
  const soloPantry: Array<{ slug: string; location: PantryLocation }> = [
    { slug: "double-cream", location: "fridge" },
    { slug: "mozzarella", location: "fridge" },
    { slug: "penne-pasta", location: "cupboards" },
    { slug: "tomato-passata", location: "cupboards" },
    { slug: "olive-oil", location: "cupboards" },
    { slug: "vine-tomato", location: "fresh" },
    { slug: "garlic", location: "fresh" },
  ];
  for (const item of soloPantry) {
    await db
      .insert(schema.pantryItem)
      .values({
        userId: recipesUserId,
        ingredientSlug: item.slug,
        location: item.location,
      })
      .onConflictDoUpdate({
        target: [schema.pantryItem.userId, schema.pantryItem.ingredientSlug],
        set: { location: item.location },
      });
  }

  // A dietary profile for the household owner so diet features (presets,
  // excluded groups/ingredients, warn vs hide) have representative data. "warn"
  // plus an excluded ingredient present in the household curry surfaces a diet
  // clash rather than hiding the recipe outright.
  await db
    .insert(schema.userDietProfile)
    .values({ userId: householdOwnerUserId, recipeMatchMode: "warn" })
    .onConflictDoUpdate({
      target: schema.userDietProfile.userId,
      set: { recipeMatchMode: "warn" },
    });
  await db
    .insert(schema.userDietPreset)
    .values({ userId: householdOwnerUserId, presetKey: "pescatarian" })
    .onConflictDoNothing();
  await db
    .insert(schema.userDietExcludedGroup)
    .values({ userId: householdOwnerUserId, groupKey: "nuts" })
    .onConflictDoNothing();
  await db
    .insert(schema.userDietExcludedIngredient)
    .values({ userId: householdOwnerUserId, ingredientSlug: "coconut-milk" })
    .onConflictDoNothing();

  console.log(
    `Seeded ${previewScenarios.length} preview scenarios with household, pantry, diet, and cross-household follow fixtures.`,
  );
} finally {
  await client.end({ timeout: 5 });
}

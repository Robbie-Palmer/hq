const recipeRoot = ["recipes"] as const;

export const recipeQueryKeys = {
  all: recipeRoot,
  public: () => [...recipeRoot, "public"] as const,
  publicRecipes: () => [...recipeRoot, "public", "saved"] as const,
  publicSavedRecipe: (slug: string) =>
    [...recipeRoot, "public", "saved", slug] as const,
  publicDiscoverFeed: () => [...recipeRoot, "public", "discover"] as const,
  publicCooks: () => [...recipeRoot, "public", "cooks"] as const,
  publicCook: (cookId: string) =>
    [...recipeRoot, "public", "cooks", cookId] as const,
  private: () => [...recipeRoot, "private"] as const,
  user: (userId: string) => [...recipeRoot, "private", userId] as const,
  bootstrap: (userId: string) =>
    [...recipeRoot, "private", userId, "bootstrap"] as const,
  recipeBox: (userId: string) =>
    [...recipeRoot, "private", userId, "recipe-box"] as const,
  recipeBoxRecipes: (userId: string) =>
    [...recipeRoot, "private", userId, "recipe-box-recipes"] as const,
  savedRecipe: (userId: string, slug: string) =>
    [...recipeRoot, "private", userId, "saved", slug] as const,
  diet: (userId: string) => [...recipeRoot, "private", userId, "diet"] as const,
  dietProfile: (userId: string) =>
    [...recipeRoot, "private", userId, "diet", "profile"] as const,
  dietOptions: (userId: string) =>
    [...recipeRoot, "private", userId, "diet", "options"] as const,
  householdSettings: (userId: string) =>
    [...recipeRoot, "private", userId, "household", "settings"] as const,
  householdMembers: (userId: string, householdId: string) =>
    [
      ...recipeRoot,
      "private",
      userId,
      "household",
      householdId,
      "members",
    ] as const,
  pantry: (userId: string) =>
    [...recipeRoot, "private", userId, "pantry"] as const,
  shoppingList: (userId: string) =>
    [...recipeRoot, "private", userId, "shopping-list"] as const,
  followingDiscoverFeed: (userId: string) =>
    [...recipeRoot, "private", userId, "discover", "following"] as const,
  cookConnections: (userId: string) =>
    [...recipeRoot, "private", userId, "cooks", "connections"] as const,
  cookFollowStatus: (userId: string, cookId: string) =>
    [...recipeRoot, "private", userId, "cooks", cookId, "follow"] as const,
};

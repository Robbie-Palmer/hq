export const RECIPE_AUTHORIZATION_POLICY = `@id("read-public-recipe")
permit (
  principal is RecipeSite::Actor,
  action == RecipeSite::Action::"recipe.read",
  resource is RecipeSite::Recipe
)
when {
  resource.visibility == "public"
};

@id("read-owned-recipe")
permit (
  principal is RecipeSite::Actor,
  action == RecipeSite::Action::"recipe.read",
  resource is RecipeSite::Recipe
)
when {
  principal.kind != "anonymous" &&
  principal.userId == resource.ownerId
};

@id("read-household-recipe")
permit (
  principal is RecipeSite::Actor,
  action == RecipeSite::Action::"recipe.read",
  resource is RecipeSite::Recipe
)
when {
  principal.kind != "anonymous" &&
  resource.visibility == "household" &&
  context.sharesHouseholdWithOwner
};

@id("manage-owned-resource")
permit (
  principal is RecipeSite::Actor,
  action == RecipeSite::Action::"resource.owner.manage",
  resource is RecipeSite::OwnedResource
)
when {
  principal.kind != "anonymous" &&
  principal.userId == resource.ownerId
};

@id("manage-owned-household-membership")
permit (
  principal is RecipeSite::Actor,
  action == RecipeSite::Action::"household.membership.manage",
  resource is RecipeSite::Household
)
when {
  principal.kind == "user" &&
  principal.userId == resource.ownerId
};

@id("never-delegate-household-membership-management")
forbid (
  principal is RecipeSite::Actor,
  action == RecipeSite::Action::"household.membership.manage",
  resource
)
when {
  principal.kind == "agent"
};

@id("execute-verified-delegated-capability")
permit (
  principal is RecipeSite::Actor,
  action in RecipeSite::Action::"agent.capability.execute",
  resource is RecipeSite::CapabilityInvocation
)
when {
  principal.kind == "agent" &&
  principal.grantVerified &&
  principal.userId == resource.delegatedUserId
};
`;

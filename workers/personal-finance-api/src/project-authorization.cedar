@id("create-owned-synthetic-household")
permit (
  principal is PersonalFinance::User,
  action == PersonalFinance::Action::"household.create",
  resource is PersonalFinance::Household
)
when {
  resource.ownerUserId == principal.userId &&
  resource.syntheticOnly
};

@id("read-owned-synthetic-household")
permit (
  principal is PersonalFinance::User,
  action == PersonalFinance::Action::"household.read",
  resource is PersonalFinance::Household
)
when {
  resource.ownerUserId == principal.userId &&
  resource.syntheticOnly
};

@id("never-delete-synthetic-household")
forbid (
  principal is PersonalFinance::User,
  action == PersonalFinance::Action::"household.delete",
  resource is PersonalFinance::Household
)
when {
  resource.syntheticOnly
};

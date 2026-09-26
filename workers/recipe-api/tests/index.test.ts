import { beforeEach, describe, it, expect, vi } from "vitest";
import postgres from "postgres";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const authzMock = vi.hoisted(() => ({
  session: null as unknown,
}));

const dbMock = vi.hoisted(() => {
  const date = new Date("2026-01-01T00:00:00.000Z");
  type UserRow = {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    role: string | null;
    banned: boolean | null;
    banReason: string | null;
    banExpires: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  type OrganizationRow = {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    metadata: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  type UserEmailRow = {
    email: string;
    userId: string;
    verified: boolean;
    isPrimary: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  type MemberRow = {
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    createdAt: Date;
  };
  type InvitationRow = {
    id: string;
    organizationId: string;
    email: string;
    role: string;
    status: string;
    expiresAt: Date;
    inviterId: string;
    createdAt: Date;
  };
  type RecipeRow = {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    body: string | null;
    userId: string;
    visibility: "public" | "private" | "household";
    createdAt: Date;
    updatedAt: Date;
  };
  type CookingSessionRow = {
    id: string;
    userId: string;
    recipeSlug: string;
    recipeTitle: string;
    servings: number;
    startedAt: Date;
    completedAt: Date | null;
  };
  type NotificationEventRow = {
    id: string;
    kind: string;
    actorUserId: string | null;
    actorNameSnapshot: string | null;
    occurredAt: Date;
  };
  type DietProfileRow = {
    userId: string;
    recipeMatchMode: "hide" | "warn";
    createdAt: Date;
    updatedAt: Date;
  };
  type DietPresetRow = {
    key: string;
    label: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  type IngredientGroupRow = {
    key: string;
    label: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  type IngredientRow = {
    slug: string;
    name: string;
    category: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  type PantryItemRow = {
    id: string;
    userId: string | null;
    organizationId: string | null;
    ingredientSlug: string;
    location: "fridge" | "cupboards" | "fresh";
    version?: bigint;
    createdAt: Date;
    updatedAt: Date;
  };
  type PantryAggregateRow = {
    id: string;
    userId: string | null;
    organizationId: string | null;
    revision: bigint;
    createdAt: Date;
    updatedAt: Date;
  };
  type PantryOperationRow = {
    aggregateId: string;
    operationId: string;
    commandFingerprint: string;
    result: Record<string, unknown>;
    createdAt: Date;
  };
  type ShoppingListRow = {
    id: string;
    userId: string | null;
    organizationId: string | null;
    status: "active" | "archived";
    revision: bigint;
    snapshot: {
      recipes: Array<{ slug: string; servings?: number }>;
      checked: string[];
      extras: Array<{ id: string; text: string; checked: boolean }>;
    };
    closedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };

  const state = {
    users: [] as UserRow[],
    userEmails: [] as UserEmailRow[],
    organizations: [] as OrganizationRow[],
    members: [] as MemberRow[],
    invitations: [] as InvitationRow[],
    notificationEvents: [] as NotificationEventRow[],
    notificationDeliveries: [] as {
      id: string;
      eventId: string;
      recipientUserId: string;
      readAt: Date | null;
      dismissedAt: Date | null;
    }[],
    notificationAgentApprovalEvents: [] as {
      eventId: string;
      approvalRequestId: string | null;
      agentIdSnapshot: string;
      agentNameSnapshot: string;
      capabilitiesSnapshot: string;
      expiresAtSnapshot: Date;
      approvalCodeCiphertext: string | null;
      approvalStatus: string | null;
      approvalExpiresAt: Date | null;
    }[],
    notificationHouseholdEvents: [] as {
      eventId: string;
      householdId: string | null;
      householdNameSnapshot: string;
    }[],
    notificationHouseholdInvitationEvents: [] as {
      eventId: string;
      invitationId: string | null;
    }[],
    notificationRecipeRecommendationEvents: [] as {
      eventId: string;
      recipeId: string | null;
      recipeSlugSnapshot: string;
      recipeTitleSnapshot: string;
    }[],
    recipes: [] as RecipeRow[],
    cookingSessions: [] as CookingSessionRow[],
    dietProfiles: [] as DietProfileRow[],
    dietPresets: [] as DietPresetRow[],
    ingredientGroups: [] as IngredientGroupRow[],
    ingredients: [] as IngredientRow[],
    pantryItems: [] as PantryItemRow[],
    pantryAggregates: [] as PantryAggregateRow[],
    pantryOperations: [] as PantryOperationRow[],
    shoppingLists: [] as ShoppingListRow[],
    pantryOperationSweeps: 0,
    ingredientGroupMembers: [] as {
      groupKey: string;
      ingredientSlug: string;
    }[],
    ingredientGroupHierarchy: [] as {
      narrowerGroupKey: string;
      broaderGroupKey: string;
      relationType: "classification" | "composition";
    }[],
    dietPresetExcludedGroups: [] as { presetKey: string; groupKey: string }[],
    dietPresetExcludedIngredients: [] as {
      presetKey: string;
      ingredientSlug: string;
    }[],
    userDietPresets: [] as { userId: string; presetKey: string }[],
    userDietExcludedIngredients: [] as {
      userId: string;
      ingredientSlug: string;
    }[],
    userDietExcludedGroups: [] as { userId: string; groupKey: string }[],
    recipeBoxes: [] as { userId: string; completedAt: Date; updatedAt: Date }[],
    recipeBoxItems: [] as { userId: string; recipeSlug: string }[],
    userFollows: [] as {
      followerUserId: string;
      followedUserId: string;
      createdAt: Date;
    }[],
    rateLimitCounts: new Map<string, number>(),
    rateLimitSweeps: 0,
    expireInvitationOnUpdate: false,
  };

  const organizationRow = (organization: OrganizationRow) => [
    organization.id,
    organization.name,
    organization.slug,
    organization.logo,
    organization.metadata,
    organization.createdAt,
    organization.updatedAt,
  ];
  const memberRow = (member: MemberRow) => [
    member.id,
    member.organizationId,
    member.userId,
    member.role,
    member.createdAt,
  ];
  const isPersonalPantryQuery = (query: string) =>
    query.includes('"pantry_item"."user_id" =');
  const invitationRow = (invitation: InvitationRow) => [
    invitation.id,
    invitation.organizationId,
    invitation.email,
    invitation.role,
    invitation.status,
    invitation.expiresAt,
    invitation.inviterId,
    invitation.createdAt,
  ];
  const recipeRow = (recipe: RecipeRow) => [
    recipe.id,
    recipe.slug,
    recipe.title,
    recipe.description,
    recipe.body,
    recipe.userId,
    recipe.visibility,
    recipe.createdAt,
    recipe.updatedAt,
  ];
  // Emulates the paginated recipe list query: newest-first ordering, an
  // optional keyset cursor (three params), a limit param, and the trailing
  // created_at::text cursor column.
  const paginatedRecipeRows = (
    recipes: RecipeRow[],
    query: string,
    params: unknown[],
    cursorParamIndex: number,
  ) => {
    let page = [...recipes].sort(
      (first, second) =>
        second.createdAt.getTime() - first.createdAt.getTime() ||
        second.id.localeCompare(first.id),
    );
    let index = cursorParamIndex;
    if (query.includes("::timestamptz")) {
      const cursorCreatedAt = new Date(params[index] as string).getTime();
      const cursorId = params[index + 2] as string;
      index += 3;
      page = page.filter(
        (recipe) =>
          recipe.createdAt.getTime() < cursorCreatedAt ||
          (recipe.createdAt.getTime() === cursorCreatedAt &&
            recipe.id.localeCompare(cursorId) < 0),
      );
    }
    const limit = params[index];
    if (typeof limit === "number") page = page.slice(0, limit);
    return page.map((recipe) => [
      ...recipeRow(recipe),
      recipe.createdAt.toISOString(),
    ]);
  };

  const dietProfileRow = (profile: DietProfileRow) => [
    profile.userId,
    profile.recipeMatchMode,
    profile.createdAt,
    profile.updatedAt,
  ];

  function reset() {
    state.users = [];
    state.userEmails = [];
    state.organizations = [];
    state.members = [];
    state.invitations = [];
    state.notificationEvents = [];
    state.notificationDeliveries = [];
    state.notificationAgentApprovalEvents = [];
    state.notificationHouseholdEvents = [];
    state.notificationHouseholdInvitationEvents = [];
    state.notificationRecipeRecommendationEvents = [];
    state.recipes = [];
    state.cookingSessions = [];
    state.dietProfiles = [];
    state.dietPresets = [];
    state.ingredientGroups = [];
    state.ingredients = [];
    state.pantryItems = [];
    state.pantryAggregates = [];
    state.pantryOperations = [];
    state.shoppingLists = [];
    state.pantryOperationSweeps = 0;
    state.ingredientGroupMembers = [];
    state.ingredientGroupHierarchy = [];
    state.dietPresetExcludedGroups = [];
    state.dietPresetExcludedIngredients = [];
    state.userDietPresets = [];
    state.userDietExcludedIngredients = [];
    state.userDietExcludedGroups = [];
    state.recipeBoxes = [];
    state.recipeBoxItems = [];
    state.userFollows = [];
    state.rateLimitCounts.clear();
    state.rateLimitSweeps = 0;
    state.expireInvitationOnUpdate = false;
  }

  type QueryRows = unknown[][];
  type QueryRowsHandler = (
    query: string,
    params: unknown[],
  ) => QueryRows | undefined;

  function queryShoppingRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    const shoppingSnapshot = (value: unknown) =>
      (typeof value === "string" ? JSON.parse(value) : value) as ShoppingListRow["snapshot"];
    if (query.startsWith('insert into "shopping_list"')) {
      const list: ShoppingListRow = {
        id: `00000000-0000-4000-8000-${String(state.shoppingLists.length + 80).padStart(12, "0")}`,
        userId: (params[0] as string | null) ?? null,
        organizationId: (params[1] as string | null) ?? null,
        status: "active",
        revision: 0n,
        snapshot: shoppingSnapshot(params[2]),
        closedAt: null,
        createdAt: date,
        updatedAt: date,
      };
      state.shoppingLists.push(list);
      return [
        [
          list.id,
          list.userId,
          list.organizationId,
          list.status,
          list.revision,
          list.snapshot,
          list.closedAt,
          list.createdAt,
          list.updatedAt,
        ],
      ];
    }

    return undefined;
  }

  function updateShoppingRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    const shoppingSnapshot = (value: unknown) =>
      (typeof value === "string" ? JSON.parse(value) : value) as ShoppingListRow["snapshot"];
    const shoppingDate = (value: unknown) =>
      value instanceof Date ? value : new Date(value as string);
    if (query.startsWith('update "shopping_list"')) {
      const archiving = query.includes('"status" =');
      const id = params.find((param) =>
        state.shoppingLists.some((candidate) => candidate.id === param),
      ) as string | undefined;
      const list = state.shoppingLists.find((candidate) => candidate.id === id);
      const expectedRevision = params.find(
        (param): param is bigint => typeof param === "bigint",
      );
      if (
        !list ||
        (expectedRevision !== undefined && list.revision !== expectedRevision)
      ) {
        return [];
      }
      if (archiving) {
        list.status = params[0] as "archived";
        list.snapshot = shoppingSnapshot(params[1]);
        list.closedAt = shoppingDate(params[2]);
        list.updatedAt = shoppingDate(params[3]);
      } else {
        list.snapshot = shoppingSnapshot(params[0]);
        list.updatedAt = shoppingDate(params[1]);
      }
      list.revision += 1n;
      return archiving
        ? []
        : [
            [
              list.id,
              list.userId,
              list.organizationId,
              list.status,
              list.revision,
              list.snapshot,
              list.closedAt,
              list.createdAt,
              list.updatedAt,
            ],
          ];
    }

    return undefined;
  }

  function selectShoppingRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.includes('from "shopping_list"')) {
      const ownerId = params[0] as string;
      return state.shoppingLists
        .filter(
          (list) =>
            list.status === "active" &&
            (list.userId === ownerId || list.organizationId === ownerId),
        )
        .map((list) => [
          list.id,
          list.userId,
          list.organizationId,
          list.status,
          list.revision,
          list.snapshot,
          list.closedAt,
          list.createdAt,
          list.updatedAt,
        ]);
    }

    return undefined;
  }

  function insertCoreRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('insert into "app_rate_limit"')) {
      const key = params[0] as string;
      const count = (state.rateLimitCounts.get(key) ?? 0) + 1;
      state.rateLimitCounts.set(key, count);
      // [count, windowStart] — drizzle .returning() maps these by column order.
      return [[count, date]];
    }

    if (query.startsWith('insert into "organization"')) {
      const organization: OrganizationRow = {
        id: params[0] as string,
        name: params[1] as string,
        slug: params[2] as string,
        logo: null,
        metadata: null,
        createdAt: date,
        updatedAt: date,
      };
      state.organizations.push(organization);
      return [organizationRow(organization)];
    }

    if (query.startsWith('insert into "notification_event"')) {
      state.notificationEvents.push({
        id: params[0] as string,
        kind: params[1] as string,
        actorUserId: (params[2] as string | undefined) ?? null,
        actorNameSnapshot: (params[3] as string | undefined) ?? null,
        occurredAt: date,
      });
      return [];
    }

    if (query.startsWith('insert into "notification_agent_approval_event"')) {
      state.notificationAgentApprovalEvents.push({
        eventId: params[0] as string,
        approvalRequestId: (params[1] as string | undefined) ?? null,
        agentIdSnapshot: params[2] as string,
        agentNameSnapshot: params[3] as string,
        capabilitiesSnapshot: params[4] as string,
        expiresAtSnapshot: params[5] as Date,
        approvalCodeCiphertext: (params[6] as string | undefined) ?? null,
        approvalStatus: "pending",
        approvalExpiresAt: params[5] as Date,
      });
      return [];
    }

    return undefined;
  }

  function insertNotificationRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('insert into "notification_household_event"')) {
      state.notificationHouseholdEvents.push({
        eventId: params[0] as string,
        householdId: (params[1] as string | undefined) ?? null,
        householdNameSnapshot: params[2] as string,
      });
      return [];
    }

    if (
      query.startsWith(
        'insert into "notification_household_invitation_event"',
      )
    ) {
      state.notificationHouseholdInvitationEvents.push({
        eventId: params[0] as string,
        invitationId: (params[1] as string | undefined) ?? null,
      });
      return [];
    }

    if (
      query.startsWith(
        'insert into "notification_recipe_recommendation_event"',
      )
    ) {
      state.notificationRecipeRecommendationEvents.push({
        eventId: params[0] as string,
        recipeId: (params[1] as string | undefined) ?? null,
        recipeSlugSnapshot: params[2] as string,
        recipeTitleSnapshot: params[3] as string,
      });
      return [];
    }

    if (query.startsWith('insert into "notification_delivery"')) {
      for (let index = 0; index < params.length; index += 3) {
        state.notificationDeliveries.push({
          id: params[index] as string,
          eventId: params[index + 1] as string,
          recipientUserId: params[index + 2] as string,
          readAt: null,
          dismissedAt: null,
        });
      }
      return [];
    }

    return undefined;
  }

  function insertAccountRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('insert into "user_email"')) {
      const email = params[0] as string;
      if (state.userEmails.some((candidate) => candidate.email === email)) {
        return [];
      }
      state.userEmails.push({
        email,
        userId: params[1] as string,
        verified: params[2] as boolean,
        isPrimary: params[3] as boolean,
        createdAt: date,
        updatedAt: date,
      });
      return [];
    }

    return undefined;
  }

  function insertFollowRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('insert into "user_follow"')) {
      const followerUserId = params[0] as string;
      const followedUserId = params[1] as string;
      if (
        !state.userFollows.some(
          (follow) =>
            follow.followerUserId === followerUserId &&
            follow.followedUserId === followedUserId,
        )
      ) {
        state.userFollows.push({
          followerUserId,
          followedUserId,
          createdAt: date,
        });
      }
      return [];
    }

    return undefined;
  }

  function insertMembershipRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('insert into "member"')) {
      const member: MemberRow = {
        id: params[0] as string,
        organizationId: params[1] as string,
        userId: params[2] as string,
        role: (params[3] as string | undefined) ?? "member",
        createdAt: date,
      };
      const exists = state.members.some(
        (existing) => existing.userId === member.userId,
      );
      if (exists) return [];
      state.members.push(member);
      return [memberRow(member)];
    }

    if (query.startsWith('insert into "invitation"')) {
      const invitation: InvitationRow = {
        id: params[0] as string,
        organizationId: params[1] as string,
        email: params[2] as string,
        role: params[3] as string,
        status: params[4] as string,
        expiresAt: new Date(params[5] as string | Date),
        inviterId: params[6] as string,
        createdAt: date,
      };
      state.invitations.push(invitation);
      return [invitationRow(invitation)];
    }

    return undefined;
  }

  function insertPantryRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('insert into "pantry_aggregate"')) {
      const userId = (params[0] as string | null) ?? null;
      const organizationId = (params[1] as string | null) ?? null;
      const existing = state.pantryAggregates.find(
        (candidate) =>
          (userId !== null && candidate.userId === userId) ||
          (organizationId !== null &&
            candidate.organizationId === organizationId),
      );
      if (existing) return [];
      const aggregate: PantryAggregateRow = {
        id: crypto.randomUUID(),
        userId,
        organizationId,
        revision: 0n,
        createdAt: date,
        updatedAt: date,
      };
      state.pantryAggregates.push(aggregate);
      return [[aggregate.id, aggregate.revision.toString()]];
    }

    return undefined;
  }

  function insertPantryOperationRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('insert into "pantry_operation"')) {
      const result = params[3];
      state.pantryOperations.push({
        aggregateId: params[0] as string,
        operationId: params[1] as string,
        commandFingerprint: params[2] as string,
        result:
          typeof result === "string"
            ? (JSON.parse(result) as Record<string, unknown>)
            : (result as Record<string, unknown>),
        createdAt: date,
      });
      return [];
    }

    return undefined;
  }

  function samePantryItemOwner(
    candidate: PantryItemRow,
    pantryItem: PantryItemRow,
  ) {
    return (
      candidate.ingredientSlug === pantryItem.ingredientSlug &&
      ((pantryItem.userId !== null && candidate.userId === pantryItem.userId) ||
        (pantryItem.organizationId !== null &&
          candidate.organizationId === pantryItem.organizationId))
    );
  }

  function storePantryItem(query: string, pantryItem: PantryItemRow) {
    const existing = state.pantryItems.find((candidate) =>
      samePantryItemOwner(candidate, pantryItem),
    );
    if (query.includes("do update set") && existing) {
      existing.location = pantryItem.location;
      existing.version = (existing.version ?? 1n) + 1n;
      existing.updatedAt = date;
      return;
    }
    if (!query.includes("on conflict do nothing") || !existing) {
      state.pantryItems.push(pantryItem);
    }
  }

  function insertPantryItemRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('insert into "pantry_item"')) {
      const valuesClause = query.split(" values ")[1]?.split(" on conflict")[0] ?? "";
      const valueParameterCount = Math.max(
        0,
        ...[...valuesClause.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])),
      );
      for (let index = 0; index < valueParameterCount; index += 4) {
        const pantryItem: PantryItemRow = {
          id: crypto.randomUUID(),
          userId: (params[index] as string | null) ?? null,
          organizationId: (params[index + 1] as string | null) ?? null,
          ingredientSlug: params[index + 2] as string,
          location: params[index + 3] as PantryItemRow["location"],
          version: 1n,
          createdAt: date,
          updatedAt: date,
        };
        storePantryItem(query, pantryItem);
      }
      return [];
    }

    return undefined;
  }

  function insertUserStateRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('insert into "user_diet_profile"')) {
      const existing = state.dietProfiles.find(
        (candidate) => candidate.userId === params[0],
      );
      if (existing) {
        existing.recipeMatchMode = params[1] as DietProfileRow["recipeMatchMode"];
        existing.updatedAt = date;
        return [dietProfileRow(existing)];
      }
      const profile: DietProfileRow = {
        userId: params[0] as string,
        recipeMatchMode: params[1] as DietProfileRow["recipeMatchMode"],
        createdAt: date,
        updatedAt: date,
      };
      state.dietProfiles.push(profile);
      return [dietProfileRow(profile)];
    }

    return undefined;
  }

  function insertRecipeBoxStateRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('insert into "user_recipe_box"')) {
      const userId = params[0] as string;
      const existing = state.recipeBoxes.find((box) => box.userId === userId);
      if (existing) {
        existing.updatedAt = date;
      } else {
        state.recipeBoxes.push({ userId, completedAt: date, updatedAt: date });
      }
      return [];
    }

    if (query.startsWith('insert into "user_recipe_box_item"')) {
      for (let index = 0; index < params.length; index += 2) {
        state.recipeBoxItems.push({
          userId: params[index] as string,
          recipeSlug: params[index + 1] as string,
        });
      }
      return [];
    }

    return undefined;
  }

  function insertCookingSessionRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('insert into "cooking_session"')) {
      const session: CookingSessionRow = {
        id: params[0] as string,
        userId: params[1] as string,
        recipeSlug: params[2] as string,
        recipeTitle: params[3] as string,
        servings: params[4] as number,
        startedAt: date,
        completedAt: (params[5] as Date | undefined) ?? null,
      };
      if (
        state.cookingSessions.some((candidate) => candidate.id === session.id)
      ) {
        return [];
      }
      state.cookingSessions.push(session);
      return [[session.id]];
    }

    return undefined;
  }

  function insertDietSelectionRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('insert into "user_diet_preset"')) {
      for (let index = 0; index < params.length; index += 2) {
        state.userDietPresets.push({
          userId: params[index] as string,
          presetKey: params[index + 1] as string,
        });
      }
      return [];
    }

    if (query.startsWith('insert into "user_diet_excluded_ingredient"')) {
      for (let index = 0; index < params.length; index += 2) {
        state.userDietExcludedIngredients.push({
          userId: params[index] as string,
          ingredientSlug: params[index + 1] as string,
        });
      }
      return [];
    }

    if (query.startsWith('insert into "user_diet_excluded_group"')) {
      for (let index = 0; index < params.length; index += 2) {
        state.userDietExcludedGroups.push({
          userId: params[index] as string,
          groupKey: params[index + 1] as string,
        });
      }
      return [];
    }

    return undefined;
  }

  function updateInvitationRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('update "invitation" set "status"')) {
      expireInvitationBeforeUpdate(params[1] as string);
      const status = params[0] as string;
      const invitationId = params[1] as string;
      const { householdId, pendingStatus, expiresAfter } =
        invitationUpdateFilters(query, params);
      const invitation = state.invitations.find((candidate) =>
        invitationMatchesUpdate(
          candidate,
          invitationId,
          householdId,
          pendingStatus,
          expiresAfter,
        ),
      );
      if (!invitation) return [];
      invitation.status = status;
      return query.includes("returning") ? [invitationRow(invitation)] : [];
    }

    return undefined;
  }

  function expireInvitationBeforeUpdate(invitationId: string) {
    if (!state.expireInvitationOnUpdate) return;
    const expiring = state.invitations.find(
      (candidate) => candidate.id === invitationId,
    );
    if (expiring) expiring.expiresAt = new Date(0);
    state.expireInvitationOnUpdate = false;
  }

  function invitationUpdateFilters(query: string, params: unknown[]) {
    const hasHouseholdFilter = query.includes(
      '"invitation"."organization_id"',
    );
    return {
      householdId: hasHouseholdFilter ? (params[2] as string) : undefined,
      pendingStatus: hasHouseholdFilter
        ? (params[3] as string | undefined)
        : (params[2] as string | undefined),
      expiresAfter: query.includes('"invitation"."expires_at" >')
        ? new Date(params[3] as string)
        : undefined,
    };
  }

  function invitationMatchesUpdate(
    candidate: InvitationRow,
    invitationId: string,
    householdId: string | undefined,
    pendingStatus: string | undefined,
    expiresAfter: Date | undefined,
  ) {
    return (
      candidate.id === invitationId &&
      (!householdId || candidate.organizationId === householdId) &&
      (!pendingStatus || candidate.status === pendingStatus) &&
      (!expiresAfter || candidate.expiresAt > expiresAfter)
    );
  }

  function queryPlaceholderValue(
    query: string,
    params: unknown[],
    pattern: RegExp,
  ) {
    const match = query.match(pattern);
    return match ? params[Number(match[1]) - 1] : undefined;
  }

  type NotificationDeliveryFilter = {
    deliveryId: string | undefined;
    recipientUserId: string | undefined;
    eventId: string | undefined;
    eventIds: Set<string>;
    unreadOnly: boolean;
    undismissedOnly: boolean;
  };

  function notificationDeliveryMatches(
    delivery: (typeof state.notificationDeliveries)[number],
    filter: NotificationDeliveryFilter,
  ) {
    return (
      (!filter.deliveryId || delivery.id === filter.deliveryId) &&
      (!filter.recipientUserId ||
        delivery.recipientUserId === filter.recipientUserId) &&
      (!filter.eventId || delivery.eventId === filter.eventId) &&
      (filter.eventIds.size === 0 || filter.eventIds.has(delivery.eventId)) &&
      (!filter.unreadOnly || !delivery.readAt) &&
      (!filter.undismissedOnly || !delivery.dismissedAt)
    );
  }

  function applyNotificationDeliveryUpdate(
    delivery: (typeof state.notificationDeliveries)[number],
    readAt: unknown,
    dismissedAt: unknown,
  ) {
    if (readAt !== undefined) delivery.readAt = readAt as Date | null;
    if (dismissedAt !== undefined) {
      delivery.dismissedAt = dismissedAt as Date | null;
    }
  }

  function updateNotificationRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('update "notification_delivery"')) {
      const placeholderValue = (pattern: RegExp) =>
        queryPlaceholderValue(query, params, pattern);
      const readAt = placeholderValue(/set[\s\S]*?"read_at" = \$(\d+)/);
      const dismissedAt = placeholderValue(
        /set[\s\S]*?"dismissed_at" = \$(\d+)/,
      );
      const deliveryId = placeholderValue(
        /where[\s\S]*?"notification_delivery"\."id" = \$(\d+)/,
      ) as string | undefined;
      const recipientUserId = placeholderValue(
        /where[\s\S]*?"notification_delivery"\."recipient_user_id" = \$(\d+)/,
      ) as string | undefined;
      const eventPlaceholders =
        query
          .match(/"notification_delivery"\."event_id" in \(([^)]+)\)/)?.[1]
          ?.match(/\$(\d+)/g) ?? [];
      const eventIds = new Set(
        eventPlaceholders.map(
          (placeholder) => params[Number(placeholder.slice(1)) - 1] as string,
        ),
      );
      const eventId = placeholderValue(
        /where[\s\S]*?"notification_delivery"\."event_id" = \$(\d+)/,
      ) as string | undefined;
      const filter: NotificationDeliveryFilter = {
        deliveryId,
        recipientUserId,
        eventId,
        eventIds,
        unreadOnly: query.includes('"read_at" is null'),
        undismissedOnly: query.includes('"dismissed_at" is null'),
      };
      for (const delivery of state.notificationDeliveries) {
        if (notificationDeliveryMatches(delivery, filter)) {
          applyNotificationDeliveryUpdate(delivery, readAt, dismissedAt);
        }
      }
      return [];
    }

    return undefined;
  }

  function updateAccountRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('update "user_email"')) {
      const setsPrimaryOnly = query.includes('set "is_primary" =');
      if (setsPrimaryOnly) {
        const userId = params.at(-2) as string;
        const excludedEmail = params.at(-1) as string;
        clearOtherPrimaryEmails(userId, excludedEmail);
        return [];
      }

      const email = params.at(-2) as string;
      const userId = params.at(-1) as string;
      const candidate = state.userEmails.find(
        (item) => item.email === email && item.userId === userId,
      );
      if (candidate) {
        candidate.verified = params[0] as boolean;
        candidate.isPrimary = params[1] as boolean;
        candidate.updatedAt = date;
      }
      return [];
    }

    return undefined;
  }

  function clearOtherPrimaryEmails(userId: string, excludedEmail: string) {
    for (const candidate of state.userEmails) {
      if (candidate.userId === userId && candidate.email !== excludedEmail) {
        candidate.isPrimary = false;
      }
    }
  }

  function updateHouseholdRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('update "organization"')) {
      const householdId = params.at(-1) as string;
      const organization = state.organizations.find(
        (candidate) => candidate.id === householdId,
      );
      if (!organization) return [];
      organization.name = params[0] as string;
      organization.updatedAt = date;
      return query.includes("returning") ? [organizationRow(organization)] : [];
    }

    if (query.startsWith('update "cooking_session"')) {
      const completedAt = params[0] as Date;
      const sessionId = params[1] as string;
      const userId = params[2] as string;
      const session = state.cookingSessions.find(
        (candidate) =>
          candidate.id === sessionId &&
          candidate.userId === userId &&
          candidate.completedAt === null,
      );
      if (session) session.completedAt = completedAt;
      return [];
    }

    return undefined;
  }

  function updatePantryRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('update "pantry_item"')) {
      const userId = (params[0] as string | null) ?? null;
      const organizationId = (params[1] as string | null) ?? null;
      const previousOwnerId = params.at(-1) as string;
      const personal = isPersonalPantryQuery(query);
      for (const item of state.pantryItems) {
        const matchesPreviousOwner = personal
          ? item.userId === previousOwnerId
          : item.organizationId === previousOwnerId;
        if (matchesPreviousOwner) {
          item.userId = userId;
          item.organizationId = organizationId;
          item.updatedAt = date;
        }
      }
      return [];
    }

    return undefined;
  }

  function updatePantryAggregateRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('update "pantry_aggregate"')) {
      if (query.includes('"revision" = "pantry_aggregate"."revision" + 1')) {
        return incrementPantryAggregateRevision(params.at(-1) as string);
      }
      const userId = (params[0] as string | null) ?? null;
      const organizationId = (params[1] as string | null) ?? null;
      const previousOwnerId = params.at(-1) as string;
      const personal = query.includes('"pantry_aggregate"."user_id" =');
      reassignPantryAggregates(
        userId,
        organizationId,
        previousOwnerId,
        personal,
      );
      return [];
    }

    return undefined;
  }

  function incrementPantryAggregateRevision(aggregateId: string): QueryRows {
    const aggregate = state.pantryAggregates.find(
      (candidate) => candidate.id === aggregateId,
    );
    if (!aggregate) return [];
    aggregate.revision += 1n;
    aggregate.updatedAt = date;
    return [[aggregate.revision.toString()]];
  }

  function reassignPantryAggregates(
    userId: string | null,
    organizationId: string | null,
    previousOwnerId: string,
    personal: boolean,
  ) {
    for (const aggregate of state.pantryAggregates) {
      const matchesPreviousOwner = personal
        ? aggregate.userId === previousOwnerId
        : aggregate.organizationId === previousOwnerId;
      if (matchesPreviousOwner) {
        aggregate.userId = userId;
        aggregate.organizationId = organizationId;
        aggregate.updatedAt = date;
      }
    }
  }

  function deletePantryRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('delete from "app_rate_limit"')) {
      state.rateLimitSweeps += 1;
      return [];
    }

    if (query.startsWith('delete from "pantry_item"')) {
      const ownerId = params[0] as string;
      const ingredientSlugs = new Set(params.slice(1) as string[]);
      const personal = isPersonalPantryQuery(query);
      state.pantryItems = state.pantryItems.filter(
        (item) =>
          !(
            (personal
              ? item.userId === ownerId
              : item.organizationId === ownerId) &&
            (ingredientSlugs.size === 0 ||
              ingredientSlugs.has(item.ingredientSlug))
          ),
      );
      return [];
    }

    if (query.startsWith('delete from "pantry_operation"')) {
      if (query.includes('"created_at" <')) {
        state.pantryOperationSweeps += 1;
        return [];
      }
      const aggregateId = params[0] as string;
      const operationId = params[1] as string | undefined;
      state.pantryOperations = state.pantryOperations.filter(
        (operation) =>
          operation.aggregateId !== aggregateId ||
          (operationId !== undefined && operation.operationId !== operationId),
      );
      return [];
    }

    if (query.startsWith('delete from "pantry_aggregate"')) {
      const ownerId = params[0] as string;
      const personal = query.includes('"pantry_aggregate"."user_id" =');
      const removedIds = new Set(
        state.pantryAggregates
          .filter((aggregate) =>
            personal
              ? aggregate.userId === ownerId
              : aggregate.organizationId === ownerId,
          )
          .map((aggregate) => aggregate.id),
      );
      state.pantryAggregates = state.pantryAggregates.filter(
        (aggregate) => !removedIds.has(aggregate.id),
      );
      state.pantryOperations = state.pantryOperations.filter(
        (operation) => !removedIds.has(operation.aggregateId),
      );
      return [];
    }

    return undefined;
  }

  function deleteAccountRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('delete from "member"')) {
      const memberId = params[0] as string;
      state.members = state.members.filter((member) => member.id !== memberId);
      return [];
    }

    if (query.startsWith('delete from "organization"')) {
      const householdId = params[0] as string;
      state.organizations = state.organizations.filter(
        (organization) => organization.id !== householdId,
      );
      state.members = state.members.filter(
        (member) => member.organizationId !== householdId,
      );
      state.invitations = state.invitations.filter(
        (invitation) => invitation.organizationId !== householdId,
      );
      return [];
    }

    if (query.startsWith('delete from "user_diet_preset"')) {
      const userId = params[0] as string;
      state.userDietPresets = state.userDietPresets.filter(
        (selection) => selection.userId !== userId,
      );
      return [];
    }

    if (query.startsWith('delete from "user_diet_excluded_ingredient"')) {
      const userId = params[0] as string;
      state.userDietExcludedIngredients =
        state.userDietExcludedIngredients.filter(
          (selection) => selection.userId !== userId,
        );
      return [];
    }

    return undefined;
  }

  function deleteUserStateRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('delete from "user_diet_excluded_group"')) {
      const userId = params[0] as string;
      state.userDietExcludedGroups = state.userDietExcludedGroups.filter(
        (selection) => selection.userId !== userId,
      );
      return [];
    }

    if (query.startsWith('delete from "user_recipe_box_item"')) {
      const userId = params[0] as string;
      state.recipeBoxItems = state.recipeBoxItems.filter(
        (item) => item.userId !== userId,
      );
      return [];
    }

    if (query.startsWith('delete from "user_follow"')) {
      const followerUserId = params[0] as string;
      const followedUserId = params[1] as string;
      state.userFollows = state.userFollows.filter(
        (follow) =>
          follow.followerUserId !== followerUserId ||
          follow.followedUserId !== followedUserId,
      );
      return [];
    }

    return undefined;
  }

  function updateRecipeRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.startsWith('update "recipe"')) {
      if (
        query.includes('"recipe"."user_id"') &&
        query.includes('"recipe"."visibility"') &&
        !query.includes('"recipe"."id"')
      ) {
        const visibility = params[0] as RecipeRow["visibility"];
        const userId = params.at(-1) as string;
        updateUserHouseholdRecipeVisibility(userId, visibility);
        return [];
      }

      const recipeId = params.at(-2) as string;
      const userId = params.at(-1) as string;
      const recipe = state.recipes.find(
        (candidate) => candidate.id === recipeId && candidate.userId === userId,
      );
      if (!recipe) return [];
      recipe.visibility = params[0] as RecipeRow["visibility"];
      recipe.updatedAt = date;
      return [recipeRow(recipe)];
    }

    return undefined;
  }

  function updateUserHouseholdRecipeVisibility(
    userId: string,
    visibility: RecipeRow["visibility"],
  ) {
    for (const recipe of state.recipes) {
      if (recipe.visibility === "household" && recipe.userId === userId) {
        recipe.visibility = visibility;
        recipe.updatedAt = date;
      }
    }
  }

  function selectOrganizationRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.includes('from "organization"') && query.includes('"organization"."id"')) {
      const householdId = params[0] as string;
      return state.organizations
        .filter((organization) => organization.id === householdId)
        .map(organizationRow);
    }

    return undefined;
  }

  function countNotificationRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (
      query.includes('count(*)') &&
      query.includes('from "notification_delivery"')
    ) {
      const recipientUserId = params[0] as string | undefined;
      return [
        [
          state.notificationDeliveries.filter(
            (delivery) =>
              (!recipientUserId ||
                delivery.recipientUserId === recipientUserId) &&
              !delivery.readAt &&
              !delivery.dismissedAt,
          ).length,
        ],
      ];
    }

    return undefined;
  }

  function selectNotificationRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (
      query.includes('from "notification_delivery"') &&
      query.includes('inner join "notification_event"')
    ) {
      const selectsBase = query.includes('"notification_event"."actor_user_id"');
      const notificationId = query.includes('"notification_delivery"."id" =')
        ? (params[0] as string)
        : undefined;
      const recipientUserId = (notificationId ? params[1] : params[0]) as
        | string
        | undefined;
      return state.notificationDeliveries
        .filter(
          (delivery) =>
            (!notificationId || delivery.id === notificationId) &&
            (!recipientUserId || delivery.recipientUserId === recipientUserId) &&
            !delivery.dismissedAt,
        )
        .map((delivery) => {
          const event = state.notificationEvents.find(
            (candidate) => candidate.id === delivery.eventId,
          )!;
          return selectsBase
            ? [
                delivery.id,
                event.id,
                event.kind,
                event.actorUserId,
                event.actorNameSnapshot,
                delivery.readAt,
                event.occurredAt,
              ]
            : [event.id, event.kind];
        });
    }

    return undefined;
  }

  function selectNotificationDetailRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (
      query.includes('from "notification_household_invitation_event"') &&
      !query.includes('join')
    ) {
      if (query.includes('"invitation_id" =')) {
        const invitationId = params[0] as string;
        return state.notificationHouseholdInvitationEvents
          .filter((row) => row.invitationId === invitationId)
          .map((row) => [row.eventId]);
      }
      const eventId = params[0] as string;
      return state.notificationHouseholdInvitationEvents
        .filter((row) => row.eventId === eventId)
        .map((row) => [row.invitationId]);
    }

    if (
      query.includes('from "notification_household_event"') &&
      query.includes('left join "notification_household_invitation_event"')
    ) {
      const eventIds = new Set(params as string[]);
      return state.notificationHouseholdEvents
        .filter((row) => eventIds.has(row.eventId))
        .map((row) => {
          const invitationEvent =
            state.notificationHouseholdInvitationEvents.find(
              (candidate) => candidate.eventId === row.eventId,
            );
          const invitation = state.invitations.find(
            (candidate) => candidate.id === invitationEvent?.invitationId,
          );
          return [
            row.eventId,
            row.householdId,
            row.householdNameSnapshot,
            invitation?.status ?? null,
            invitation?.expiresAt ?? null,
          ];
        });
    }

    if (query.includes('from "notification_recipe_recommendation_event"')) {
      const eventIds = new Set(params as string[]);
      return state.notificationRecipeRecommendationEvents
        .filter((row) => eventIds.has(row.eventId))
        .map((row) => {
          if (!query.includes('left join "recipe"')) {
            return [row.recipeId, row.recipeSlugSnapshot];
          }
          const recipe = state.recipes.find(
            (candidate) => candidate.id === row.recipeId,
          );
          return [
            row.eventId,
            row.recipeId,
            row.recipeSlugSnapshot,
            row.recipeTitleSnapshot,
            recipe?.visibility ?? null,
            recipe?.userId ?? null,
          ];
        });
    }

    if (query.includes('from "notification_agent_approval_event"')) {
      const eventIds = new Set(params as string[]);
      return state.notificationAgentApprovalEvents
        .filter((row) => eventIds.has(row.eventId))
        .map((row) => [
          row.eventId,
          row.agentIdSnapshot,
          row.agentNameSnapshot,
          row.capabilitiesSnapshot,
          row.expiresAtSnapshot,
          row.approvalCodeCiphertext,
          row.approvalStatus,
          row.approvalExpiresAt,
        ]);
    }

    return undefined;
  }

  function selectUserRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (
      query.includes('from "user"') &&
      query.includes('"user"."email" =')
    ) {
      const email = params[0] as string;
      return state.users
        .filter((candidate) => candidate.email === email)
        .map((candidate) => [candidate.id]);
    }

    if (
      query.includes('from "user"') &&
      query.includes('"user"."id" =')
    ) {
      const userId = params[0] as string;
      return state.users
        .filter((candidate) => candidate.id === userId)
        .map((candidate) => [candidate.id]);
    }

    if (
      query.includes('from "user_follow"') &&
      query.includes('inner join "user"') &&
      !query.includes('from "recipe"')
    ) {
      const cookId = params[0] as string;
      const selectsFollowers = query.includes(
        'where "user_follow"."followed_user_id" =',
      );
      const connections = state.userFollows
        .filter((follow) =>
          selectsFollowers
            ? follow.followedUserId === cookId
            : follow.followerUserId === cookId,
        )
        .sort(
          (first, second) =>
            second.createdAt.getTime() - first.createdAt.getTime(),
        );
      const connectedIds = connections
        .map((follow) =>
          selectsFollowers ? follow.followerUserId : follow.followedUserId,
        );
      const requestedLimit = query.includes("limit ")
        ? (params.at(-1) as number)
        : connectedIds.length;
      return connectedIds.slice(0, requestedLimit).map((connectedId) => {
        const user = state.users.find(
          (candidate) => candidate.id === connectedId,
        )!;
        return [user.id, user.name, user.image, connectedIds.length];
      });
    }

    if (
      query.includes('from "user_follow"') &&
      !query.includes('from "recipe"')
    ) {
      const followerUserId = params[0] as string;
      const followedUserId = params[1] as string | undefined;
      return state.userFollows
        .filter(
          (follow) =>
            follow.followerUserId === followerUserId &&
            (!followedUserId || follow.followedUserId === followedUserId),
        )
        .map((follow) => [follow.followedUserId]);
    }

    return undefined;
  }

  function selectUserEmailRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (
      query.includes('from "user_email"') &&
      query.includes('"user_email"."email" =')
    ) {
      const email = params[0] as string;
      const verified = params[1] as boolean | undefined;
      return state.userEmails
        .filter(
          (candidate) =>
            candidate.email === email &&
            (verified === undefined || candidate.verified === verified),
        )
        .map((candidate) => [candidate.userId]);
    }

    if (query.includes('from "user_email"')) {
      const userId = params[0] as string;
      const verified = params[1] as boolean;
      return state.userEmails
        .filter(
          (candidate) =>
            candidate.userId === userId && candidate.verified === verified,
        )
        .map((candidate) => [candidate.email]);
    }

    return undefined;
  }

  function selectMembershipRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (
      query.includes('from "member"') &&
      query.includes('left join "organization"')
    ) {
      const userId = params[0] as string;
      return state.members
        .filter((member) => member.userId === userId)
        .map((member) => {
          const organization = state.organizations.find(
            (candidate) => candidate.id === member.organizationId,
          );
          return [
            organization?.id ?? null,
            organization?.name ?? null,
          ];
        });
    }

    if (
      query.includes('from "member"') &&
      query.includes('inner join "organization"')
    ) {
      const userId = params[0] as string;
      return state.members
        .filter((member) => member.userId === userId)
        .map((member) => {
          const organization = state.organizations.find(
            (candidate) => candidate.id === member.organizationId,
          )!;
          return [
            organization.id,
            organization.name,
            organization.slug,
            organization.logo,
            organization.createdAt,
            organization.updatedAt,
            member.id,
            member.role,
          ];
        });
    }

    return undefined;
  }

  function selectHouseholdRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.includes('from "member" inner join "user"')) {
      const householdId = params[0] as string;
      return state.members
        .filter((member) => member.organizationId === householdId)
        .map((member) => {
          const user = state.users.find((candidate) => candidate.id === member.userId)!;
          return [
            member.id,
            member.organizationId,
            member.userId,
            member.role,
            member.createdAt,
            user.id,
            user.email,
            user.name,
            user.image,
          ];
        });
    }

    if (
      query.includes('from "member"') &&
      query.includes('"member"."organization_id"') &&
      query.includes('"member"."role"')
    ) {
      const householdId = params[0] as string;
      const role = params[1] as string;
      return state.members
        .filter(
          (member) =>
            member.organizationId === householdId && member.role === role,
        )
        .map(memberRow);
    }

    return undefined;
  }

  function selectPantryRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.includes('from "pantry_item"')) {
      const ownerId = params[0] as string;
      const personal = isPersonalPantryQuery(query);
      const pantryItems = state.pantryItems.filter((item) =>
        personal
          ? item.userId === ownerId
          : item.organizationId === ownerId,
      );
      return pantryItems.map((item) => {
        if (query.includes('select "ingredient_slug", "location", "version"')) {
          return [
            item.ingredientSlug,
            item.location,
            (item.version ?? 1n).toString(),
          ];
        }
        return query.includes('select "ingredient_slug"')
          ? [item.ingredientSlug]
          : [item.id];
      });
    }


    if (query.includes('from "pantry_aggregate"')) {
      const ownerId = params[0] as string;
      const personal = query.includes('"pantry_aggregate"."user_id" =');
      return state.pantryAggregates
        .filter((aggregate) =>
          personal
            ? aggregate.userId === ownerId
            : aggregate.organizationId === ownerId,
        )
        .map((aggregate) => [aggregate.id, aggregate.revision.toString()]);
    }

    if (query.includes('from "pantry_operation"')) {
      const [aggregateId, operationId] = params as [string, string];
      return state.pantryOperations
        .filter(
          (operation) =>
            operation.aggregateId === aggregateId &&
            operation.operationId === operationId,
        )
        .map((operation) => [operation.commandFingerprint, operation.result]);
    }

    return undefined;
  }

  function selectMemberRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (
      query.includes('from "member"') &&
      query.includes('"member"."id"') &&
      query.includes('"member"."organization_id"')
    ) {
      const memberId = params[0] as string;
      const householdId = params[1] as string;
      return state.members
        .filter(
          (member) =>
            member.id === memberId && member.organizationId === householdId,
        )
        .map(memberRow);
    }

    if (
      query.includes('from "member"') &&
      query.includes('"member"."organization_id"') &&
      query.includes('"member"."user_id"') &&
      params.length > 1
    ) {
      const householdId = params[0] as string;
      const userId = params[1] as string;
      return state.members
        .filter(
          (member) =>
            member.organizationId === householdId && member.userId === userId,
        )
        .map((member) => (query.includes('"member"."id"') ? [member.id] : memberRow(member)));
    }

    if (
      query.includes('from "member"') &&
      query.includes('"member"."organization_id"') &&
      params.length === 1
    ) {
      const householdId = params[0] as string;
      return state.members
        .filter((member) => member.organizationId === householdId)
        .map((member) => [member.userId]);
    }

    if (
      query.includes('from "member"') &&
      query.includes('"member"."user_id"')
    ) {
      const userId = params[0] as string;
      return state.members
        .filter((member) => member.userId === userId)
        .map(memberRow);
    }

    return undefined;
  }

  function selectInvitationRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (
      query.includes('from "invitation"') &&
      query.includes('inner join "organization"')
    ) {
      const statusIndex = params.indexOf("pending");
      const emails = new Set(params.slice(0, statusIndex) as string[]);
      const status = params[statusIndex] as string;
      const expiresAfter = new Date(params[statusIndex + 1] as string);
      return state.invitations
        .filter(
          (invitation) =>
            emails.has(invitation.email) &&
            invitation.status === status &&
            invitation.expiresAt > expiresAfter,
        )
        .map((invitation) => {
          const organization = state.organizations.find(
            (candidate) => candidate.id === invitation.organizationId,
          );
          return [
            ...invitationRow(invitation),
            organization?.id,
            organization?.name,
          ];
        });
    }

    if (
      query.includes('from "invitation"') &&
      query.includes('"invitation"."organization_id"') &&
      query.includes('"invitation"."status"') &&
      !query.includes('"invitation"."email"')
    ) {
      const organizationId = params[0] as string;
      const status = params[1] as string;
      return state.invitations
        .filter(
          (invitation) =>
            invitation.organizationId === organizationId &&
            invitation.status === status,
        )
        .map(invitationRow);
    }

    if (query.includes('from "invitation"') && query.includes('"invitation"."id"')) {
      const invitationId = params[0] as string;
      return state.invitations
        .filter((invitation) => invitation.id === invitationId)
        .map(invitationRow);
    }

    if (
      query.includes('from "invitation"') &&
      query.includes('"invitation"."email"')
    ) {
      const organizationId = params[0] as string;
      const email = params[1] as string;
      const status = params[2] as string;
      const expiresAfterValue = params[3];
      const expiresAfter = expiresAfterValue
        ? new Date(expiresAfterValue as string)
        : undefined;
      return state.invitations
        .filter(
          (invitation) =>
            invitation.organizationId === organizationId &&
            invitation.email === email &&
            invitation.status === status &&
            (!expiresAfter || invitation.expiresAt > expiresAfter),
        )
        .map(invitationRow);
    }

    return undefined;
  }

  function selectRecipeFeedRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (
      query.includes('from "recipe"') &&
      query.includes('inner join "user"') &&
      query.includes("::text")
    ) {
      const viewerId = (
        authzMock.session as { user?: { id?: string } } | null
      )?.user?.id;
      const viewerMembership = state.members.find(
        (member) => member.userId === viewerId,
      );
      const householdUserIds = new Set(
        viewerMembership
          ? state.members
              .filter(
                (member) =>
                  member.organizationId === viewerMembership.organizationId,
              )
              .map((member) => member.userId)
          : [],
      );
      const followedUserIds = new Set(
        state.userFollows
          .filter((follow) => follow.followerUserId === viewerId)
          .map((follow) => follow.followedUserId),
      );
      const personalized =
        query.includes('"recipe"."user_id" in') ||
        query.includes('from "user_follow"');
      const visibleRecipes = state.recipes.filter((recipe) =>
        personalized
          ? (householdUserIds.has(recipe.userId) &&
              (recipe.visibility === "public" ||
                recipe.visibility === "household")) ||
            (followedUserIds.has(recipe.userId) &&
              recipe.visibility === "public")
          : recipe.visibility === "public",
      );
      const cursorParamCount = query.includes("::timestamptz") ? 3 : 0;
      const limitParamCount = query.includes("limit ") ? 1 : 0;
      const cursorParamIndex =
        params.length - cursorParamCount - limitParamCount;
      return paginatedRecipeRows(
        visibleRecipes,
        query,
        params,
        cursorParamIndex,
      ).map((row) => {
        const user = state.users.find((candidate) => candidate.id === row[5])!;
        return [...row, user.id, user.name, user.image];
      });
    }

    return undefined;
  }

  function selectRecipeFeedSummaryRows(
    query: string,
  ): QueryRows | undefined {
    if (
      query.includes('from "recipe"') &&
      query.includes('inner join "user"') &&
      query.includes('group by')
    ) {
      const publicRecipes = state.recipes.filter(
        (recipe) => recipe.visibility === "public",
      );
      const grouped = new Map<string, RecipeRow[]>();
      for (const recipe of publicRecipes) {
        const recipes = grouped.get(recipe.userId) ?? [];
        recipes.push(recipe);
        grouped.set(recipe.userId, recipes);
      }
      return Array.from(grouped, ([userId, recipes]) => {
        const user = state.users.find((candidate) => candidate.id === userId)!;
        const latest = [...recipes].sort(
          (first, second) =>
            second.createdAt.getTime() - first.createdAt.getTime() ||
            second.id.localeCompare(first.id),
        )[0]!;
        return [user.id, user.name, user.image, recipes.length, latest.title];
      });
    }

    return undefined;
  }

  function selectCookRecipeRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (
      query.includes('from "recipe"') &&
      query.includes('inner join "user"') &&
      query.includes('"user"."id" =')
    ) {
      const cookId = params[1] as string;
      const user = state.users.find((candidate) => candidate.id === cookId);
      if (!user) return [];
      return state.recipes
        .filter(
          (recipe) =>
            recipe.userId === cookId && recipe.visibility === "public",
        )
        .sort(
          (first, second) =>
            second.createdAt.getTime() - first.createdAt.getTime() ||
            second.id.localeCompare(first.id),
        )
        .slice(0, 30)
        .map((recipe) => [
          ...recipeRow(recipe),
          user.id,
          user.name,
          user.image,
        ]);
    }

    return undefined;
  }

  function selectScopedRecipeRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (
      query.includes('from "recipe"') &&
      query.includes('"recipe"."slug" =') &&
      query.includes('"recipe"."user_id" =')
    ) {
      const slug = params[0] as string;
      const userId = params[1] as string;
      return state.recipes
        .filter((recipe) => recipe.slug === slug && recipe.userId === userId)
        .map(recipeRow);
    }

    if (
      query.includes('from "recipe"') &&
      query.includes('"recipe"."user_id" =') &&
      !query.includes('"recipe"."visibility" =')
    ) {
      const userId = params[0] as string;
      return paginatedRecipeRows(
        state.recipes.filter((recipe) => recipe.userId === userId),
        query,
        params,
        1,
      );
    }

    if (
      query.includes('from "recipe"') &&
      query.includes('"recipe"."slug" =')
    ) {
      const slug = params[0] as string;
      return state.recipes
        .filter((recipe) => recipe.slug === slug)
        .map(recipeRow);
    }

    return undefined;
  }

  function selectVisibleRecipeRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.includes('from "recipe"')) {
      const trailingParams =
        (query.includes("::timestamptz") ? 3 : 0) +
        (query.includes("limit ") ? 1 : 0);
      const filterParams = params.slice(0, params.length - trailingParams);
      const publicVisibility = filterParams[0] as string | undefined;
      const ownerUserId = filterParams[1] as string | undefined;
      const householdVisibilityIndex = filterParams.indexOf("household");
      const householdUserIds =
        householdVisibilityIndex >= 0
          ? new Set(filterParams.slice(householdVisibilityIndex + 1))
          : new Set();

      return paginatedRecipeRows(
        state.recipes.filter(
          (recipe) =>
            recipe.visibility === publicVisibility ||
            recipe.userId === ownerUserId ||
            (recipe.visibility === "household" &&
              householdUserIds.has(recipe.userId)),
        ),
        query,
        params,
        filterParams.length,
      );
    }

    return undefined;
  }

  function selectCatalogRows(
    query: string,
  ): QueryRows | undefined {
    if (query.includes('from "diet_preset_excluded_group"')) {
      return state.dietPresetExcludedGroups.map((row) => [
        row.presetKey,
        row.groupKey,
      ]);
    }

    if (query.includes('from "diet_preset_excluded_ingredient"')) {
      return state.dietPresetExcludedIngredients.map((row) => [
        row.presetKey,
        row.ingredientSlug,
      ]);
    }

    if (query.includes('from "ingredient_group_member"')) {
      return state.ingredientGroupMembers.map((row) => [
        row.groupKey,
        row.ingredientSlug,
      ]);
    }

    if (query.includes('from "ingredient_group_hierarchy"')) {
      return state.ingredientGroupHierarchy.map((row) => [
        row.narrowerGroupKey,
        row.broaderGroupKey,
        row.relationType,
      ]);
    }

    return undefined;
  }

  function selectDietCatalogRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.includes('from "diet_preset"')) {
      if (params.length > 0) {
        const keys = new Set(params as string[]);
        return state.dietPresets
          .filter((preset) => keys.has(preset.key))
          .map((preset) => [preset.key]);
      }
      return state.dietPresets.map((preset) => [
        preset.key,
        preset.label,
        preset.description,
      ]);
    }

    return undefined;
  }

  function selectIngredientGroupRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.includes('from "ingredient_group"')) {
      if (params.length > 0) {
        const keys = new Set(params as string[]);
        return state.ingredientGroups
          .filter((group) => keys.has(group.key))
          .map((group) => [group.key]);
      }
      return state.ingredientGroups.map((group) => [
        group.key,
        group.label,
        group.description,
      ]);
    }

    return undefined;
  }

  function selectIngredientRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.includes('from "ingredient"')) {
      if (params.length > 0) {
        const slugs = new Set(params as string[]);
        return state.ingredients
          .filter((ingredient) => slugs.has(ingredient.slug))
          .map((ingredient) => [ingredient.slug]);
      }
      return state.ingredients.map((ingredient) => [
        ingredient.slug,
        ingredient.name,
        ingredient.category,
      ]);
    }

    return undefined;
  }

  function selectDietRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.includes('from "user_diet_preset"')) {
      const userId = params[0] as string;
      return state.userDietPresets
        .filter((selection) => selection.userId === userId)
        .map((selection) => [selection.presetKey]);
    }

    if (query.includes('from "user_diet_excluded_ingredient"')) {
      const userId = params[0] as string;
      return state.userDietExcludedIngredients
        .filter((selection) => selection.userId === userId)
        .map((selection) => [selection.ingredientSlug]);
    }

    if (query.includes('from "user_diet_excluded_group"')) {
      const userId = params[0] as string;
      return state.userDietExcludedGroups
        .filter((selection) => selection.userId === userId)
        .map((selection) => [selection.groupKey]);
    }

    if (query.includes('from "user_diet_profile"')) {
      const userId = params[0] as string;
      return state.dietProfiles
        .filter((profile) => profile.userId === userId)
        .map(dietProfileRow);
    }

    return undefined;
  }

  function selectCookingSessionRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.includes('from "cooking_session"')) {
      const userId = query.includes('"cooking_session"."id" =')
        ? (params[1] as string)
        : (params[0] as string);
      const sessions = state.cookingSessions.filter(
        (session) => session.userId === userId,
      );

      if (query.includes("count(distinct")) {
        return [
          [
            new Set(
              sessions
                .filter((session) => session.completedAt)
                .map((session) => session.recipeSlug),
            ).size,
          ],
        ];
      }
      if (query.includes("count(*)")) {
        return [
          [
            sessions.length,
            sessions.filter((session) => session.completedAt).length,
          ],
        ];
      }

      const selected = query.includes('"cooking_session"."id" =')
        ? sessions.filter((session) => session.id === params[0])
        : sessions
            .filter((session) => session.completedAt)
            .sort(
              (first, second) =>
                second.completedAt!.getTime() - first.completedAt!.getTime(),
            )
            .slice(0, 20);
      return selected.map((session) => [
        session.id,
        session.recipeSlug,
        session.recipeTitle,
        session.servings,
        session.startedAt,
        session.completedAt,
      ]);
    }

    return undefined;
  }

  function selectRecipeBoxRows(
    query: string,
    params: unknown[],
  ): QueryRows | undefined {
    if (query.includes('from "user_recipe_box_item"')) {
      const userId = params[0] as string;
      return state.recipeBoxItems
        .filter((item) => item.userId === userId)
        .map((item) => [item.recipeSlug]);
    }

    if (query.includes('from "user_recipe_box"')) {
      const userId = params[0] as string;
      return state.recipeBoxes
        .filter((box) => box.userId === userId)
        .map((box) => [box.completedAt]);
    }

    if (query.startsWith('insert into "verification"')) {
      return [params];
    }

    return undefined;
  }

  const queryRowsHandlers: QueryRowsHandler[] = [
    queryShoppingRows,
    updateShoppingRows,
    selectShoppingRows,
    insertCoreRows,
    insertNotificationRows,
    insertAccountRows,
    insertFollowRows,
    insertMembershipRows,
    insertPantryRows,
    insertPantryOperationRows,
    insertPantryItemRows,
    insertUserStateRows,
    insertRecipeBoxStateRows,
    insertCookingSessionRows,
    insertDietSelectionRows,
    updateInvitationRows,
    updateNotificationRows,
    updateAccountRows,
    updateHouseholdRows,
    updatePantryRows,
    updatePantryAggregateRows,
    deletePantryRows,
    deleteAccountRows,
    deleteUserStateRows,
    updateRecipeRows,
    selectOrganizationRows,
    countNotificationRows,
    selectNotificationRows,
    selectNotificationDetailRows,
    selectUserRows,
    selectUserEmailRows,
    selectMembershipRows,
    selectHouseholdRows,
    selectPantryRows,
    selectMemberRows,
    selectInvitationRows,
    selectRecipeFeedRows,
    selectRecipeFeedSummaryRows,
    selectCookRecipeRows,
    selectScopedRecipeRows,
    selectVisibleRecipeRows,
    selectCatalogRows,
    selectDietCatalogRows,
    selectIngredientGroupRows,
    selectIngredientRows,
    selectDietRows,
    selectCookingSessionRows,
    selectRecipeBoxRows,
  ];

  function queryRows(query: string, params: unknown[] = []): QueryRows {
    for (const handler of queryRowsHandlers) {
      const rows = handler(query, params);
      if (rows) return rows;
    }
    return [];
  }

  return { date, state, reset, queryRows };
});

vi.mock("../src/http/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/http/authorization")>();
  return {
    ...actual,
    loadBetterAuthSession: vi.fn(() => Promise.resolve(authzMock.session)),
  };
});

vi.mock("postgres", () => ({
  default: vi.fn(() => {
    // drizzle-orm/postgres-js/driver.js writes transparent parsers into
    // client.options.parsers / .serializers at construction time, so the mock
    // client must expose those empty objects. Queries go through:
    //   client.unsafe(sql, params).values() — SELECT (drizzle maps array-of-arrays)
    //   client.unsafe(sql, params)          — DML
    const queryResult = (rows: unknown[][] = []) =>
      Object.assign(Promise.resolve(rows), {
        values: () => Promise.resolve(rows),
      });
    const emptyResult = queryResult();
    const client = Object.assign(
      (_strings: TemplateStringsArray, ..._values: unknown[]) => emptyResult,
      {
        options: { parsers: {}, serializers: {} },
        unsafe: (query: string, params: unknown[] = []) => {
          const rows = dbMock.queryRows(query, params);
          return rows.length > 0 ? queryResult(rows) : emptyResult;
        },
        begin: <T>(transaction: (sql: unknown) => Promise<T>) =>
          transaction(client),
        end: (_options?: { timeout?: number }) => Promise.resolve(),
      },
    );
    return client;
  }),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(() => Promise.resolve({ payload: { sub: "tester" } })),
}));

import handler, { app } from "../src/index";
import { encryptAgentApprovalCode } from "../src/notifications";

// Route ids are validated as UUIDs before any query runs, so seeded rows and
// request paths use fixed UUID ids.
const HOUSEHOLD_ID = "11111111-1111-4111-8111-111111111111";
const MISSING_HOUSEHOLD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_MEMBER_ID = "33333333-3333-4333-8333-333333333333";
const MEMBER_MEMBER_ID = "44444444-4444-4444-8444-444444444444";
const INVITATION_ID = "22222222-2222-4222-8222-222222222222";
const PENDING_INVITATION_ID = "55555555-5555-4555-8555-555555555555";
const ALIAS_INVITATION_ID = "66666666-6666-4666-8666-666666666666";
const EXPIRING_INVITATION_ID = "77777777-7777-4777-8777-777777777777";

function sessionFor(user: { id: string; email: string; name: string }) {
  const email = user.email.toLowerCase();
  if (!dbMock.state.userEmails.some((candidate) => candidate.email === email)) {
    dbMock.state.userEmails.push({
      email,
      userId: user.id,
      verified: true,
      isPrimary: true,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
  }
  return {
    user: {
      id: user.id,
      email,
      name: user.name,
      emailVerified: true,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
    session: {
      id: `session-${user.id}`,
      token: `token-${user.id}`,
      userId: user.id,
      expiresAt: new Date("2027-01-02T00:00:00.000Z"),
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
  };
}

function seedHousehold() {
  dbMock.state.users.push(
    {
      id: "owner-user",
      name: "Owner",
      email: "owner@example.test",
      emailVerified: true,
      image: null,
      role: "user",
      banned: null,
      banReason: null,
      banExpires: null,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
    {
      id: "member-user",
      name: "Member",
      email: "member@example.test",
      emailVerified: true,
      image: null,
      role: "user",
      banned: null,
      banReason: null,
      banExpires: null,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
    {
      id: "outsider-user",
      name: "Outsider",
      email: "outsider@example.test",
      emailVerified: true,
      image: null,
      role: "user",
      banned: null,
      banReason: null,
      banExpires: null,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
  );
  dbMock.state.organizations.push({
    id: HOUSEHOLD_ID,
    name: "Owner household",
    slug: "owner-household",
    logo: null,
    metadata: null,
    createdAt: dbMock.date,
    updatedAt: dbMock.date,
  });
  dbMock.state.userEmails.push(
    ...dbMock.state.users.map((user) => ({
      email: user.email,
      userId: user.id,
      verified: user.emailVerified,
      isPrimary: true,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    })),
  );
  dbMock.state.members.push(
    {
      id: OWNER_MEMBER_ID,
      organizationId: HOUSEHOLD_ID,
      userId: "owner-user",
      role: "owner",
      createdAt: dbMock.date,
    },
    {
      id: MEMBER_MEMBER_ID,
      organizationId: HOUSEHOLD_ID,
      userId: "member-user",
      role: "member",
      createdAt: dbMock.date,
    },
  );
}

function seedDietCatalog() {
  dbMock.state.dietPresets.push(
    {
      key: "vegetarian",
      label: "Vegetarian",
      description: "no meat or fish",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
    {
      key: "vegan",
      label: "Vegan",
      description: "no animal products",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
  );
  dbMock.state.ingredientGroups.push(
    {
      key: "shellfish",
      label: "Shellfish",
      description: "prawns, mussels",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
    {
      key: "gluten",
      label: "Gluten",
      description: "wheat, barley, rye",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
    {
      key: "dairy",
      label: "Dairy",
      description: "milk, cheese",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
    {
      key: "chicken",
      label: "Chicken",
      description: "chicken meat and stock",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
    {
      key: "poultry",
      label: "Poultry",
      description: "chicken and turkey",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
  );
  dbMock.state.ingredients.push(
    {
      slug: "egg",
      name: "egg",
      category: "protein",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
    {
      slug: "honey",
      name: "honey",
      category: "sweetener",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
    {
      slug: "milk",
      name: "milk",
      category: "dairy",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    },
  );
  dbMock.state.dietPresetExcludedGroups.push(
    { presetKey: "vegetarian", groupKey: "shellfish" },
    { presetKey: "vegan", groupKey: "dairy" },
  );
  dbMock.state.dietPresetExcludedIngredients.push({
    presetKey: "vegan",
    ingredientSlug: "honey",
  });
  dbMock.state.ingredientGroupMembers.push({
    groupKey: "dairy",
    ingredientSlug: "milk",
  });
  dbMock.state.ingredientGroupHierarchy.push({
    narrowerGroupKey: "chicken",
    broaderGroupKey: "poultry",
    relationType: "classification",
  });
}

beforeEach(() => {
  authzMock.session = null;
  dbMock.reset();
});

const env = {
  DATABASE_URL: "postgresql://test:test@localhost/test",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-thirty-two-characters",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  GITHUB_CLIENT_ID: "github-client-id",
  GITHUB_CLIENT_SECRET: "github-client-secret",
};

const PUBLIC_RECIPE_READ_CACHE_CONTROL =
  "public, s-maxage=60, stale-while-revalidate=300";

function expectPublicRecipeReadCacheHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe(
    PUBLIC_RECIPE_READ_CACHE_CONTROL,
  );
  expect(response.headers.get("vary")).toBe("Cookie, Authorization");
}

function expectPrivateRecipeReadCacheHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie, Authorization");
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("runs through the Worker fetch handler", async () => {
    const ctx = {
      waitUntil: vi.fn(),
    } as unknown as ExecutionContext;

    const res = await handler.fetch(
      new Request("https://recipe-api.example.test/health"),
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("GET /.well-known/agent-configuration", () => {
  it("publishes delegated Agent Auth discovery at the canonical path", async () => {
    const res = await app.request(
      "/.well-known/agent-configuration",
      {},
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await res.json()).toMatchObject({
      version: "1.0-draft",
      provider_name: "Robbie's Recipes",
      issuer: "http://localhost:3000/api/auth",
      default_location:
        "http://localhost:3000/api/auth/capability/execute",
      algorithms: ["Ed25519"],
      modes: ["delegated"],
      approval_methods: ["device_authorization"],
      endpoints: {
        register: "http://localhost:3000/api/auth/agent/register",
        capabilities: "http://localhost:3000/api/auth/capability/list",
        execute: "http://localhost:3000/api/auth/capability/execute",
        revoke: "http://localhost:3000/api/auth/agent/revoke",
      },
    });
  });

  it("publishes discovery without a database connection", async () => {
    const res = await app.request(
      "/.well-known/agent-configuration",
      {},
      { ...env, DATABASE_URL: "" },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      provider_name: "Robbie's Recipes",
    });
  });
});

describe("GET /recipes", () => {
  it("returns recipes list", async () => {
    const res = await app.request("/recipes", {}, env);
    expect(res.status).toBe(200);
    expectPublicRecipeReadCacheHeaders(res);
    expect(await res.json()).toEqual([]);
  });

  it("returns 503 when no connection is configured", async () => {
    const res = await app.request("/recipes", {}, { DATABASE_URL: "" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "No database connection configured (HYPERDRIVE or DATABASE_URL required)",
    });
  });

  it("requires authentication for the owned scope", async () => {
    const res = await app.request("/recipes?scope=owned", {}, env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("returns only recipes authored by the signed-in user", async () => {
    dbMock.state.recipes.push(
      {
        id: "recipe-owned",
        slug: "my-lentil-soup",
        title: "My Lentil Soup",
        description: null,
        body: null,
        userId: "owner-user",
        visibility: "private",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
      {
        id: "recipe-public",
        slug: "someone-elses-soup",
        title: "Someone Else's Soup",
        description: null,
        body: null,
        userId: "other-user",
        visibility: "public",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
    );
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request("/recipes?scope=owned", {}, env);

    expect(res.status).toBe(200);
    expectPrivateRecipeReadCacheHeaders(res);
    expect(await res.json()).toEqual([
      expect.objectContaining({
        slug: "my-lentil-soup",
        title: "My Lentil Soup",
      }),
    ]);
  });

  it.each([
    ["an unknown scope", "/recipes?scope=household", "Invalid recipe scope"],
    ["an invalid cursor", "/recipes?cursor=not-a-cursor", "Invalid recipe query"],
    ["an out-of-range limit", "/recipes?limit=0", "Invalid recipe query"],
  ])("rejects %s with a 400", async (_case, url, error) => {
    const res = await app.request(url, {}, env);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it("pages newest-first through recipes when a limit is provided", async () => {
    const recipeIds = [
      "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b01",
      "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b02",
      "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b03",
    ];
    dbMock.state.recipes.push(
      ...recipeIds.map((id, index) => ({
        id,
        slug: `soup-${index + 1}`,
        title: `Soup ${index + 1}`,
        description: null,
        body: null,
        userId: "other-user",
        visibility: "public" as const,
        createdAt: new Date(`2026-01-0${index + 1}T00:00:00.000Z`),
        updatedAt: dbMock.date,
      })),
    );

    const firstRes = await app.request("/recipes?limit=2", {}, env);
    expect(firstRes.status).toBe(200);
    const firstPage = (await firstRes.json()) as {
      items: { slug: string }[];
      nextCursor: string | null;
    };
    expect(firstPage.items.map((recipe) => recipe.slug)).toEqual([
      "soup-3",
      "soup-2",
    ]);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondRes = await app.request(
      `/recipes?limit=2&cursor=${firstPage.nextCursor}`,
      {},
      env,
    );
    expect(secondRes.status).toBe(200);
    const secondPage = (await secondRes.json()) as {
      items: { slug: string }[];
      nextCursor: string | null;
    };
    expect(secondPage.items.map((recipe) => recipe.slug)).toEqual(["soup-1"]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("returns 502 when database query fails", async () => {
    vi.mocked(postgres).mockReturnValueOnce(
      Object.assign(
        () => {},
        {
          options: { parsers: {}, serializers: {} },
          unsafe: () => ({
            values: () => Promise.reject(new Error("connection refused")),
          }),
          end: () => Promise.resolve(),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
    );

    const res = await app.request("/recipes", {}, env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Database query failed");
  });
});

describe("recipe discover following feed", () => {
  it("allows shared caching for the anonymous public feed", async () => {
    const res = await app.request("/recipes/discover/feed", {}, env);

    expect(res.status).toBe(200);
    expectPublicRecipeReadCacheHeaders(res);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it("requires authentication", async () => {
    const res = await app.request(
      "/recipes/discover/feed?scope=following",
      {},
      env,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("returns an empty feed without a household or followed cooks", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-public",
      slug: "public-stew",
      title: "Public Stew",
      description: null,
      body: null,
      userId: "owner-user",
      visibility: "public",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });

    const res = await app.request(
      "/recipes/discover/feed?scope=following",
      {},
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it("combines household activity with public recipes from followed cooks", async () => {
    seedHousehold();
    dbMock.state.users.push({
      id: "unfollowed-user",
      name: "Unfollowed",
      email: "unfollowed@example.test",
      emailVerified: true,
      image: null,
      role: "user",
      banned: null,
      banReason: null,
      banExpires: null,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    dbMock.state.userFollows.push({
      followerUserId: "owner-user",
      followedUserId: "outsider-user",
      createdAt: dbMock.date,
    });
    dbMock.state.recipes.push(
      {
        id: "recipe-household",
        slug: "household-stew",
        title: "Household Stew",
        description: null,
        body: null,
        userId: "member-user",
        visibility: "household",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
        updatedAt: dbMock.date,
      },
      {
        id: "recipe-followed",
        slug: "outsider-soup",
        title: "Outsider Soup",
        description: null,
        body: null,
        userId: "outsider-user",
        visibility: "public",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        updatedAt: dbMock.date,
      },
      {
        id: "recipe-unfollowed",
        slug: "unfollowed-pasta",
        title: "Unfollowed Pasta",
        description: null,
        body: null,
        userId: "unfollowed-user",
        visibility: "public",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: dbMock.date,
      },
    );
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      "/recipes/discover/feed?scope=following",
      {},
      env,
    );

    expect(res.status).toBe(200);
    expectPrivateRecipeReadCacheHeaders(res);
    const body = (await res.json()) as {
      items: Array<{ recipe: { slug: string }; author: { id: string } }>;
    };
    expect(body.items.map((item) => item.recipe.slug)).toEqual([
      "household-stew",
      "outsider-soup",
    ]);
    expect(body.items.map((item) => item.author.id)).toEqual([
      "member-user",
      "outsider-user",
    ]);
  });
});

describe("GET /recipes/cooks", () => {
  function seedCook() {
    dbMock.state.users.push({
      id: "cook-1",
      name: "Ada Cook",
      email: "ada@example.test",
      emailVerified: true,
      image: null,
      role: null,
      banned: null,
      banReason: null,
      banExpires: null,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    dbMock.state.recipes.push(
      {
        id: "recipe-1",
        slug: "ada-stew",
        title: "Ada's Stew",
        description: null,
        body: null,
        userId: "cook-1",
        visibility: "public",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
      {
        id: "recipe-private",
        slug: "private-soup",
        title: "Private Soup",
        description: null,
        body: null,
        userId: "cook-1",
        visibility: "private",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
    );
  }

  it("returns lightweight summaries of cooks with public recipes", async () => {
    seedCook();

    const res = await app.request("/recipes/cooks", {}, env);

    expect(res.status).toBe(200);
    expectPublicRecipeReadCacheHeaders(res);
    expect(await res.json()).toEqual({
      cooks: [
        {
          id: "cook-1",
          name: "Ada Cook",
          image: null,
          activityCount: 1,
          latestRecipeTitle: "Ada's Stew",
        },
      ],
    });
  });

  it("keeps credentialed public cook reads out of shared caches", async () => {
    seedCook();
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      "/recipes/cooks",
      {
        headers: { cookie: "better-auth.session_token=owner-session" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expectPrivateRecipeReadCacheHeaders(res);
  });

  it("returns recent public activity for one cook", async () => {
    seedCook();
    dbMock.state.users.push(
      {
        id: "follower-user",
        name: "Grace Baker",
        email: "grace@example.test",
        emailVerified: true,
        image: null,
        role: null,
        banned: null,
        banReason: null,
        banExpires: null,
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
      {
        id: "followed-user",
        name: "Lin Chef",
        email: "lin@example.test",
        emailVerified: true,
        image: null,
        role: null,
        banned: null,
        banReason: null,
        banExpires: null,
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
    );
    dbMock.state.userFollows.push(
      {
        followerUserId: "follower-user",
        followedUserId: "cook-1",
        createdAt: dbMock.date,
      },
      {
        followerUserId: "cook-1",
        followedUserId: "followed-user",
        createdAt: dbMock.date,
      },
    );

    const res = await app.request("/recipes/cooks?cook=cook-1", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cook: {
        id: "cook-1",
        name: "Ada Cook",
        image: null,
        followersCount: 1,
        followingCount: 1,
        followers: [
          { id: "follower-user", name: "Grace Baker", image: null },
        ],
        following: [
          { id: "followed-user", name: "Lin Chef", image: null },
        ],
        activity: [
          expect.objectContaining({
            type: "recipe_added",
            recipe: expect.objectContaining({
              slug: "ada-stew",
              title: "Ada's Stew",
            }),
          }),
        ],
      },
    });
  });

  it("bounds social graph previews while retaining full counts", async () => {
    seedCook();
    for (let index = 0; index < 55; index += 1) {
      const followerId = `follower-${index}`;
      dbMock.state.users.push({
        id: followerId,
        name: `Follower ${index}`,
        email: `follower-${index}@example.test`,
        emailVerified: true,
        image: null,
        role: null,
        banned: null,
        banReason: null,
        banExpires: null,
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      });
      dbMock.state.userFollows.push({
        followerUserId: followerId,
        followedUserId: "cook-1",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
      });
    }

    const res = await app.request("/recipes/cooks?cook=cook-1", {}, env);
    const body = (await res.json()) as {
      cook: { followersCount: number; followers: Array<{ id: string }> };
    };

    expect(res.status).toBe(200);
    expect(body.cook.followersCount).toBe(55);
    expect(body.cook.followers).toHaveLength(50);
    expect(body.cook.followers[0]?.id).toBe("follower-54");
  });

  it("returns null for a cook without public activity", async () => {
    const res = await app.request("/recipes/cooks?cook=missing", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cook: null });
  });
});

describe("cook follows", () => {
  beforeEach(() => {
    seedHousehold();
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
  });

  it("follows and unfollows another cook idempotently", async () => {
    const follow = await app.request(
      "/recipes/cooks/outsider-user/follow",
      { method: "PUT", headers: { origin: "http://localhost" } },
      env,
    );
    expect(follow.status).toBe(200);
    expect(await follow.json()).toEqual({
      following: true,
      canFollow: true,
    });

    const repeat = await app.request(
      "/recipes/cooks/outsider-user/follow",
      { method: "PUT", headers: { origin: "http://localhost" } },
      env,
    );
    expect(repeat.status).toBe(200);
    expect(dbMock.state.userFollows).toHaveLength(1);

    const status = await app.request(
      "/recipes/cooks/outsider-user/follow",
      {},
      env,
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({
      following: true,
      canFollow: true,
    });

    const unfollow = await app.request(
      "/recipes/cooks/outsider-user/follow",
      { method: "DELETE", headers: { origin: "http://localhost" } },
      env,
    );
    expect(unfollow.status).toBe(200);
    expect(await unfollow.json()).toEqual({
      following: false,
      canFollow: true,
    });
    expect(dbMock.state.userFollows).toHaveLength(0);
  });

  it("returns the signed-in cook's connections without requiring public activity", async () => {
    dbMock.state.userFollows.push(
      {
        followerUserId: "outsider-user",
        followedUserId: "owner-user",
        createdAt: dbMock.date,
      },
      {
        followerUserId: "owner-user",
        followedUserId: "outsider-user",
        createdAt: dbMock.date,
      },
    );

    const res = await app.request("/recipes/cooks/me/connections", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      followersCount: 1,
      followingCount: 1,
      followers: [{ id: "outsider-user", name: "Outsider", image: null }],
      following: [{ id: "outsider-user", name: "Outsider", image: null }],
    });
  });

  it("requires authentication for the signed-in cook's connections", async () => {
    authzMock.session = null;

    const res = await app.request("/recipes/cooks/me/connections", {}, env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("does not allow cooks to follow themselves", async () => {
    const res = await app.request(
      "/recipes/cooks/owner-user/follow",
      { method: "PUT", headers: { origin: "http://localhost" } },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "You cannot follow yourself",
    });
  });
});

describe("GET /recipes/:slug", () => {
  it("rejects malformed slugs before database access", async () => {
    const res = await app.request(
      "/recipes/Invalid%20Slug",
      {},
      { DATABASE_URL: "" },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid recipe slug",
      details: [
        {
          path: ["slug"],
          message:
            "Slug must use lowercase letters, numbers, and single hyphens between words",
        },
      ],
    });
  });

  it("allows shared caching for an anonymous public recipe", async () => {
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "public-soup",
      title: "Public Soup",
      description: null,
      body: null,
      userId: "owner-user",
      visibility: "public",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });

    const res = await app.request("/recipes/public-soup", {}, env);

    expect(res.status).toBe(200);
    expectPublicRecipeReadCacheHeaders(res);
    expect(await res.json()).toMatchObject({
      slug: "public-soup",
      visibility: "public",
      owned: false,
    });
  });

  it("includes ownership when an owner reads a public recipe", async () => {
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "public-soup",
      title: "Public Soup",
      description: null,
      body: null,
      userId: "owner-user",
      visibility: "public",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request("/recipes/public-soup", {}, env);

    expect(res.status).toBe(200);
    expectPrivateRecipeReadCacheHeaders(res);
    expect(await res.json()).toMatchObject({
      slug: "public-soup",
      visibility: "public",
      owned: true,
    });
  });

  it("allows household members to read household-shared recipes", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "shared-soup",
      title: "Shared Soup",
      description: null,
      body: null,
      userId: "owner-user",
      visibility: "household",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });

    const res = await app.request("/recipes/shared-soup", {}, env);

    expect(res.status).toBe(200);
    expectPrivateRecipeReadCacheHeaders(res);
    expect(await res.json()).toMatchObject({
      slug: "shared-soup",
      title: "Shared Soup",
      visibility: "household",
    });
  });

  it("returns 404 for anonymous household-shared recipe reads", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "shared-soup",
      title: "Shared Soup",
      description: null,
      body: null,
      userId: "owner-user",
      visibility: "household",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });

    const res = await app.request("/recipes/shared-soup", {}, env);

    expect(res.status).toBe(404);
  });

  it("returns 404 for non-member household-shared recipe reads", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "shared-soup",
      title: "Shared Soup",
      description: null,
      body: null,
      userId: "owner-user",
      visibility: "household",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });

    const res = await app.request("/recipes/shared-soup", {}, env);

    expect(res.status).toBe(404);
  });

  it("returns 404 when a stale household share points at a non-member owner", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "stale-soup",
      title: "Stale Soup",
      description: null,
      body: null,
      userId: "outsider-user",
      visibility: "household",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });

    const res = await app.request("/recipes/stale-soup", {}, env);

    expect(res.status).toBe(404);
  });
});

describe("POST /recipes/:slug/recommendations", () => {
  it("notifies a household member who can add the recipe to their recipe box", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "public-soup",
      title: "Public Soup",
      description: null,
      body: null,
      userId: "owner-user",
      visibility: "household",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const recommendResponse = await app.request(
      "/recipes/public-soup/recommendations",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ recipientUserId: "member-user" }),
      },
      env,
    );

    expect(recommendResponse.status).toBe(201);
    expect(await recommendResponse.json()).toEqual({ recommended: true });
    expect(dbMock.state.notificationRecipeRecommendationEvents).toEqual([
      expect.objectContaining({
        recipeId: "recipe-1",
        recipeSlugSnapshot: "public-soup",
        recipeTitleSnapshot: "Public Soup",
      }),
    ]);

    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });
    const archiveResponse = await app.request("/notifications", {}, env);
    expect(archiveResponse.status).toBe(200);
    const archive = (await archiveResponse.json()) as {
      items: Array<{
        id: string;
        kind: string;
        actions: string[];
        detail: {
          recipe: { slug: string; title: string; available: boolean };
          saved: boolean;
        };
      }>;
    };
    expect(archive.items).toHaveLength(1);
    expect(archive.items[0]).toMatchObject({
      kind: "recipe_recommended",
      actions: ["add_to_recipe_box"],
      detail: {
        recipe: {
          slug: "public-soup",
          title: "Public Soup",
          available: true,
        },
        saved: false,
      },
    });

    const unknownActionResponse = await app.request(
      `/notifications/${archive.items[0]?.id}/actions/dismiss`,
      { method: "POST", headers: { origin: "http://localhost:3000" } },
      env,
    );
    expect(unknownActionResponse.status).toBe(400);

    const actionResponse = await app.request(
      `/notifications/${archive.items[0]?.id}/actions/add_to_recipe_box`,
      { method: "POST", headers: { origin: "http://localhost:3000" } },
      env,
    );

    expect(actionResponse.status).toBe(200);
    expect(await actionResponse.json()).toMatchObject({
      item: {
        actions: [],
        detail: { saved: true },
      },
    });
    expect(dbMock.state.recipeBoxItems).toContainEqual({
      userId: "member-user",
      recipeSlug: "public-soup",
    });
    expect(dbMock.state.recipeBoxes).toHaveLength(0);
    expect(dbMock.state.notificationDeliveries[0]?.readAt).not.toBeNull();
  });

  it("keeps unavailable recommendations out of the recipe box", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "public-soup",
      title: "Public Soup",
      description: null,
      body: null,
      userId: "owner-user",
      visibility: "public",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    const recommendResponse = await app.request(
      "/recipes/public-soup/recommendations",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ recipientUserId: "member-user" }),
      },
      env,
    );
    expect(recommendResponse.status).toBe(201);
    const recipe = dbMock.state.recipes[0];
    if (!recipe) throw new Error("Missing seeded recipe");
    recipe.visibility = "private";

    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });
    const archiveResponse = await app.request("/notifications", {}, env);
    const archive = (await archiveResponse.json()) as {
      items: Array<{
        id: string;
        actions: string[];
        detail: { recipe: { available: boolean } };
      }>;
    };
    expect(archive.items[0]).toMatchObject({
      actions: [],
      detail: { recipe: { available: false } },
    });

    const actionResponse = await app.request(
      `/notifications/${archive.items[0]?.id}/actions/add_to_recipe_box`,
      { method: "POST", headers: { origin: "http://localhost:3000" } },
      env,
    );
    expect(actionResponse.status).toBe(409);
    expect(dbMock.state.recipeBoxItems).toHaveLength(0);

    const recommendation = dbMock.state.notificationRecipeRecommendationEvents[0];
    if (!recommendation) throw new Error("Missing recommendation event");
    recommendation.recipeId = null;
    const deletedRecipeResponse = await app.request(
      `/notifications/${archive.items[0]?.id}/actions/add_to_recipe_box`,
      { method: "POST", headers: { origin: "http://localhost:3000" } },
      env,
    );
    expect(deletedRecipeResponse.status).toBe(409);
  });

  it("rejects self-recommendations and private recipes", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "private-soup",
      title: "Private Soup",
      description: null,
      body: null,
      userId: "owner-user",
      visibility: "private",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    const request = (recipientUserId: string) =>
      app.request(
        "/recipes/private-soup/recommendations",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({ recipientUserId }),
        },
        env,
      );

    const selfResponse = await request("owner-user");
    expect(selfResponse.status).toBe(400);
    const privateResponse = await request("member-user");
    expect(privateResponse.status).toBe(409);
  });

  it("requires the recipient to share the sender's household", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "public-soup",
      title: "Public Soup",
      description: null,
      body: null,
      userId: "owner-user",
      visibility: "public",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const response = await app.request("/recipes/public-soup/recommendations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ recipientUserId: "outsider-user" }),
    }, env);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Recipes can only be recommended to household members",
    });
  });

  it("rejects recommendations to the owner or from a sender without a household", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "public-soup",
      title: "Public Soup",
      description: null,
      body: null,
      userId: "owner-user",
      visibility: "public",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    const recommend = (recipientUserId: string) =>
      app.request(
        "/recipes/public-soup/recommendations",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({ recipientUserId }),
        },
        env,
      );

    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });
    const ownerResponse = await recommend("owner-user");
    expect(ownerResponse.status).toBe(409);

    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });
    const noHouseholdResponse = await recommend("member-user");
    expect(noHouseholdResponse.status).toBe(409);
    expect(await noHouseholdResponse.json()).toEqual({
      error: "Join a household before recommending recipes",
    });
  });
});

describe("POST /recipes", () => {
  it("requires authentication", async () => {
    const res = await app.request(
      "/recipes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          slug: "private-draft",
          title: "Private Draft",
        }),
      },
      env,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("requires saved recipe content", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      "/recipes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          slug: "private-draft",
          title: "Private Draft",
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it("rejects malformed saved recipe payloads", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      "/recipes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          slug: "private-draft",
          title: "Private Draft",
          body: JSON.stringify({ version: 1 }),
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      details: Array<{ path: string[]; message: string }>;
    };
    expect(body.error).toBe("Invalid request body");
    expect(body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["body", "source"] }),
        expect.objectContaining({ path: ["body", "recipe"] }),
      ]),
    );
  });

  it("rejects recipe slugs reserved for application routes", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      "/recipes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          slug: "kitchen",
          title: "Kitchen",
          body: JSON.stringify({
            version: 1,
            source: "Cook @salt{}.",
            recipe: {
              title: "Kitchen",
              description: "A reserved route test.",
              cuisine: [],
              servings: 1,
              ingredientGroups: [{ items: [{ ingredient: "salt" }] }],
              instructions: ["Cook."],
              cookware: [],
              cookBody: "Cook @salt{}.",
              date: "2026-07-22",
              tags: [],
            },
          }),
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Invalid request body",
      details: [
        {
          path: ["slug"],
          message: "Slug is reserved for a recipe application route",
        },
      ],
    });
  });
});

describe("POST /recipe-drafts/url", () => {
  it("requires authentication before fetching the page", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await app.request(
      "/recipe-drafts/url",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ url: "https://recipes.example.test/pasta" }),
      },
      env,
    );

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("returns an editable Cooklang draft from schema.org Recipe data", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `<script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Recipe",
          name: "Tomato pasta",
          description: "A quick dinner.",
          recipeYield: "2 servings",
          prepTime: "PT5M",
          cookTime: "PT20M",
          recipeIngredient: ["200 g pasta", "400 g tomatoes"],
          recipeInstructions: [
            { "@type": "HowToStep", text: "Boil the pasta." },
            { "@type": "HowToStep", text: "Add the tomatoes." },
          ],
        })}</script>`,
        { headers: { "content-type": "text/html" } },
      ),
    );

    const res = await app.request(
      "/recipe-drafts/url",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ url: "https://recipes.example.test/pasta" }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      title: "Tomato pasta",
      description: "A quick dinner.",
      servings: 2,
      prepTime: 5,
      cookTime: 20,
      url: "https://recipes.example.test/pasta",
      source:
        "@pasta{200%g}\n@tomatoes{400%g}\n\nBoil the pasta.\n\nAdd the tomatoes.",
    });
    fetchSpy.mockRestore();
  });

  it("reports pages without complete Recipe markup", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<script type="application/ld+json">{"@type":"Article"}</script>',
        { headers: { "content-type": "text/html" } },
      ),
    );

    const res = await app.request(
      "/recipe-drafts/url",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ url: "https://recipes.example.test/article" }),
      },
      env,
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
    fetchSpy.mockRestore();
  });
});

describe("POST /recipe-drafts/file", () => {
  it("requires authentication before parsing the file", async () => {
    const res = await app.request(
      "/recipe-drafts/file",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          filename: "pasta.cook",
          content: "@pasta{200%g}\n\nBoil the pasta.",
        }),
      },
      env,
    );

    expect(res.status).toBe(401);
  });

  it("returns an editable draft from a local Cooklang file", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    const content = `---
title: "Tomato pasta"
description: "A quick dinner."
cuisine: ["Italian"]
servings: 2
prepTime: 5
cookTime: 20
---
@pasta{200%g}
@tomatoes{400%g}

Boil the pasta, then add the tomatoes.`;

    const res = await app.request(
      "/recipe-drafts/file",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ filename: "pasta.cook", content }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      title: "Tomato pasta",
      description: "A quick dinner.",
      cuisine: "Italian",
      servings: 2,
      prepTime: 5,
      cookTime: 20,
      source:
        "@pasta{200%g}\n@tomatoes{400%g}\n\nBoil the pasta, then add the tomatoes.",
    });
  });

  it("validates the supported file extensions", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      "/recipe-drafts/file",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          filename: "pasta.txt",
          content: "@pasta{200%g}\n\nBoil the pasta.",
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Invalid request body",
      details: [
        expect.objectContaining({
          path: ["filename"],
          message: "Use a .cook, .cooklang, .json, or .jsonld file",
        }),
      ],
    });
  });

  it("reports files without a complete recipe", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      "/recipe-drafts/file",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          filename: "article.json",
          content: JSON.stringify({ "@type": "Article" }),
        }),
      },
      env,
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error:
        "No complete recipe was found in that file. Cooklang files need ingredients and instructions; schema.org files need a Recipe with a name, ingredients, and instructions.",
    });
  });

  it("reports imported drafts longer than 10,000 characters", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      "/recipe-drafts/file",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          filename: "long-recipe.cook",
          content: `@rice{1%cup}\n\n${"Cook the rice. ".repeat(800)}`,
        }),
      },
      env,
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error:
        "That recipe is too long to import. The Cooklang draft exceeds 10,000 characters.",
    });
  });

  it("rejects file content larger than 100 KB when encoded", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      "/recipe-drafts/file",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          filename: "pasta.cook",
          content: "é".repeat(50_001),
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Invalid request body",
      details: [
        expect.objectContaining({
          path: ["content"],
          message: "File content must be 100 KB or smaller",
        }),
      ],
    });
  });
});

describe("profile diet preferences", () => {
  it("requires authentication before returning a diet profile", async () => {
    const res = await app.request("/api/profile/diet", {}, env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("requires authentication before returning diet options", async () => {
    const res = await app.request("/api/profile/diet/options", {}, env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("requires authentication before saving a diet profile", async () => {
    const res = await app.request(
      "/api/profile/diet",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          presetDietKeys: [],
          excludedIngredientSlugs: [],
          excludedGroupKeys: [],
          recipeMatchMode: "warn",
        }),
      },
      env,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("returns an empty default diet profile when none has been saved", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request("/api/profile/diet", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      presetDietKeys: [],
      excludedIngredientSlugs: [],
      excludedGroupKeys: [],
      recipeMatchMode: "hide",
    });
  });

  it("returns empty diet options when the catalog has not been seeded", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request("/api/profile/diet/options", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      presets: [],
      groups: [],
      ingredients: [],
    });
  });

  it("returns seeded diet options from the catalog", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    seedDietCatalog();

    const res = await app.request("/api/profile/diet/options", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      presets: [
        {
          key: "vegan",
          label: "Vegan",
          sub: "no animal products",
          excludedGroupKeys: ["dairy"],
          excludedIngredientSlugs: ["honey"],
        },
        {
          key: "vegetarian",
          label: "Vegetarian",
          sub: "no meat or fish",
          excludedGroupKeys: ["shellfish"],
          excludedIngredientSlugs: [],
        },
      ],
      groups: [
        {
          key: "chicken",
          label: "Chicken",
          sub: "chicken meat and stock",
          broaderGroupKeys: ["poultry"],
          ingredientSlugs: [],
        },
        {
          key: "dairy",
          label: "Dairy",
          sub: "milk, cheese",
          broaderGroupKeys: [],
          ingredientSlugs: ["milk"],
        },
        {
          key: "gluten",
          label: "Gluten",
          sub: "wheat, barley, rye",
          broaderGroupKeys: [],
          ingredientSlugs: [],
        },
        {
          key: "poultry",
          label: "Poultry",
          sub: "chicken and turkey",
          broaderGroupKeys: [],
          ingredientSlugs: [],
        },
        {
          key: "shellfish",
          label: "Shellfish",
          sub: "prawns, mussels",
          broaderGroupKeys: [],
          ingredientSlugs: [],
        },
      ],
      ingredients: [
        { slug: "egg", name: "egg", category: "protein" },
        { slug: "honey", name: "honey", category: "sweetener" },
        { slug: "milk", name: "milk", category: "dairy" },
      ],
    });
  });

  it("inherits ingredients through classifications and ignores composition", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    seedDietCatalog();
    dbMock.state.ingredientGroups.push(
      {
        key: "animal-product",
        label: "Animal product",
        description: null,
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
      {
        key: "meat",
        label: "Meat",
        description: null,
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
      {
        key: "prepared-food",
        label: "Prepared food",
        description: null,
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
    );
    dbMock.state.ingredients.push(
      {
        slug: "chicken-breast",
        name: "chicken breast",
        category: "protein",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
      {
        slug: "vegetable-stock",
        name: "vegetable stock",
        category: "stock",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
    );
    dbMock.state.ingredientGroupMembers.push(
      { groupKey: "chicken", ingredientSlug: "chicken-breast" },
      { groupKey: "prepared-food", ingredientSlug: "vegetable-stock" },
    );
    dbMock.state.ingredientGroupHierarchy.push(
      {
        narrowerGroupKey: "poultry",
        broaderGroupKey: "animal-product",
        relationType: "classification",
      },
      {
        narrowerGroupKey: "chicken",
        broaderGroupKey: "meat",
        relationType: "classification",
      },
      {
        narrowerGroupKey: "meat",
        broaderGroupKey: "animal-product",
        relationType: "classification",
      },
      {
        narrowerGroupKey: "prepared-food",
        broaderGroupKey: "animal-product",
        relationType: "composition",
      },
    );

    const res = await app.request("/api/profile/diet/options", {}, env);
    const body = (await res.json()) as {
      groups: Array<{
        key: string;
        broaderGroupKeys: string[];
        ingredientSlugs: string[];
      }>;
    };

    expect(res.status).toBe(200);
    expect(
      body.groups.find((group) => group.key === "poultry")?.ingredientSlugs,
    ).toEqual(["chicken-breast"]);
    expect(
      body.groups.find((group) => group.key === "animal-product")
        ?.ingredientSlugs,
    ).toEqual(["chicken-breast"]);
    expect(
      body.groups.find((group) => group.key === "prepared-food")
        ?.broaderGroupKeys,
    ).toEqual([]);
  });

  it("creates and updates the signed-in user's diet profile", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    seedDietCatalog();

    const createRes = await app.request(
      "/api/profile/diet",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          presetDietKeys: ["vegetarian"],
          excludedIngredientSlugs: ["egg", "egg"],
          excludedGroupKeys: ["shellfish"],
          recipeMatchMode: "warn",
        }),
      },
      env,
    );

    expect(createRes.status).toBe(200);
    expect(await createRes.json()).toEqual({
      presetDietKeys: ["vegetarian"],
      excludedIngredientSlugs: ["egg"],
      excludedGroupKeys: ["shellfish"],
      recipeMatchMode: "warn",
    });

    const updateRes = await app.request(
      "/api/profile/diet",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          presetDietKeys: ["vegan"],
          excludedIngredientSlugs: ["honey"],
          excludedGroupKeys: ["gluten", "dairy"],
          recipeMatchMode: "hide",
        }),
      },
      env,
    );

    expect(updateRes.status).toBe(200);
    expect(await updateRes.json()).toEqual({
      presetDietKeys: ["vegan"],
      excludedIngredientSlugs: ["honey"],
      excludedGroupKeys: ["gluten", "dairy"],
      recipeMatchMode: "hide",
    });
    expect(dbMock.state.dietProfiles).toHaveLength(1);
    expect(dbMock.state.userDietPresets).toEqual([
      { userId: "owner-user", presetKey: "vegan" },
    ]);
    expect(dbMock.state.userDietExcludedIngredients).toEqual([
      { userId: "owner-user", ingredientSlug: "honey" },
    ]);
    expect(dbMock.state.userDietExcludedGroups).toEqual([
      { userId: "owner-user", groupKey: "gluten" },
      { userId: "owner-user", groupKey: "dairy" },
    ]);
  });

  it("rejects validly-shaped diet keys that are not in the catalog", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      "/api/profile/diet",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          presetDietKeys: ["vegetarian"],
          excludedIngredientSlugs: ["egg"],
          excludedGroupKeys: ["shellfish"],
          recipeMatchMode: "warn",
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Unknown diet reference",
      details: expect.arrayContaining([
        expect.objectContaining({ path: ["presetDietKeys"] }),
        expect.objectContaining({ path: ["excludedIngredientSlugs"] }),
        expect.objectContaining({ path: ["excludedGroupKeys"] }),
      ]),
    });
  });

  it("returns structured validation errors for malformed diet profiles", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      "/api/profile/diet",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          excludedIngredientSlugs: ["Not a slug"],
          recipeMatchMode: "block",
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Invalid request body",
      details: expect.arrayContaining([
        expect.objectContaining({ path: ["excludedIngredientSlugs", 0] }),
        expect.objectContaining({ path: ["recipeMatchMode"] }),
      ]),
    });
  });
});

describe("profile recipe box", () => {
  it("requires authentication", async () => {
    const res = await app.request("/api/profile/recipe-box", {}, env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("distinguishes an unfinished setup from an intentionally empty box", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const initial = await app.request("/api/profile/recipe-box", {}, env);
    expect(await initial.json()).toEqual({
      completed: false,
      recipeSlugs: [],
      staticRecipeSlugs: [],
    });

    const saved = await app.request(
      "/api/profile/recipe-box",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ recipeSlugs: [] }),
      },
      env,
    );

    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      completed: true,
      recipeSlugs: [],
      staticRecipeSlugs: [],
    });
  });

  it("deduplicates and replaces selected recipes", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    await app.request(
      "/api/profile/recipe-box",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          recipeSlugs: ["lentil-soup", "overnight-pizza", "lentil-soup"],
        }),
      },
      env,
    );
    const updated = await app.request(
      "/api/profile/recipe-box",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ recipeSlugs: ["breakfast-flatbreads"] }),
      },
      env,
    );

    expect(await updated.json()).toEqual({
      completed: true,
      recipeSlugs: ["breakfast-flatbreads"],
      staticRecipeSlugs: ["breakfast-flatbreads"],
    });
    expect(dbMock.state.recipeBoxItems).toEqual([
      { userId: "owner-user", recipeSlug: "breakfast-flatbreads" },
    ]);
  });
});

describe("recipe profile bootstrap", () => {
  it("requires authentication", async () => {
    const res = await app.request("/api/profile/bootstrap", {}, env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("returns recipe, diet, box, and notification data together", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    seedDietCatalog();
    dbMock.state.recipes.push(
      {
        id: "recipe-owned",
        slug: "private-soup",
        title: "Private Soup",
        description: null,
        body: null,
        userId: "owner-user",
        visibility: "private",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
      {
        id: "recipe-public",
        slug: "public-pasta",
        title: "Public Pasta",
        description: null,
        body: null,
        userId: "other-user",
        visibility: "public",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
    );

    const res = await app.request("/api/profile/bootstrap", {}, env);
    const body = (await res.json()) as {
      recipeBox: {
        ownedRecipes: Array<{ slug: string }>;
        readableRecipes: Array<{ slug: string }>;
        profile: { completed: boolean; recipeSlugs: string[] };
      };
      diet: { profile: { recipeMatchMode: string }; options: { presets: unknown[] } };
      unreadNotificationCount: number;
    };

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.recipeBox.ownedRecipes.map((recipe) => recipe.slug)).toEqual([
      "private-soup",
    ]);
    expect(
      body.recipeBox.readableRecipes.map((recipe) => recipe.slug).sort(),
    ).toEqual(["public-pasta"]);
    expect(body.recipeBox.profile).toMatchObject({
      completed: false,
      recipeSlugs: [],
    });
    expect(body.diet.profile.recipeMatchMode).toBe("hide");
    expect(body.diet.options.presets).toHaveLength(2);
    expect(body.unreadNotificationCount).toBe(0);
  });
});

describe("profile cooking insights", () => {
  const cookingEvent = {
    sessionId: "018f2b16-43b4-7e7a-8d4b-9f3559865353",
    recipeSlug: "lentil-soup",
    recipeTitle: "Lentil soup",
    servings: 4,
  };

  const postCookingEvent = (event: "started" | "completed") =>
    app.request(
      "/api/profile/cooking-sessions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ ...cookingEvent, event }),
      },
      env,
    );

  it("requires authentication", async () => {
    const res = await app.request("/api/profile/cooking-insights", {}, env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("records a start, completes it, and returns cooking statistics", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const initial = await app.request(
      "/api/profile/cooking-insights",
      {},
      env,
    );
    expect(await initial.json()).toEqual({
      cookModeStarts: 0,
      mealsCooked: 0,
      distinctRecipesCooked: 0,
      recent: [],
    });

    const started = await postCookingEvent("started");
    expect(started.status).toBe(201);
    expect(await started.json()).toMatchObject({
      cookingSession: {
        id: cookingEvent.sessionId,
        recipeSlug: cookingEvent.recipeSlug,
        completedAt: null,
      },
    });

    const completed = await postCookingEvent("completed");
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      cookingSession: {
        id: cookingEvent.sessionId,
        completedAt: expect.any(String),
      },
    });

    const insights = await app.request(
      "/api/profile/cooking-insights",
      {},
      env,
    );
    expect(await insights.json()).toMatchObject({
      cookModeStarts: 1,
      mealsCooked: 1,
      distinctRecipesCooked: 1,
      recent: [
        {
          id: cookingEvent.sessionId,
          recipeSlug: cookingEvent.recipeSlug,
          recipeTitle: cookingEvent.recipeTitle,
          servings: cookingEvent.servings,
          completedAt: expect.any(String),
        },
      ],
    });
  });

  it("rejects a session ID already owned by another user", async () => {
    dbMock.state.cookingSessions.push({
      id: cookingEvent.sessionId,
      userId: "another-user",
      recipeSlug: "pizza",
      recipeTitle: "Pizza",
      servings: 2,
      startedAt: dbMock.date,
      completedAt: null,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await postCookingEvent("started");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Cooking session ID is already in use",
    });
  });
});

describe("shopping list flows", () => {
  const mutationHeaders = {
    "content-type": "application/json",
    origin: "http://localhost:3000",
  };
  const snapshot = {
    recipes: [{ slug: "tomato-soup", servings: 2 }],
    checked: ["tomato"],
    extras: [{ id: "extra-milk", text: "Milk", checked: false }],
  };

  beforeEach(() => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
  });

  it("makes the SQL test double reject a competing stale revision", () => {
    const list = {
      id: "00000000-0000-4000-8000-000000000080",
      userId: "owner-user",
      organizationId: null,
      status: "active" as const,
      revision: 0n,
      snapshot,
      closedAt: null,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    };
    dbMock.state.shoppingLists.push(list);
    const updateSql =
      'update "shopping_list" set "snapshot" = $1 where ("shopping_list"."id" = $2 and "shopping_list"."revision" = $3)';
    const params = [snapshot, dbMock.date, list.id, 0n];

    expect(dbMock.queryRows(updateSql, params)).toHaveLength(1);
    expect(dbMock.queryRows(updateSql, params)).toEqual([]);
    expect(list.revision).toBe(1n);
  });

  it("creates, updates, archives, and replaces a personal list", async () => {
    const initialResponse = await app.request(
      "/shopping-lists/current",
      {},
      env,
    );
    expect(initialResponse.status).toBe(200);
    const initial = (await initialResponse.json()) as {
      id: string;
      revision: string;
    };
    expect(initial).toMatchObject({
      resourceId: "owner-user",
      revision: "0",
      scope: { type: "personal" },
      snapshot: { recipes: [], checked: [], extras: [] },
    });

    const updateResponse = await app.request(
      "/shopping-lists/current",
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({
          listId: initial.id,
          revision: initial.revision,
          snapshot,
        }),
      },
      env,
    );
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      id: initial.id,
      revision: "1",
      snapshot,
    });

    const staleRevisionUpdate = await app.request(
      "/shopping-lists/current",
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({
          listId: initial.id,
          revision: initial.revision,
          snapshot,
        }),
      },
      env,
    );
    expect(staleRevisionUpdate.status).toBe(409);

    const staleUpdate = await app.request(
      "/shopping-lists/current",
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({
          listId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          revision: "0",
          snapshot,
        }),
      },
      env,
    );
    expect(staleUpdate.status).toBe(409);

    const staleReset = await app.request(
      "/shopping-lists",
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          previousListId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          previousRevision: "0",
          snapshot,
        }),
      },
      env,
    );
    expect(staleReset.status).toBe(409);

    const resetResponse = await app.request(
      "/shopping-lists",
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          previousListId: initial.id,
          previousRevision: "1",
          snapshot,
        }),
      },
      env,
    );
    expect(resetResponse.status).toBe(201);
    const next = (await resetResponse.json()) as { id: string };
    expect(next).toMatchObject({
      revision: "0",
      snapshot: { recipes: [], checked: [], extras: [] },
    });
    expect(next.id).not.toBe(initial.id);
    expect(dbMock.state.shoppingLists).toEqual([
      expect.objectContaining({
        id: initial.id,
        status: "archived",
        snapshot,
        closedAt: expect.any(Date),
      }),
      expect.objectContaining({ id: next.id, status: "active" }),
    ]);
  });

  it("uses the household as the current-list owner", async () => {
    dbMock.state.organizations.push({
      id: HOUSEHOLD_ID,
      name: "Park Road",
      slug: "park-road",
      logo: null,
      metadata: null,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    dbMock.state.members.push({
      id: OWNER_MEMBER_ID,
      organizationId: HOUSEHOLD_ID,
      userId: "owner-user",
      role: "owner",
      createdAt: dbMock.date,
    });

    const response = await app.request("/shopping-lists/current", {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resourceId: HOUSEHOLD_ID,
      scope: {
        type: "household",
        household: { id: HOUSEHOLD_ID, name: "Park Road" },
      },
    });
    expect(dbMock.state.shoppingLists[0]).toMatchObject({
      userId: null,
      organizationId: HOUSEHOLD_ID,
    });
  });
});

describe("pantry mutation flows", () => {
  const mutationHeaders = {
    "content-type": "application/json",
    origin: "http://localhost:3000",
  };

  beforeEach(() => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    dbMock.state.ingredients.push(
      {
        slug: "onion",
        name: "Onion",
        category: "vegetable",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
      {
        slug: "milk",
        name: "Milk",
        category: "dairy",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
    );
  });

  it("replaces a personal pantry and validates every ingredient", async () => {
    const response = await app.request(
      "/pantry",
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({
          stock: { onion: "fresh", milk: "fridge" },
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resourceId: "owner-user",
      revision: "1",
      operationId: expect.any(String),
      scope: { type: "personal" },
      stock: { onion: "fresh", milk: "fridge" },
      itemVersions: { onion: "1", milk: "1" },
    });
    expect(dbMock.state.pantryItems).toEqual([
      expect.objectContaining({
        userId: "owner-user",
        organizationId: null,
        ingredientSlug: "onion",
        location: "fresh",
      }),
      expect.objectContaining({
        userId: "owner-user",
        organizationId: null,
        ingredientSlug: "milk",
        location: "fridge",
      }),
    ]);

    const unknownIngredient = await app.request(
      "/pantry",
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({ stock: { dragonfruit: "fresh" } }),
      },
      env,
    );
    expect(unknownIngredient.status).toBe(400);
    expect(await unknownIngredient.json()).toEqual({
      error: "Unknown ingredient: dragonfruit",
    });

    const invalidBody = await app.request(
      "/pantry",
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({ stock: { onion: "freezer" } }),
      },
      env,
    );
    expect(invalidBody.status).toBe(400);
  });

  it("sets, moves, and removes a household pantry item", async () => {
    seedHousehold();

    const setResponse = await app.request(
      "/pantry/items/onion",
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({ location: "cupboards" }),
      },
      env,
    );
    expect(setResponse.status).toBe(200);
    expect(await setResponse.json()).toEqual({
      resourceId: HOUSEHOLD_ID,
      revision: "1",
      operationId: expect.any(String),
      scope: {
        type: "household",
        household: { id: HOUSEHOLD_ID, name: "Owner household" },
      },
      stock: { onion: "cupboards" },
      itemVersions: { onion: "1" },
    });
    expect(dbMock.state.pantryItems[0]).toEqual(
      expect.objectContaining({
        userId: null,
        organizationId: HOUSEHOLD_ID,
        ingredientSlug: "onion",
        location: "cupboards",
      }),
    );

    const moveResponse = await app.request(
      "/pantry/items/onion",
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({ location: "fresh" }),
      },
      env,
    );
    expect(moveResponse.status).toBe(200);
    expect(await moveResponse.json()).toEqual({
      resourceId: HOUSEHOLD_ID,
      revision: "2",
      operationId: expect.any(String),
      scope: {
        type: "household",
        household: { id: HOUSEHOLD_ID, name: "Owner household" },
      },
      stock: { onion: "fresh" },
      itemVersions: { onion: "2" },
    });
    expect(dbMock.state.pantryItems).toHaveLength(1);

    const removeResponse = await app.request(
      "/pantry/items/onion",
      {
        method: "DELETE",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );
    expect(removeResponse.status).toBe(200);
    expect(await removeResponse.json()).toEqual({
      resourceId: HOUSEHOLD_ID,
      revision: "3",
      operationId: expect.any(String),
      scope: {
        type: "household",
        household: { id: HOUSEHOLD_ID, name: "Owner household" },
      },
      stock: {},
      itemVersions: {},
    });
    expect(dbMock.state.pantryItems).toEqual([]);
  });

  it("rejects a single-item write that would exceed pantry capacity", async () => {
    dbMock.state.pantryItems.push(
      ...Array.from({ length: 500 }, (_, index) => ({
        id: crypto.randomUUID(),
        userId: "owner-user",
        organizationId: null,
        ingredientSlug: `existing-${index}`,
        location: "cupboards" as const,
        version: 1n,
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      })),
    );

    const response = await app.request(
      "/pantry/items/onion",
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({ location: "fresh" }),
      },
      env,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "A pantry can contain at most 500 ingredients",
    });
  });

  it("publishes the committed household revision through one derived room", async () => {
    seedHousehold();
    const operationId = "0198f1f0-1111-7111-8111-111111111111";
    const roomFetch = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.resolve(Response.json({ delivered: 1, disconnected: 0 })),
    );
    const realtime = {
      idFromName: vi.fn(() => ({ household: HOUSEHOLD_ID })),
      get: vi.fn(() => ({ fetch: roomFetch })),
    } as unknown as DurableObjectNamespace;

    const response = await app.request(
      "/pantry/items/onion",
      {
        method: "PUT",
        headers: { ...mutationHeaders, "idempotency-key": operationId },
        body: JSON.stringify({ location: "fresh" }),
      },
      { ...env, HOUSEHOLD_REALTIME: realtime },
    );

    expect(response.status).toBe(200);
    expect(realtime.idFromName).toHaveBeenCalledWith(HOUSEHOLD_ID);
    const publishRequest = roomFetch.mock.calls[0]?.[0];
    expect(publishRequest).toBe("https://household-realtime/publish");
    const publishInit = roomFetch.mock.calls[0]?.[1];
    expect(JSON.parse(String(publishInit?.body))).toEqual({
      event: {
        type: "resource.changed",
        resourceType: "pantry",
        resourceId: HOUSEHOLD_ID,
        revision: "1",
        operationId,
        changeKind: "pantry.item-set",
        pantry: {
          resourceId: HOUSEHOLD_ID,
          revision: "1",
          operationId,
          scope: {
            type: "household",
            household: { id: HOUSEHOLD_ID, name: "Owner household" },
          },
          stock: { onion: "fresh" },
          itemVersions: { onion: "1" },
        },
      },
      authorizedUserIds: ["owner-user", "member-user"],
    });
    expect(publishInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns a committed mutation without waiting for realtime publication", async () => {
    seedHousehold();
    const publication = deferred<Response>();
    const roomFetch = vi.fn(() => publication.promise);
    const realtime = {
      idFromName: vi.fn(() => ({ household: HOUSEHOLD_ID })),
      get: vi.fn(() => ({ fetch: roomFetch })),
    } as unknown as DurableObjectNamespace;
    const pending: Promise<unknown>[] = [];
    const executionCtx = {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const response = await app.fetch(
      new Request("http://localhost:3000/pantry/items/onion", {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({ location: "fresh" }),
      }),
      { ...env, HOUSEHOLD_REALTIME: realtime },
      executionCtx,
    );

    expect(response.status).toBe(200);
    expect(pending).toHaveLength(1);
    publication.resolve(Response.json({ delivered: 1, disconnected: 0 }));
    await Promise.all(pending);
    expect(roomFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a committed mutation successful when publication retries fail", async () => {
    seedHousehold();
    const roomFetch = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.reject(new Error("room unavailable")),
    );
    const realtime = {
      idFromName: vi.fn(() => ({ household: HOUSEHOLD_ID })),
      get: vi.fn(() => ({ fetch: roomFetch })),
    } as unknown as DurableObjectNamespace;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await app.request(
        "/pantry/items/onion",
        {
          method: "PUT",
          headers: mutationHeaders,
          body: JSON.stringify({ location: "fresh" }),
        },
        { ...env, HOUSEHOLD_REALTIME: realtime },
      );

      expect(response.status).toBe(200);
      expect(roomFetch).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Pantry realtime publication failed"),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("restores only missing household pantry items", async () => {
    seedHousehold();

    dbMock.state.pantryItems.push({
      id: crypto.randomUUID(),
      userId: null,
      organizationId: HOUSEHOLD_ID,
      ingredientSlug: "milk",
      location: "fresh",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    const restoreResponse = await app.request(
      "/pantry",
      {
        method: "PATCH",
        headers: mutationHeaders,
        body: JSON.stringify({
          stock: { onion: "cupboards", milk: "fridge" },
        }),
      },
      env,
    );
    expect(restoreResponse.status).toBe(200);
    expect(await restoreResponse.json()).toEqual({
      resourceId: HOUSEHOLD_ID,
      revision: "1",
      operationId: expect.any(String),
      scope: {
        type: "household",
        household: { id: HOUSEHOLD_ID, name: "Owner household" },
      },
      stock: { milk: "fresh", onion: "cupboards" },
      itemVersions: { milk: "1", onion: "1" },
    });
  });

  it("replays a duplicate pantry operation without incrementing its revision", async () => {
    seedHousehold();
    const operationId = "0198f1f0-1111-7111-8111-111111111111";
    const request = () =>
      app.request(
        "/pantry/items/onion",
        {
          method: "PUT",
          headers: { ...mutationHeaders, "idempotency-key": operationId },
          body: JSON.stringify({ location: "fresh" }),
        },
        env,
      );

    const first = await request();
    const duplicate = await request();

    expect(first.status).toBe(200);
    expect(await duplicate.json()).toEqual(await first.json());
    expect(dbMock.state.pantryAggregates).toEqual([
      expect.objectContaining({ revision: 1n }),
    ]);
    expect(dbMock.state.pantryOperations).toHaveLength(1);

    const conflictingReuse = await app.request(
      "/pantry/items/onion",
      {
        method: "PUT",
        headers: { ...mutationHeaders, "idempotency-key": operationId },
        body: JSON.stringify({ location: "cupboards" }),
      },
      env,
    );
    expect(conflictingReuse.status).toBe(409);
    expect(await conflictingReuse.json()).toEqual({
      error: "Operation ID was already used for a different pantry command",
    });
  });

  it("replaces an incompatible pantry operation receipt instead of replaying it", async () => {
    seedHousehold();
    const operationId = "0198f1f0-1111-7111-8111-111111111111";
    const request = () =>
      app.request(
        "/pantry/items/onion",
        {
          method: "PUT",
          headers: { ...mutationHeaders, "idempotency-key": operationId },
          body: JSON.stringify({ location: "fresh" }),
        },
        env,
      );

    expect((await request()).status).toBe(200);
    dbMock.state.pantryOperations[0]!.result = { version: 0 };

    expect(await (await request()).json()).toMatchObject({
      operationId,
      revision: "2",
      itemVersions: { onion: "2" },
    });
    expect(dbMock.state.pantryOperations).toHaveLength(1);
    expect(dbMock.state.pantryOperations[0]?.result).toMatchObject({
      version: 1,
    });
  });

  it("rejects invalid item mutations", async () => {
    const invalidOperationId = await app.request(
      "/pantry/items/onion",
      {
        method: "PUT",
        headers: {
          ...mutationHeaders,
          "idempotency-key": "not-a-uuid",
        },
        body: JSON.stringify({ location: "fresh" }),
      },
      env,
    );
    expect(invalidOperationId.status).toBe(400);
    expect(await invalidOperationId.json()).toEqual({
      error: "Invalid Idempotency-Key header",
    });

    const invalidSlug = await app.request(
      `/pantry/items/${"x".repeat(201)}`,
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({ location: "fresh" }),
      },
      env,
    );
    expect(invalidSlug.status).toBe(400);
    expect(await invalidSlug.json()).toEqual({
      error: "Invalid ingredient slug",
    });

    const invalidLocation = await app.request(
      "/pantry/items/onion",
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({ location: "freezer" }),
      },
      env,
    );
    expect(invalidLocation.status).toBe(400);

    const unknownIngredient = await app.request(
      "/pantry/items/dragonfruit",
      {
        method: "PUT",
        headers: mutationHeaders,
        body: JSON.stringify({ location: "fresh" }),
      },
      env,
    );
    expect(unknownIngredient.status).toBe(400);
    expect(await unknownIngredient.json()).toEqual({
      error: "Unknown ingredient: dragonfruit",
    });

    const invalidDelete = await app.request(
      `/pantry/items/${"x".repeat(201)}`,
      {
        method: "DELETE",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );
    expect(invalidDelete.status).toBe(400);
    expect(await invalidDelete.json()).toEqual({
      error: "Invalid ingredient slug",
    });
  });
});

describe("household membership flows", () => {
  it("routes an authenticated household member to the derived realtime room", async () => {
    seedHousehold();
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });
    const roomFetch = vi.fn((_request: Request) =>
      Promise.resolve(new Response(null)),
    );
    const roomId = { household: HOUSEHOLD_ID };
    const realtime = {
      idFromName: vi.fn(() => roomId),
      get: vi.fn(() => ({ fetch: roomFetch })),
    } as unknown as DurableObjectNamespace;

    const response = await app.request(
      "/pantry/realtime",
      {
        headers: {
          origin: "http://localhost:3000",
          upgrade: "websocket",
          "x-realtime-user-id": "attacker-controlled",
        },
      },
      { ...env, HOUSEHOLD_REALTIME: realtime },
    );

    expect(response.status).toBe(200);
    expect(realtime.idFromName).toHaveBeenCalledWith(HOUSEHOLD_ID);
    expect(roomFetch).toHaveBeenCalledOnce();
    const request = roomFetch.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error("Expected room request");
    expect(request.headers.get("x-realtime-user-id")).toBe("member-user");
    expect(request.headers.get("x-realtime-resource-id")).toBe(HOUSEHOLD_ID);
  });

  it("rejects realtime upgrades from another origin", async () => {
    const response = await app.request(
      "/pantry/realtime",
      { headers: { origin: "https://attacker.test", upgrade: "websocket" } },
      { ...env, HOUSEHOLD_REALTIME: {} as DurableObjectNamespace },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Realtime origin is not allowed",
    });
  });

  it("canonicalizes the realtime origin before comparing it", async () => {
    seedHousehold();
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });
    const roomFetch = vi.fn(() => Promise.resolve(new Response(null)));
    const realtime = {
      idFromName: vi.fn(() => ({ household: HOUSEHOLD_ID })),
      get: vi.fn(() => ({ fetch: roomFetch })),
    } as unknown as DurableObjectNamespace;

    const response = await app.request(
      "/pantry/realtime",
      { headers: { origin: "HTTP://LOCALHOST:3000", upgrade: "websocket" } },
      { ...env, HOUSEHOLD_REALTIME: realtime },
    );

    expect(response.status).toBe(200);
    expect(roomFetch).toHaveBeenCalledOnce();
  });

  it("does not create a collaborative room for a solo pantry", async () => {
    authzMock.session = sessionFor({
      id: "solo-user",
      email: "solo@example.test",
      name: "Solo",
    });
    const response = await app.request(
      "/pantry/realtime",
      {
        headers: {
          origin: "http://localhost:3000",
          upgrade: "websocket",
        },
      },
      { ...env, HOUSEHOLD_REALTIME: {} as DurableObjectNamespace },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Realtime pantry updates require a household",
    });
  });

  it("returns the same household pantry to every member", async () => {
    seedHousehold();
    dbMock.state.pantryItems.push({
      id: crypto.randomUUID(),
      userId: null,
      organizationId: HOUSEHOLD_ID,
      ingredientSlug: "onion",
      location: "fresh",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });

    for (const user of [
      {
        id: "owner-user",
        email: "owner@example.test",
        name: "Owner",
      },
      {
        id: "member-user",
        email: "member@example.test",
        name: "Member",
      },
    ]) {
      authzMock.session = sessionFor(user);
      const response = await app.request("/pantry", undefined, env);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({
        resourceId: HOUSEHOLD_ID,
        revision: "0",
        scope: {
          type: "household",
          household: {
            id: HOUSEHOLD_ID,
            name: "Owner household",
          },
        },
        stock: { onion: "fresh" },
        itemVersions: { onion: "1" },
      });
    }
  });

  it("requires authentication before creating a household", async () => {
    const res = await app.request(
      "/households",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ name: "Dinner Club" }),
      },
      env,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("creates a household with the creator as owner", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      "/households",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ name: "Dinner Club" }),
      },
      env,
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "Dinner Club" });
    expect(dbMock.state.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "owner-user", role: "owner" }),
      ]),
    );
  });

  it("prevents a user from creating a second household", async () => {
    seedHousehold();
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });

    const res = await app.request(
      "/households",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ name: "Second Household" }),
      },
      env,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "User already belongs to a household",
    });
  });

  it("allows owners to rename their household", async () => {
    seedHousehold();
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ name: "Park Road kitchen" }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: HOUSEHOLD_ID,
      name: "Park Road kitchen",
    });
  });

  it("returns pending invitations to household owners", async () => {
    seedHousehold();
    dbMock.state.invitations.push(
      {
        id: PENDING_INVITATION_ID,
        organizationId: HOUSEHOLD_ID,
        email: "new@example.test",
        role: "member",
        status: "pending",
        expiresAt: new Date("2099-01-03T00:00:00.000Z"),
        inviterId: "owner-user",
        createdAt: dbMock.date,
      },
      {
        id: "accepted-invitation",
        organizationId: HOUSEHOLD_ID,
        email: "old@example.test",
        role: "member",
        status: "accepted",
        expiresAt: new Date("2099-01-03T00:00:00.000Z"),
        inviterId: "owner-user",
        createdAt: dbMock.date,
      },
    );
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/invitations`,
      {},
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({
        id: PENDING_INVITATION_ID,
        status: "pending",
      }),
    ]);
  });

  it("returns incoming invitations for the signed-in email", async () => {
    seedHousehold();
    dbMock.state.invitations.push({
      id: PENDING_INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "invitee@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2099-01-03T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "invitee-user",
      email: "invitee@example.test",
      name: "Invitee",
    });

    const res = await app.request("/households/invitations", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({
        id: PENDING_INVITATION_ID,
        household: { id: HOUSEHOLD_ID, name: "Owner household" },
      }),
    ]);
  });

  it("returns invitations sent to another verified email owned by the account", async () => {
    seedHousehold();
    dbMock.state.userEmails.push({
      email: "invitee.alias@example.test",
      userId: "invitee-user",
      verified: true,
      isPrimary: false,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    dbMock.state.invitations.push({
      id: ALIAS_INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "invitee.alias@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2099-01-03T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "invitee-user",
      email: "invitee@example.test",
      name: "Invitee",
    });

    const res = await app.request("/households/invitations", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({ id: ALIAS_INVITATION_ID }),
    ]);
  });

  it("allows owners to delete the household", async () => {
    seedHousehold();
    dbMock.state.pantryItems.push(
      {
        id: crypto.randomUUID(),
        userId: "owner-user",
        organizationId: null,
        ingredientSlug: "onion",
        location: "cupboards",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
      {
        id: crypto.randomUUID(),
        userId: null,
        organizationId: HOUSEHOLD_ID,
        ingredientSlug: "onion",
        location: "fresh",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
      {
        id: crypto.randomUUID(),
        userId: null,
        organizationId: HOUSEHOLD_ID,
        ingredientSlug: "milk",
        location: "fridge",
        createdAt: dbMock.date,
        updatedAt: dbMock.date,
      },
    );
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}`,
      {
        method: "DELETE",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(204);
    expect(dbMock.state.organizations).toHaveLength(0);
    expect(dbMock.state.members).toHaveLength(0);
    expect(dbMock.state.pantryItems).toEqual([
      expect.objectContaining({
        userId: "owner-user",
        organizationId: null,
        ingredientSlug: "onion",
        location: "fresh",
      }),
      expect.objectContaining({
        userId: "owner-user",
        organizationId: null,
        ingredientSlug: "milk",
        location: "fridge",
      }),
    ]);
    expect(dbMock.state.notificationEvents).toEqual([
      expect.objectContaining({ kind: "household_deleted" }),
    ]);
    expect(dbMock.state.notificationDeliveries).toEqual([
      expect.objectContaining({ recipientUserId: "member-user" }),
    ]);
  });

  it("lists household members for existing members", async () => {
    seedHousehold();
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });

    const res = await app.request(`/households/${HOUSEHOLD_ID}/members`, {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: OWNER_MEMBER_ID,
          role: "owner",
          user: expect.objectContaining({ email: "owner@example.test" }),
        }),
        expect.objectContaining({
          id: MEMBER_MEMBER_ID,
          role: "member",
          user: expect.objectContaining({ email: "member@example.test" }),
        }),
      ]),
    );
  });

  it("returns 403 when non-members list household members", async () => {
    seedHousehold();
    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });

    const res = await app.request(`/households/${HOUSEHOLD_ID}/members`, {}, env);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Authorization required" });
  });

  it("allows owners to invite household members", async () => {
    seedHousehold();
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/invitations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email: "NewMember@Example.test" }),
      },
      env,
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      householdId: HOUSEHOLD_ID,
      email: "newmember@example.test",
      role: "member",
      status: "pending",
    });
  });

  it("notifies the account that owns an invited verified email alias", async () => {
    seedHousehold();
    dbMock.state.userEmails.push({
      email: "outsider.alias@example.test",
      userId: "outsider-user",
      verified: true,
      isPrimary: false,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/invitations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email: "Outsider.Alias@Example.test" }),
      },
      env,
    );

    expect(res.status).toBe(201);
    expect(dbMock.state.notificationDeliveries).toEqual([
      expect.objectContaining({ recipientUserId: "outsider-user" }),
    ]);
  });

  it("does not notify an account for an invited unverified primary email", async () => {
    seedHousehold();
    const outsider = dbMock.state.users.find(
      (candidate) => candidate.id === "outsider-user",
    );
    const outsiderEmail = dbMock.state.userEmails.find(
      (candidate) => candidate.userId === "outsider-user" && candidate.isPrimary,
    );
    if (!outsider || !outsiderEmail) throw new Error("Missing seeded outsider");
    outsider.email = "unverified@example.test";
    outsider.emailVerified = false;
    outsiderEmail.email = outsider.email;
    outsiderEmail.verified = false;
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/invitations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email: outsider.email }),
      },
      env,
    );

    expect(res.status).toBe(201);
    expect(dbMock.state.notificationDeliveries).toHaveLength(0);
  });

  it("hydrates and accepts an invitation through its generic notification action", async () => {
    seedHousehold();
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    const inviteResponse = await app.request(
      `/households/${HOUSEHOLD_ID}/invitations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email: "outsider@example.test" }),
      },
      env,
    );
    expect(inviteResponse.status).toBe(201);

    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });
    const archiveResponse = await app.request("/notifications", {}, env);
    expect(archiveResponse.status).toBe(200);
    const archive = (await archiveResponse.json()) as {
      items: Array<{
        id: string;
        kind: string;
        actions: string[];
        detail: { household: { name: string }; invitationStatus: string };
      }>;
    };
    expect(archive.items).toHaveLength(1);
    expect(archive.items[0]).toMatchObject({
      kind: "household_invited",
      actions: ["accept", "decline"],
      detail: {
        household: { name: "Owner household" },
        invitationStatus: "pending",
      },
    });
    expect(dbMock.state.invitations[0]).toMatchObject({
      status: "pending",
      email: "outsider@example.test",
    });
    expect(dbMock.state.invitations[0]?.expiresAt.getTime()).toBeGreaterThan(
      Date.now(),
    );

    const notificationId = archive.items[0]?.id;
    expect(notificationId).toBeTruthy();
    const actionResponse = await app.request(
      `/notifications/${notificationId}/actions/accept`,
      { method: "POST", headers: { origin: "http://localhost:3000" } },
      env,
    );

    const actionBody = await actionResponse.json();
    expect(actionResponse.status, JSON.stringify(actionBody)).toBe(200);
    expect(actionBody).toMatchObject({
      item: {
        id: notificationId,
        actions: [],
        detail: { invitationStatus: "accepted" },
      },
    });
    expect(dbMock.state.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "outsider-user" }),
      ]),
    );
  });

  it("returns an unread count for the complete notification archive", async () => {
    seedHousehold();
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    for (let index = 0; index < 101; index += 1) {
      dbMock.state.notificationEvents.push({
        id: `event-${index}`,
        kind: "future_activity",
        actorUserId: null,
        actorNameSnapshot: null,
        occurredAt: new Date(dbMock.date.getTime() - index),
      });
      dbMock.state.notificationDeliveries.push({
        id: `delivery-${index}`,
        eventId: `event-${index}`,
        recipientUserId: "owner-user",
        readAt: null,
        dismissedAt: null,
      });
    }

    const res = await app.request("/notifications", {}, env);
    const body = (await res.json()) as {
      items: unknown[];
      nextOffset: number | null;
      unreadCount: number;
    };

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(100);
    expect(body.nextOffset).toBe(100);
    expect(body.unreadCount).toBe(101);
  });

  it("returns an unread count without hydrating the notification archive", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    dbMock.state.notificationDeliveries.push(
      {
        id: "delivery-unread",
        eventId: "missing-event-unread",
        recipientUserId: "owner-user",
        readAt: null,
        dismissedAt: null,
      },
      {
        id: "delivery-read",
        eventId: "missing-event-read",
        recipientUserId: "owner-user",
        readAt: dbMock.date,
        dismissedAt: null,
      },
      {
        id: "delivery-dismissed",
        eventId: "missing-event-dismissed",
        recipientUserId: "owner-user",
        readAt: null,
        dismissedAt: dbMock.date,
      },
      {
        id: "delivery-other-user",
        eventId: "missing-event-other-user",
        recipientUserId: "other-user",
        readAt: null,
        dismissedAt: null,
      },
    );

    const res = await app.request("/notifications/unread-count", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    await expect(res.json()).resolves.toEqual({ unreadCount: 1 });
  });

  it("hydrates a pending agent approval notification without exposing its code", async () => {
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    dbMock.state.notificationEvents.push({
      id: "event-agent-1",
      kind: "agent_approval_requested",
      actorUserId: null,
      actorNameSnapshot: null,
      occurredAt: dbMock.date,
    });
    dbMock.state.notificationDeliveries.push({
      id: "delivery-agent-1",
      eventId: "event-agent-1",
      recipientUserId: "owner-user",
      readAt: null,
      dismissedAt: null,
    });
    dbMock.state.notificationAgentApprovalEvents.push({
      eventId: "event-agent-1",
      approvalRequestId: "approval-1",
      agentIdSnapshot: "agent-1",
      agentNameSnapshot: "Meal planner",
      capabilitiesSnapshot: "recipes.search recipes.read",
      expiresAtSnapshot: expiresAt,
      approvalCodeCiphertext: await encryptAgentApprovalCode(
        "WXYZ-9876",
        env.BETTER_AUTH_SECRET,
      ),
      approvalStatus: "pending",
      approvalExpiresAt: expiresAt,
    });

    const res = await app.request("/notifications", {}, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      items: [
        {
          kind: "agent_approval_requested",
          actions: [],
          detail: {
            type: "agent_approval",
            agent: { id: "agent-1", name: "Meal planner" },
            capabilities: ["recipes.search", "recipes.read"],
            status: "pending",
            reviewUrl:
              "/recipes/settings/agents/approve?agent_id=agent-1&code=WXYZ-9876",
          },
        },
      ],
      unreadCount: 1,
    });
    expect(JSON.stringify(body)).not.toContain("user_code");
  });

  it("returns 429 once the owner exceeds the invite rate limit", async () => {
    seedHousehold();
    // Pre-fill the per-account window to its cap so the next invite trips it.
    dbMock.state.rateLimitCounts.set("household-invite:owner-user", 10);
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/invitations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email: "newmember@example.test" }),
      },
      env,
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(await res.json()).toMatchObject({ error: "Too many requests" });
    // The invitation is rejected before any row is written.
    expect(dbMock.state.invitations).toHaveLength(0);
  });

  it("returns 409 when a pending invitation already exists for the email", async () => {
    seedHousehold();
    dbMock.state.invitations.push({
      id: INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "newmember@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2099-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/invitations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email: "NewMember@Example.test" }),
      },
      env,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "A pending invitation already exists for this email",
    });
    expect(dbMock.state.invitations).toHaveLength(1);
  });

  it("allows a new invitation when the previous pending row has expired", async () => {
    seedHousehold();
    dbMock.state.invitations.push({
      id: "expired-invitation",
      organizationId: HOUSEHOLD_ID,
      email: "newmember@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2020-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/invitations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email: "newmember@example.test" }),
      },
      env,
    );

    expect(res.status).toBe(201);
    expect(dbMock.state.invitations).toHaveLength(2);
    expect(dbMock.state.invitations.at(-1)).toMatchObject({
      email: "newmember@example.test",
      status: "pending",
    });
  });

  it("returns 403 when non-owners invite household members", async () => {
    seedHousehold();
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/invitations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email: "newmember@example.test" }),
      },
      env,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Authorization required" });
  });

  it("allows invited users to accept invitations", async () => {
    seedHousehold();
    dbMock.state.invitations.push({
      id: INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "outsider@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2027-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });

    const res = await app.request(
      `/households/invitations/${INVITATION_ID}/accept`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      invitation: { id: INVITATION_ID, status: "accepted" },
      membershipCreated: true,
    });
    expect(dbMock.state.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: HOUSEHOLD_ID,
          userId: "outsider-user",
          role: "member",
        }),
      ]),
    );
  });

  it("rejects an invitation when the invitee's personal pantry is populated", async () => {
    seedHousehold();
    dbMock.state.invitations.push({
      id: INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "outsider@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2027-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    dbMock.state.pantryItems.push({
      id: crypto.randomUUID(),
      userId: "outsider-user",
      organizationId: null,
      ingredientSlug: "onion",
      location: "fresh",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });

    const response = await app.request(
      `/households/invitations/${INVITATION_ID}/accept`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Pantry must be empty before joining a household",
    });
    expect(dbMock.state.invitations[0]?.status).toBe("pending");
    expect(dbMock.state.members).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "outsider-user" }),
      ]),
    );
  });

  it("rejects an invitation when its household no longer exists", async () => {
    dbMock.state.invitations.push({
      id: INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "outsider@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2027-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });

    const response = await app.request(
      `/households/invitations/${INVITATION_ID}/accept`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Household not found" });
    expect(dbMock.state.invitations[0]?.status).toBe("pending");
    expect(dbMock.state.members).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "outsider-user" }),
      ]),
    );
  });

  it("allows users to accept invitations sent to a verified email alias", async () => {
    seedHousehold();
    dbMock.state.userEmails.push({
      email: "outsider.alias@example.test",
      userId: "outsider-user",
      verified: true,
      isPrimary: false,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    dbMock.state.invitations.push({
      id: ALIAS_INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "outsider.alias@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2099-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });

    const res = await app.request(
      `/households/invitations/${ALIAS_INVITATION_ID}/accept`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(dbMock.state.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "outsider-user" }),
      ]),
    );
  });

  it("does not accept an invitation that expires before its atomic update", async () => {
    seedHousehold();
    dbMock.state.invitations.push({
      id: EXPIRING_INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "outsider@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2099-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    dbMock.state.expireInvitationOnUpdate = true;
    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });

    const res = await app.request(
      `/households/invitations/${EXPIRING_INVITATION_ID}/accept`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Invitation is not pending" });
    expect(dbMock.state.members).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "outsider-user" }),
      ]),
    );
  });

  it("does not accept invitations sent to an unverified email alias", async () => {
    seedHousehold();
    dbMock.state.userEmails.push({
      email: "outsider.alias@example.test",
      userId: "outsider-user",
      verified: false,
      isPrimary: false,
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    dbMock.state.invitations.push({
      id: ALIAS_INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "outsider.alias@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2099-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });

    const res = await app.request(
      `/households/invitations/${ALIAS_INVITATION_ID}/accept`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(403);
    expect(dbMock.state.members).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "outsider-user" }),
      ]),
    );
  });

  it("returns 403 when a different user accepts an invitation", async () => {
    seedHousehold();
    dbMock.state.invitations.push({
      id: INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "member@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2027-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });

    const res = await app.request(
      `/households/invitations/${INVITATION_ID}/accept`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Authorization required" });
  });

  it("prevents a user from accepting an invite while already in a household", async () => {
    seedHousehold();
    dbMock.state.invitations.push({
      id: INVITATION_ID,
      organizationId: "other-household",
      email: "member@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2027-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });

    const res = await app.request(
      `/households/invitations/${INVITATION_ID}/accept`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "User already belongs to a household",
    });
  });

  it("allows invited users to decline invitations", async () => {
    seedHousehold();
    dbMock.state.invitations.push({
      id: INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "member@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2027-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });

    const res = await app.request(
      `/households/invitations/${INVITATION_ID}/decline`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: INVITATION_ID,
      status: "rejected",
    });
  });

  it("prevents declining finalized invitations", async () => {
    seedHousehold();
    dbMock.state.invitations.push({
      id: INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "member@example.test",
      role: "member",
      status: "accepted",
      expiresAt: new Date("2027-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });

    const res = await app.request(
      `/households/invitations/${INVITATION_ID}/decline`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Invitation is not pending",
    });
  });

  it("allows owners to revoke pending invitations", async () => {
    seedHousehold();
    dbMock.state.invitations.push({
      id: INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "outsider@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date("2027-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/invitations/${INVITATION_ID}`,
      {
        method: "DELETE",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: INVITATION_ID,
      status: "canceled",
    });
  });

  it("prevents owners from revoking finalized invitations", async () => {
    seedHousehold();
    dbMock.state.invitations.push({
      id: INVITATION_ID,
      organizationId: HOUSEHOLD_ID,
      email: "outsider@example.test",
      role: "member",
      status: "accepted",
      expiresAt: new Date("2027-01-02T00:00:00.000Z"),
      inviterId: "owner-user",
      createdAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/invitations/${INVITATION_ID}`,
      {
        method: "DELETE",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Invitation is not pending",
    });
  });

  it("allows owners to revoke members", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "member-soup",
      title: "Member Soup",
      description: null,
      body: null,
      userId: "member-user",
      visibility: "household",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/members/${MEMBER_MEMBER_ID}`,
      {
        method: "DELETE",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(204);
    expect(dbMock.state.members).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: MEMBER_MEMBER_ID })]),
    );
    expect(dbMock.state.recipes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "member-soup",
          visibility: "private",
        }),
      ]),
    );
  });

  it("allows members to leave voluntarily", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "member-soup",
      title: "Member Soup",
      description: null,
      body: null,
      userId: "member-user",
      visibility: "household",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });

    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/leave`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(204);
    expect(dbMock.state.members).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: MEMBER_MEMBER_ID })]),
    );
    expect(dbMock.state.recipes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "member-soup",
          visibility: "private",
        }),
      ]),
    );
  });

  it("returns 404 when leaving a missing household", async () => {
    seedHousehold();
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });

    const res = await app.request(
      `/households/${MISSING_HOUSEHOLD_ID}/leave`,
      {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(res.status).toBe(404);
  });
});

describe("route id validation", () => {
  it("rejects a malformed household id before any database access", async () => {
    const res = await app.request(
      "/households/not-a-uuid/members",
      {},
      { DATABASE_URL: "" },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid household ID" });
  });

  it("rejects a malformed invitation id", async () => {
    const res = await app.request(
      "/households/invitations/not-a-uuid/accept",
      { method: "POST", headers: { origin: "http://localhost:3000" } },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid invitation ID" });
  });

  it("rejects a malformed member id", async () => {
    const res = await app.request(
      `/households/${HOUSEHOLD_ID}/members/not-a-uuid`,
      { method: "DELETE", headers: { origin: "http://localhost:3000" } },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid member ID" });
  });

  it("rejects a malformed notification id", async () => {
    const res = await app.request(
      "/notifications/not-a-uuid",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ read: true }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid notification ID" });
  });
});

describe("household recipe sharing", () => {
  it("allows recipe owners to share and unshare with their household", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "private-soup",
      title: "Private Soup",
      description: null,
      body: null,
      userId: "owner-user",
      visibility: "private",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "owner-user",
      email: "owner@example.test",
      name: "Owner",
    });

    const shareRes = await app.request(
      "/recipes/private-soup/household-share",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
      },
      env,
    );

    expect(shareRes.status).toBe(200);
    expect(await shareRes.json()).toMatchObject({
      slug: "private-soup",
      visibility: "household",
    });

    const unshareRes = await app.request(
      "/recipes/private-soup/household-share",
      {
        method: "DELETE",
        headers: { origin: "http://localhost:3000" },
      },
      env,
    );

    expect(unshareRes.status).toBe(200);
    expect(await unshareRes.json()).toMatchObject({
      slug: "private-soup",
      visibility: "private",
    });
  });

  it("allows household members to share their own recipes", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "member-soup",
      title: "Member Soup",
      description: null,
      body: null,
      userId: "member-user",
      visibility: "private",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "member-user",
      email: "member@example.test",
      name: "Member",
    });

    const res = await app.request(
      "/recipes/member-soup/household-share",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      slug: "member-soup",
      visibility: "household",
    });
  });

  it("returns 403 when a non-member shares to a household", async () => {
    seedHousehold();
    dbMock.state.recipes.push({
      id: "recipe-1",
      slug: "outsider-soup",
      title: "Outsider Soup",
      description: null,
      body: null,
      userId: "outsider-user",
      visibility: "private",
      createdAt: dbMock.date,
      updatedAt: dbMock.date,
    });
    authzMock.session = sessionFor({
      id: "outsider-user",
      email: "outsider@example.test",
      name: "Outsider",
    });

    const res = await app.request(
      "/recipes/outsider-soup/household-share",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
      },
      env,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Authorization required" });
  });
});

describe("PATCH /recipes/:slug", () => {
  it("rejects malformed slugs before authentication or database access", async () => {
    const res = await app.request(
      "/recipes/-invalid",
      { method: "PATCH" },
      { DATABASE_URL: "" },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid recipe slug",
      details: [
        {
          path: ["slug"],
          message:
            "Slug must use lowercase letters, numbers, and single hyphens between words",
        },
      ],
    });
  });
});

describe("POST /api/auth/sign-in/social", () => {
  it.each(["google", "github"] as const)(
    "uses the public frontend callback for %s",
    async (provider) => {
      const res = await app.request(
        "/api/auth/sign-in/social",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({
            provider,
            callbackURL: "/recipes",
            disableRedirect: true,
          }),
        },
        env,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string };
      const providerURL = new URL(body.url);
      expect(providerURL.searchParams.get("redirect_uri")).toBe(
        `http://localhost:3000/api/auth/callback/${provider}`,
      );
    },
  );

  it("returns 503 when the public auth URL is missing", async () => {
    const res = await app.request(
      "/api/auth/sign-in/social",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      },
      { ...env, BETTER_AUTH_URL: "" },
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Auth configuration is incomplete",
    });
  });

  it("returns 503 when the public auth URL is malformed", async () => {
    const res = await app.request(
      "/api/auth/sign-in/social",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      },
      { ...env, BETTER_AUTH_URL: "not-a-valid-url" },
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Auth configuration is invalid",
    });
  });

  it("rejects unsafe browser mutations without a trusted CSRF signal", async () => {
    const res = await app.request(
      "/api/auth/sign-in/social",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google" }),
      },
      env,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "CSRF validation failed",
      details: [
        {
          path: [],
          message: "Unsafe browser mutations must come from a trusted origin",
        },
      ],
    });
  });

  it("rejects same-site fetch metadata without a trusted origin", async () => {
    const res = await app.request(
      "/api/auth/sign-in/social",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-site",
        },
        body: JSON.stringify({ provider: "google" }),
      },
      env,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "CSRF validation failed",
      details: [
        {
          path: [],
          message: "Unsafe browser mutations must come from a trusted origin",
        },
      ],
    });
  });

  it("rejects same-origin fetch metadata without a trusted origin", async () => {
    const res = await app.request(
      "/api/auth/sign-in/social",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ provider: "google" }),
      },
      env,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "CSRF validation failed",
      details: [
        {
          path: [],
          message: "Unsafe browser mutations must come from a trusted origin",
        },
      ],
    });
  });

  it("does not expose raw Better Auth organization endpoints", async () => {
    const res = await app.request(
      "/api/auth/organization/create",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ name: "Bypass", slug: "bypass" }),
      },
      env,
    );

    expect(res.status).toBe(404);
  });
});

describe("Agent Auth request CSRF handling", () => {
  it("allows bearer-only machine requests without a browser origin", async () => {
    const res = await app.request(
      "/api/auth/capability/execute",
      {
        method: "POST",
        headers: {
          authorization: "Bearer invalid-agent-proof",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          capability: "recipes.search",
          arguments: { query: "pasta" },
        }),
      },
      env,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("does not let an authorization header bypass cookie CSRF checks", async () => {
    const res = await app.request(
      "/api/auth/capability/execute",
      {
        method: "POST",
        headers: {
          authorization: "Bearer invalid-agent-proof",
          cookie: "better-auth.session_token=victim-session",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          capability: "recipes.search",
          arguments: { query: "pasta" },
        }),
      },
      env,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "CSRF validation failed" });
  });
});

describe("preview authentication", () => {
  const previewEnv = {
    DATABASE_URL: env.DATABASE_URL,
    DEPLOYMENT_ENV: "preview",
    BETTER_AUTH_URL: "https://pr-42.personal-site-bu5.pages.dev",
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    PREVIEW_AUTH_PASSWORD: "a-long-random-preview-password",
    CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    CF_ACCESS_AUD: "preview-audience",
  };

  it("is unavailable outside preview deployments", async () => {
    const res = await app.request(
      "/api/auth/preview/scenarios",
      {},
      env,
    );
    expect(res.status).toBe(404);
  });

  it("does not expose fresh QA sign-up outside preview deployments", async () => {
    const res = await app.request(
      "/api/auth/preview/sign-up",
      { method: "POST" },
      env,
    );
    expect(res.status).toBe(404);
  });

  it.each([
    ["GET", "/api/auth/preview/scenarios"],
    ["POST", "/api/auth/preview/sign-up"],
    ["POST", "/api/auth/preview/sign-in"],
  ])(
    "does not expose %s %s when the preview environment uses a production hostname",
    async (method, path) => {
      const res = await app.request(
        path,
        { method },
        { ...previewEnv, BETTER_AUTH_URL: "https://robbiepalmer.me" },
      );

      expect(res.status).toBe(404);
    },
  );

  it("requires complete preview configuration", async () => {
    const res = await app.request(
      "/api/auth/preview/scenarios",
      {},
      { ...previewEnv, CF_ACCESS_AUD: "" },
    );
    expect(res.status).toBe(503);
  });

  it("requires a valid Cloudflare Access assertion", async () => {
    const res = await app.request(
      "/api/auth/preview/scenarios",
      {},
      previewEnv,
    );
    expect(res.status).toBe(403);
  });

  it("protects fresh QA sign-up with Cloudflare Access", async () => {
    const res = await app.request(
      "/api/auth/preview/sign-up",
      {
        method: "POST",
        headers: { origin: previewEnv.BETTER_AUTH_URL },
      },
      previewEnv,
    );
    expect(res.status).toBe(403);
  });

  it("rejects fresh QA sign-up without a trusted CSRF signal", async () => {
    const res = await app.request(
      "/api/auth/preview/sign-up",
      {
        method: "POST",
        headers: { "cf-access-jwt-assertion": "test-assertion" },
      },
      previewEnv,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "CSRF validation failed",
      details: [
        {
          path: [],
          message: "Unsafe browser mutations must come from a trusted origin",
        },
      ],
    });
  });

  it("returns the allowlisted scenarios after Access authorization", async () => {
    const res = await app.request(
      "/api/auth/preview/scenarios",
      { headers: { "cf-access-jwt-assertion": "test-assertion" } },
      previewEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "empty-user" }),
        expect.objectContaining({ id: "user-with-recipes" }),
        expect.objectContaining({ id: "admin-user" }),
      ]),
    );
  });

  it("rejects scenario identifiers that are not allowlisted", async () => {
    const res = await app.request(
      "/api/auth/preview/sign-in",
      {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": "test-assertion",
          "content-type": "application/json",
          origin: previewEnv.BETTER_AUTH_URL,
        },
        body: JSON.stringify({ scenario: "arbitrary-user" }),
      },
      previewEnv,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown preview scenario" });
  });

  it("returns structured validation errors for malformed preview sign-in bodies", async () => {
    const res = await app.request(
      "/api/auth/preview/sign-in",
      {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": "test-assertion",
          "content-type": "application/json",
          origin: previewEnv.BETTER_AUTH_URL,
        },
        body: JSON.stringify({ scenario: "" }),
      },
      previewEnv,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid request body",
      details: [
        {
          path: ["scenario"],
          message: expect.any(String),
        },
      ],
    });
  });

  it("returns structured errors for invalid preview sign-in JSON", async () => {
    const res = await app.request(
      "/api/auth/preview/sign-in",
      {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": "test-assertion",
          "content-type": "application/json",
          origin: previewEnv.BETTER_AUTH_URL,
        },
        body: "{not-json",
      },
      previewEnv,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid JSON",
      details: [
        {
          path: [],
          message: "Request body must be valid JSON",
        },
      ],
    });
  });

  it("returns unsupported media type for non-JSON preview sign-in bodies", async () => {
    const res = await app.request(
      "/api/auth/preview/sign-in",
      {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": "test-assertion",
          "content-type": "text/plain",
          origin: previewEnv.BETTER_AUTH_URL,
        },
        body: "empty-user",
      },
      previewEnv,
    );

    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({
      error: "Unsupported media type",
      details: [
        {
          path: [],
          message: "Request body must use application/json",
        },
      ],
    });
  });

  it("rejects preview sign-in without a trusted CSRF signal", async () => {
    const res = await app.request(
      "/api/auth/preview/sign-in",
      {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": "test-assertion",
          "content-type": "application/json",
        },
        body: JSON.stringify({ scenario: "empty-user" }),
      },
      previewEnv,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "CSRF validation failed",
      details: [
        {
          path: [],
          message: "Unsafe browser mutations must come from a trusted origin",
        },
      ],
    });
  });

  it("does not expose Better Auth's raw password endpoints", async () => {
    for (const path of [
      "/api/auth/sign-in/email",
      "/api/auth/sign-in/email/",
      "/api/auth/sign-up/email",
      "/api/auth/sign-up/email/",
    ]) {
      const res = await app.request(path, { method: "POST" }, previewEnv);
      expect(res.status).toBe(404);
    }
  });
});

describe("unknown routes", () => {
  it("returns 404", async () => {
    const res = await app.request("/unknown", {}, env);
    expect(res.status).toBe(404);
  });
});

describe("scheduled operational-row cleanup", () => {
  function runScheduled(bindings: typeof env) {
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    } as unknown as ExecutionContext;
    handler.scheduled?.({} as ScheduledController, bindings, ctx);
    return Promise.all(pending);
  }

  it("sweeps stale counters and pantry operation receipts", async () => {
    await runScheduled(env);
    expect(dbMock.state.rateLimitSweeps).toBe(1);
    expect(dbMock.state.pantryOperationSweeps).toBe(1);
  });

  it("no-ops without a database connection", async () => {
    await runScheduled({ ...env, DATABASE_URL: "" });
    expect(dbMock.state.rateLimitSweeps).toBe(0);
  });
});

import { apiRequest } from "@/lib/api/http";

export type HouseholdRole = "owner" | "member";

export type Household = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: string;
  updatedAt: string;
  membership: {
    id: string;
    role: HouseholdRole;
  };
};

export type HouseholdDetails = Omit<Household, "membership">;

export type HouseholdMember = {
  id: string;
  role: HouseholdRole;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string;
    image: string | null;
  };
};

export type HouseholdInvitation = {
  id: string;
  householdId: string;
  email: string;
  role: "member";
  status: "pending" | "accepted" | "rejected" | "canceled";
  expiresAt: string;
  createdAt: string;
};

export type IncomingHouseholdInvitation = HouseholdInvitation & {
  household: {
    id: string;
    name: string;
  };
};

export type EquipmentCategory =
  | "cookware"
  | "bakeware"
  | "appliance"
  | "utensil"
  | "measuring"
  | "vessel"
  | "surface"
  | "consumable";

export type HouseholdEquipmentCatalogItem = {
  slug: string;
  name: string;
  category: EquipmentCategory;
};

export type HouseholdEquipmentItem = {
  slug: string;
  name: string;
  category?: EquipmentCategory;
  createdAt: string;
  retired: boolean;
};

export type HouseholdEquipment = {
  catalog: HouseholdEquipmentCatalogItem[];
  owned: HouseholdEquipmentItem[];
  recipeMatchMode: EquipmentRecipeMatchMode;
};

export type EquipmentRecipeMatchMode = "hide" | "warn" | "disabled";

function householdRequest<T>(
  path: string,
  fallback: string,
  options?: {
    body?: unknown;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    signal?: AbortSignal;
  },
): Promise<T> {
  return apiRequest(path, {
    ...(options?.method ? { method: options.method } : {}),
    json: options?.body,
    signal: options?.signal,
    fallbackMessage: fallback,
  });
}

export async function getHouseholds(
  signal?: AbortSignal,
): Promise<Household[]> {
  return householdRequest("/api/households", "Couldn't load your household.", {
    signal,
  });
}

export async function getIncomingHouseholdInvitations(
  signal?: AbortSignal,
): Promise<IncomingHouseholdInvitation[]> {
  return householdRequest(
    "/api/households/invitations",
    "Couldn't load your household invitations.",
    { signal },
  );
}

export async function createHousehold(name: string): Promise<HouseholdDetails> {
  return householdRequest("/api/households", "Couldn't create the household.", {
    method: "POST",
    body: { name },
  });
}

export async function renameHousehold(
  householdId: string,
  name: string,
): Promise<HouseholdDetails> {
  return householdRequest(
    `/api/households/${householdId}`,
    "Couldn't rename the household.",
    { method: "PATCH", body: { name } },
  );
}

export async function getHouseholdMembers(
  householdId: string,
  signal?: AbortSignal,
): Promise<HouseholdMember[]> {
  return householdRequest(
    `/api/households/${householdId}/members`,
    "Couldn't load household members.",
    { signal },
  );
}

export async function getHouseholdEquipment(
  householdId: string,
  signal?: AbortSignal,
): Promise<HouseholdEquipment> {
  return householdRequest(
    `/api/households/${householdId}/equipment`,
    "Couldn't load household equipment.",
    { signal },
  );
}

export async function addHouseholdEquipment(
  householdId: string,
  equipmentSlug: string,
): Promise<HouseholdEquipmentItem> {
  return householdRequest(
    `/api/households/${householdId}/equipment/${encodeURIComponent(equipmentSlug)}`,
    "Couldn't add the equipment.",
    { method: "PUT" },
  );
}

export async function removeHouseholdEquipment(
  householdId: string,
  equipmentSlug: string,
): Promise<void> {
  await householdRequest<void>(
    `/api/households/${householdId}/equipment/${encodeURIComponent(equipmentSlug)}`,
    "Couldn't remove the equipment.",
    { method: "DELETE" },
  );
}

export async function saveHouseholdEquipmentMatchMode(
  householdId: string,
  recipeMatchMode: EquipmentRecipeMatchMode,
): Promise<{ recipeMatchMode: EquipmentRecipeMatchMode }> {
  return householdRequest(
    `/api/households/${householdId}/equipment`,
    "Couldn't save the equipment matching preference.",
    { method: "PATCH", body: { recipeMatchMode } },
  );
}

export async function getHouseholdInvitations(
  householdId: string,
  signal?: AbortSignal,
): Promise<HouseholdInvitation[]> {
  return householdRequest(
    `/api/households/${householdId}/invitations`,
    "Couldn't load pending invitations.",
    { signal },
  );
}

export async function inviteHouseholdMember(
  householdId: string,
  email: string,
): Promise<HouseholdInvitation> {
  return householdRequest(
    `/api/households/${householdId}/invitations`,
    "Couldn't send the invitation.",
    { method: "POST", body: { email } },
  );
}

export async function acceptHouseholdInvitation(
  invitationId: string,
): Promise<void> {
  await householdRequest<void>(
    `/api/households/invitations/${invitationId}/accept`,
    "Couldn't accept the household invitation.",
    { method: "POST" },
  );
}

export async function declineHouseholdInvitation(
  invitationId: string,
): Promise<void> {
  await householdRequest<void>(
    `/api/households/invitations/${invitationId}/decline`,
    "Couldn't decline the household invitation.",
    { method: "POST" },
  );
}

export async function revokeHouseholdInvitation(
  householdId: string,
  invitationId: string,
): Promise<void> {
  await householdRequest<void>(
    `/api/households/${householdId}/invitations/${invitationId}`,
    "Couldn't revoke the invitation.",
    { method: "DELETE" },
  );
}

export async function removeHouseholdMember(
  householdId: string,
  memberId: string,
): Promise<void> {
  await householdRequest<void>(
    `/api/households/${householdId}/members/${memberId}`,
    "Couldn't remove the household member.",
    { method: "DELETE" },
  );
}

export async function leaveHousehold(householdId: string): Promise<void> {
  await householdRequest<void>(
    `/api/households/${householdId}/leave`,
    "Couldn't leave the household.",
    { method: "POST" },
  );
}

export async function deleteHousehold(householdId: string): Promise<void> {
  await householdRequest<void>(
    `/api/households/${householdId}`,
    "Couldn't delete the household.",
    { method: "DELETE" },
  );
}

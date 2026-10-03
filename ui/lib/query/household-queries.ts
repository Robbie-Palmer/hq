import { queryOptions } from "@tanstack/react-query";
import { errorMessage } from "ts-base/errors";
import {
  getHouseholdEquipment,
  getHouseholdInvitations,
  getHouseholdMembers,
  getHouseholds,
  getIncomingHouseholdInvitations,
  type Household,
  type HouseholdEquipment,
  type HouseholdInvitation,
  type HouseholdMember,
  type IncomingHouseholdInvitation,
} from "@/lib/api/households";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

export type HouseholdSettingsData = {
  household: Household | null;
  equipment: HouseholdEquipment | null;
  members: HouseholdMember[];
  invitations: HouseholdInvitation[];
  incoming: IncomingHouseholdInvitation[];
  detailError: string | null;
};

function fulfilledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

async function fetchHouseholdSettings(
  signal?: AbortSignal,
): Promise<HouseholdSettingsData> {
  const households = await getHouseholds(signal);
  const household = households[0] ?? null;
  const [incomingResult, membersResult, invitationsResult, equipmentResult] =
    await Promise.allSettled([
      getIncomingHouseholdInvitations(signal),
      household
        ? getHouseholdMembers(household.id, signal)
        : Promise.resolve([]),
      household?.membership.role === "owner"
        ? getHouseholdInvitations(household.id, signal)
        : Promise.resolve([]),
      household
        ? getHouseholdEquipment(household.id, signal)
        : Promise.resolve(null),
    ]);
  const failedResult = [
    incomingResult,
    membersResult,
    invitationsResult,
    equipmentResult,
  ].find((result) => result.status === "rejected");

  return {
    household,
    equipment: fulfilledValue(equipmentResult, null),
    incoming: fulfilledValue(incomingResult, []),
    members: fulfilledValue(membersResult, []),
    invitations: fulfilledValue(invitationsResult, []),
    detailError:
      failedResult?.status === "rejected"
        ? errorMessage(
            failedResult.reason,
            "Some household details couldn't be loaded.",
          )
        : null,
  };
}

export const householdSettingsQuery = (userId: string) =>
  queryOptions({
    queryKey: recipeQueryKeys.householdSettings(userId),
    queryFn: ({ signal }) => fetchHouseholdSettings(signal),
    staleTime: 5 * 60_000,
  });

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type SubmitEvent,
  type SubmitEventHandler,
  useEffect,
  useRef,
  useState,
} from "react";
import { errorMessage } from "ts-base/errors";
import {
  acceptHouseholdInvitation,
  addHouseholdEquipment,
  createHousehold,
  declineHouseholdInvitation,
  deleteHousehold,
  type EquipmentRecipeMatchMode,
  type HouseholdEquipmentItem,
  type HouseholdInvitation,
  type HouseholdMember,
  type IncomingHouseholdInvitation,
  inviteHouseholdMember,
  leaveHousehold,
  removeHouseholdEquipment,
  removeHouseholdMember,
  renameHousehold,
  revokeHouseholdInvitation,
  saveHouseholdEquipmentMatchMode,
} from "@/lib/api/households";
import {
  type HouseholdSettingsData,
  householdSettingsQuery,
} from "@/lib/query/household-queries";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

export type HouseholdMutation =
  | "create"
  | "rename"
  | "invite"
  | "remove"
  | "revoke"
  | "leave"
  | "delete"
  | "accept"
  | "decline"
  | "add-equipment"
  | "remove-equipment"
  | "save-equipment-mode"
  | null;

type ActiveMutation = Exclude<HouseholdMutation, null>;

function excludeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

export function useHouseholdSettings(currentUserId: string) {
  const queryClient = useQueryClient();
  const settingsKey = recipeQueryKeys.householdSettings(currentUserId);
  const result = useQuery(householdSettingsQuery(currentUserId));
  const [mutation, setMutation] = useState<HouseholdMutation>(null);
  const mutationRef = useRef<HouseholdMutation>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(result.data?.household?.name ?? "");
  const [inviteEmail, setInviteEmail] = useState("");
  const [equipmentSlug, setEquipmentSlug] = useState("");
  const household = result.data?.household ?? null;
  const members = result.data?.members ?? [];
  const equipment = result.data?.equipment ?? null;
  const invitations = result.data?.invitations ?? [];
  const incoming = result.data?.incoming ?? [];
  const error =
    actionError ??
    result.data?.detailError ??
    (result.isError && result.data
      ? errorMessage(result.error, "Couldn't refresh your household.")
      : null);

  useEffect(() => {
    setName(household?.name ?? "");
  }, [household?.name]);

  function updateData(
    updater: (data: HouseholdSettingsData) => HouseholdSettingsData,
  ) {
    queryClient.setQueryData<HouseholdSettingsData>(settingsKey, (current) =>
      current ? updater(current) : current,
    );
  }

  async function refreshData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: settingsKey, exact: true }),
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.pantry(currentUserId),
        exact: true,
      }),
      queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.equipmentReadiness(currentUserId),
        exact: true,
      }),
    ]);
  }

  function run(kind: ActiveMutation, action: () => Promise<void>) {
    if (mutationRef.current) return;
    mutationRef.current = kind;
    setMutation(kind);
    setActionError(null);
    setNotice(null);
    action()
      .catch((actionError) => {
        setActionError(
          errorMessage(actionError, "Something went wrong. Please try again."),
        );
      })
      .finally(() => {
        mutationRef.current = null;
        setMutation(null);
      });
  }

  function onCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      setActionError("Give your household a name first.");
      return;
    }
    run("create", async () => {
      await createHousehold(nextName);
      setNotice("Household created.");
      await refreshData();
    });
  }

  function onRename(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!household) return;
    const nextName = name.trim();
    if (!nextName) {
      setActionError("Household name can't be empty.");
      return;
    }
    if (nextName === household.name) return;
    run("rename", async () => {
      const updated = await renameHousehold(household.id, nextName);
      updateData((current) => ({
        ...current,
        household: current.household
          ? { ...current.household, ...updated }
          : current.household,
      }));
      setName(updated.name);
      setNotice("Household name saved.");
    });
  }

  function onInvite(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!household) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    run("invite", async () => {
      const invitation = await inviteHouseholdMember(household.id, email);
      updateData((current) => ({
        ...current,
        invitations: [...current.invitations, invitation],
      }));
      setInviteEmail("");
      setNotice(`Invitation created for ${invitation.email}.`);
    });
  }

  function acceptInvitation(invitation: IncomingHouseholdInvitation) {
    run("accept", async () => {
      await acceptHouseholdInvitation(invitation.id);
      setNotice(`Welcome to ${invitation.household.name}.`);
      await refreshData();
    });
  }

  function declineInvitation(invitation: IncomingHouseholdInvitation) {
    run("decline", async () => {
      await declineHouseholdInvitation(invitation.id);
      updateData((current) => ({
        ...current,
        incoming: excludeById(current.incoming, invitation.id),
      }));
      setNotice("Invitation declined.");
    });
  }

  function removeMember(member: HouseholdMember) {
    if (!household) return;
    if (!window.confirm(`Remove ${member.user.name} from ${household.name}?`)) {
      return;
    }
    run("remove", async () => {
      await removeHouseholdMember(household.id, member.id);
      updateData((current) => ({
        ...current,
        members: excludeById(current.members, member.id),
      }));
      setNotice(`${member.user.name} was removed.`);
    });
  }

  function revokeInvitation(invitation: HouseholdInvitation) {
    if (!household) return;
    run("revoke", async () => {
      await revokeHouseholdInvitation(household.id, invitation.id);
      updateData((current) => ({
        ...current,
        invitations: excludeById(current.invitations, invitation.id),
      }));
      setNotice(`Invitation for ${invitation.email} revoked.`);
    });
  }

  const onAddEquipment: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!household || !equipmentSlug) return;
    run("add-equipment", async () => {
      const added = await addHouseholdEquipment(household.id, equipmentSlug);
      updateData((current) => ({
        ...current,
        equipment: current.equipment
          ? {
              ...current.equipment,
              owned: [
                ...current.equipment.owned.filter(
                  (item) => item.slug !== added.slug,
                ),
                added,
              ].sort((left, right) => left.name.localeCompare(right.name)),
            }
          : current.equipment,
      }));
      setEquipmentSlug("");
      await queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.equipmentReadiness(currentUserId),
        exact: true,
      });
      setNotice(`${added.name} added to the household.`);
    });
  };

  function onRemoveEquipment(item: HouseholdEquipmentItem) {
    if (!household) return;
    run("remove-equipment", async () => {
      await removeHouseholdEquipment(household.id, item.slug);
      updateData((current) => ({
        ...current,
        equipment: current.equipment
          ? {
              ...current.equipment,
              owned: current.equipment.owned.filter(
                (ownedItem) => ownedItem.slug !== item.slug,
              ),
            }
          : current.equipment,
      }));
      await queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.equipmentReadiness(currentUserId),
        exact: true,
      });
      setNotice(`${item.name} removed from the household.`);
    });
  }

  function onEquipmentMatchModeChange(mode: EquipmentRecipeMatchMode) {
    if (!household || !equipment || equipment.recipeMatchMode === mode) return;
    run("save-equipment-mode", async () => {
      const updated = await saveHouseholdEquipmentMatchMode(household.id, mode);
      updateData((current) => ({
        ...current,
        equipment: current.equipment
          ? { ...current.equipment, recipeMatchMode: updated.recipeMatchMode }
          : current.equipment,
      }));
      await queryClient.invalidateQueries({
        queryKey: recipeQueryKeys.equipmentReadiness(currentUserId),
        exact: true,
      });
      setNotice("Equipment matching preference saved.");
    });
  }

  function deleteCurrentHousehold() {
    if (!household) return;
    if (!window.confirm(`Delete ${household.name}? This can't be undone.`)) {
      return;
    }
    run("delete", async () => {
      await deleteHousehold(household.id);
      updateData((current) => ({
        ...current,
        household: null,
        equipment: null,
        members: [],
        invitations: [],
      }));
      setName("");
      setNotice("Household deleted.");
      await refreshData();
    });
  }

  function leaveCurrentHousehold() {
    if (!household) return;
    if (!window.confirm(`Leave ${household.name}?`)) return;
    run("leave", async () => {
      await leaveHousehold(household.id);
      updateData((current) => ({
        ...current,
        household: null,
        equipment: null,
        members: [],
        invitations: [],
      }));
      setName("");
      setNotice("You've left the household.");
      await refreshData();
    });
  }

  return {
    acceptInvitation,
    busy: mutation !== null,
    declineInvitation,
    deleteCurrentHousehold,
    equipment,
    equipmentSlug,
    error,
    household,
    incoming,
    invitations,
    inviteEmail,
    leaveCurrentHousehold,
    members,
    mutation,
    name,
    notice,
    onAddEquipment,
    onCreate,
    onEquipmentMatchModeChange,
    onInvite,
    onRemoveEquipment,
    onRename,
    removeMember,
    result,
    revokeInvitation,
    setEquipmentSlug,
    setInviteEmail,
    setName,
  };
}

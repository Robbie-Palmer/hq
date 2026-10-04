"use client";

import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { authClient } from "@/lib/auth-client";
import {
  type EffectiveEquipmentReadiness,
  type EquipmentMatch,
  type EquipmentRecipe,
  fallbackEquipmentReadiness,
  matchRecipeToEquipment,
} from "@/lib/domain/equipment-readiness";
import { equipmentReadinessQuery } from "@/lib/query/household-queries";

type EquipmentReadinessContextValue = {
  equipment: EffectiveEquipmentReadiness;
  error: boolean;
  loading: boolean;
  matchRecipe: (recipe: EquipmentRecipe) => EquipmentMatch;
};

const fallbackContext: EquipmentReadinessContextValue = {
  equipment: fallbackEquipmentReadiness,
  error: false,
  loading: false,
  matchRecipe: (recipe) =>
    matchRecipeToEquipment(recipe, fallbackEquipmentReadiness),
};
const EquipmentReadinessContext =
  createContext<EquipmentReadinessContextValue>(fallbackContext);

export function EquipmentReadinessProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user.id;
  const result = useQuery({
    ...equipmentReadinessQuery(userId ?? "pending"),
    enabled: !isPending && Boolean(userId),
  });
  const equipment = useMemo<EffectiveEquipmentReadiness>(() => {
    if (!result.data?.household || !result.data.equipment) {
      return fallbackEquipmentReadiness;
    }
    const mode = result.data.equipment.recipeMatchMode ?? "warn";
    return {
      active: mode !== "disabled",
      householdId: result.data.household.id,
      householdName: result.data.household.name,
      mode,
      ownedSlugs: new Set(result.data.equipment.owned.map((item) => item.slug)),
      equipmentNames: new Map(
        result.data.equipment.catalog.map((item) => [item.slug, item.name]),
      ),
    };
  }, [result.data]);
  const matchRecipe = useCallback(
    (recipe: EquipmentRecipe) => matchRecipeToEquipment(recipe, equipment),
    [equipment],
  );
  const value = useMemo<EquipmentReadinessContextValue>(
    () => ({
      equipment,
      error: Boolean(userId && result.isError),
      loading: isPending || Boolean(userId && result.isPending),
      matchRecipe,
    }),
    [
      equipment,
      isPending,
      matchRecipe,
      result.isError,
      result.isPending,
      userId,
    ],
  );

  return (
    <EquipmentReadinessContext.Provider value={value}>
      {children}
    </EquipmentReadinessContext.Provider>
  );
}

export function useEquipmentReadiness() {
  return useContext(EquipmentReadinessContext);
}

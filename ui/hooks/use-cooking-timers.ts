"use client";

import { useDispatch, useSelector } from "react-redux";
import { useRecipeClientState } from "@/components/recipes/recipe-client-state-provider";
import {
  type CookingTimer,
  selectCookingTimerById,
  selectCookingTimers,
} from "@/lib/cooking/cookingTimersSlice";
import type {
  RecipeClientDispatch,
  RecipeClientState,
} from "@/lib/cooking/recipeClientStore";

export const useRecipeDispatch = useDispatch.withTypes<RecipeClientDispatch>();
export const useRecipeSelector = useSelector.withTypes<RecipeClientState>();

export function useCookingTimerCommands() {
  return useRecipeClientState().commands;
}

/**
 * All cooking timers, shared across the Recipe Site. Re-renders every second while any
 * timer is running (the store rebuilds the snapshot on each tick).
 */
export function useCookingTimers(): readonly CookingTimer[] {
  return useRecipeSelector(selectCookingTimers);
}

/**
 * A single timer by id. Subscribes with a per-id selector so a component only
 * re-renders when *its* timer changes — the store keeps a stable object
 * identity for timers whose remaining second didn't change on a tick, so idle
 * pills don't re-render four times a second alongside the one counting down.
 */
export function useCookingTimer(id: string): CookingTimer | undefined {
  return useRecipeSelector((state) => selectCookingTimerById(state, id));
}

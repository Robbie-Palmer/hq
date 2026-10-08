"use client";

// Internal implementation. Application code imports the public hook facade;
// tests use this module only through tests/support/recipe-state.

import { useSyncExternalStore } from "react";
import {
  getUnitDimension,
  type MeasurementSystem,
  preferenceForSystem,
  type UnitPreference,
} from "@/lib/domain/recipe/unit";

export const UNIT_PREFERENCE_STORAGE_KEY = "recipe-unit-preference";
const VALID_SYSTEMS = new Set<string>(["metric", "us", "uk"]);
const DEFAULT_PREFERENCE = preferenceForSystem("uk");
const serverSnapshot = DEFAULT_PREFERENCE;
let cachedRaw: string | null | undefined;
let cachedPreference = DEFAULT_PREFERENCE;

function isPreference(value: unknown): value is UnitPreference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UnitPreference>;
  if (
    !candidate.preset ||
    !["metric", "us", "uk", "custom"].includes(candidate.preset)
  )
    return false;
  if (!candidate.weight?.length || !candidate.volume?.length) return false;
  return (["weight", "volume"] as const).every((dimension) => {
    const tiers = candidate[dimension];
    return tiers?.every(
      (tier, index) =>
        typeof tier?.unit === "string" &&
        getUnitDimension(tier.unit) === dimension &&
        (index === tiers.length - 1 ||
          (typeof tier.upTo === "number" && Number.isFinite(tier.upTo))),
    );
  });
}

export function parseUnitPreference(value: string | null): UnitPreference {
  if (!value) return DEFAULT_PREFERENCE;
  if (VALID_SYSTEMS.has(value)) {
    return preferenceForSystem(value as MeasurementSystem);
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (isPreference(parsed)) {
      return {
        ...parsed,
        weight: parsed.weight.map((tier, index) => ({
          ...tier,
          upTo: index === parsed.weight.length - 1 ? Infinity : tier.upTo,
        })),
        volume: parsed.volume.map((tier, index) => ({
          ...tier,
          upTo: index === parsed.volume.length - 1 ? Infinity : tier.upTo,
        })),
      };
    }
  } catch {
    // Fall back to the UK default when old or corrupt values are encountered.
  }
  return DEFAULT_PREFERENCE;
}

function readStored(): UnitPreference {
  try {
    const raw = localStorage.getItem(UNIT_PREFERENCE_STORAGE_KEY);
    if (raw === cachedRaw) return cachedPreference;
    cachedRaw = raw;
    cachedPreference = parseUnitPreference(raw);
    return cachedPreference;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function setPreference(next: UnitPreference): void {
  try {
    const raw = JSON.stringify(next);
    localStorage.setItem(UNIT_PREFERENCE_STORAGE_KEY, raw);
    cachedRaw = raw;
    cachedPreference = next;
  } catch {
    // Ignore write failures when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

export function useUnitPreference(): [
  UnitPreference,
  (preference: UnitPreference) => void,
] {
  const preference = useSyncExternalStore(
    subscribe,
    readStored,
    () => serverSnapshot,
  );
  return [preference, setPreference];
}

// Test-only reset point; intentionally not used by application code.
export function resetUnitPreferenceServerSnapshot(): void {
  cachedRaw = undefined;
  cachedPreference = DEFAULT_PREFERENCE;
}

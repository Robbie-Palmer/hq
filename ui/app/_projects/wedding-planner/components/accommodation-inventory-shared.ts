import type {
  AccommodationInventory,
  StayRequirements,
  WeddingPlanDraft,
} from "@/app/_projects/wedding-planner/application/types";

export type AccommodationUpdate = (
  change: (draft: WeddingPlanDraft) => void,
) => void;

export const emptyInventory = (): AccommodationInventory => ({
  properties: [],
  rooms: [],
  assignments: [],
  self_arranged_stays: [],
  household_requirements: {},
});

export const emptyStayRequirements = (): StayRequirements => ({
  arrives_on: null,
  departs_on: null,
  must_share_with: [],
  must_not_share_with: [],
  accessibility_needs: [],
  transport_needs: [],
  needs_child_space: false,
  custom_needs: [],
});

export function inventoryOf(draft: WeddingPlanDraft): AccommodationInventory {
  draft.inventory ??= emptyInventory();
  return draft.inventory;
}

export function newAccommodationId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function parseStringList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseAttributeMap(value: string): Record<string, string> {
  return Object.fromEntries(
    parseStringList(value).flatMap((item) => {
      const separator = item.indexOf("=");
      if (separator < 1) return [];
      return [
        [item.slice(0, separator).trim(), item.slice(separator + 1).trim()],
      ];
    }),
  );
}

export function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

import {
  accommodationPreferencesSchema,
  type AccommodationPreferences,
} from "./accommodation/preferences";
import { setTablePairDecision } from "./commands";
import { partnerId } from "./core/guests";
import type { WeddingPlan } from "./plan";
import { tableInput } from "./projections";
import { tablePairDecision } from "./seating/preferences";

export type SeatingSuggestion = {
  guest_ids: [string, string];
  sources: ("room" | "cottage")[];
};

function sharingSuggestion(
  firstId: string,
  secondId: string,
  first: AccommodationPreferences,
  second: AccommodationPreferences,
  level: "room" | "cottage",
): boolean {
  return (
    first[`can_share_${level}`] &&
    second[`can_share_${level}`] &&
    first[`${level}_share_mode`] !== "none" &&
    second[`${level}_share_mode`] !== "none" &&
    !first[`avoid_${level}_with`].includes(secondId) &&
    !second[`avoid_${level}_with`].includes(firstId) &&
    (first[`may_share_${level}_with`].includes(secondId) ||
      second[`may_share_${level}_with`].includes(firstId))
  );
}

export function accommodationSeatingSuggestions(
  plan: WeddingPlan,
): SeatingSuggestion[] {
  const guests = tableInput(plan).guests.map((guest) => ({
    ...guest,
    accommodation: accommodationPreferencesSchema.parse(
      plan.accommodation.guests[guest.id] ?? {},
    ),
  }));
  const suggestions: SeatingSuggestion[] = [];
  for (const [index, first] of guests.entries()) {
    for (const second of guests.slice(index + 1)) {
      if (
        partnerId(plan.couples, first.id) === second.id ||
        tablePairDecision(first, second) !== "unset" ||
        plan.seating.dismissed_accommodation_suggestions.some(
          (pair) => pair.includes(first.id) && pair.includes(second.id),
        )
      )
        continue;
      const sources = (["room", "cottage"] as const).filter((level) =>
        sharingSuggestion(
          first.id,
          second.id,
          first.accommodation,
          second.accommodation,
          level,
        ),
      );
      if (sources.length)
        suggestions.push({ guest_ids: [first.id, second.id], sources });
    }
  }
  return suggestions;
}

export function acceptAccommodationSeatingSuggestions(
  plan: WeddingPlan,
  pair?: [string, string],
): void {
  for (const suggestion of accommodationSeatingSuggestions(plan)) {
    if (pair && !suggestion.guest_ids.every((id) => pair.includes(id)))
      continue;
    setTablePairDecision(plan, ...suggestion.guest_ids, "yes");
  }
}

import { parseMoneyToMinorUnits } from "@/lib/generic/money";
import type { Property } from "./types";

export function propertyStayPrice(
  property: Property,
  nights: number,
): number | null {
  const nightly = parseMoneyToMinorUnits(
    property.rate_per_night_gbp,
    `${property.id} rate`,
  );
  const base =
    nightly === null
      ? parseMoneyToMinorUnits(
          property.booking_cost_gbp,
          `${property.id} booking cost`,
        )
      : nightly * nights;
  if (base === null) return null;
  const discount =
    property.booking_by === "couple"
      ? (property.couple_booking_discount_percent ?? 0)
      : 0;
  return Math.round((base * (100 - discount)) / 100);
}

export function incrementalCottagePrice(
  property: Property,
  nights: number,
): number | null {
  return property.already_booked ? 0 : propertyStayPrice(property, nights);
}

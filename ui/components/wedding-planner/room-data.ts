import { propertyStayPrice } from "wedding-planner-domain/accommodation";
import {
  formatMinorCurrency,
  parseMoneyToMinorUnits,
} from "@/lib/generic/money";
import {
  type AccommodationSetup,
  weddingAccommodationSetup,
} from "@/lib/wedding-planner/setup";
import type { BookingParty } from "@/lib/wedding-planner/values";

export function propertyName(
  id: string,
  setup: AccommodationSetup = weddingAccommodationSetup,
): string {
  return (
    setup.input.properties.find((property) => property.id === id)?.name ?? id
  );
}

export function roomName(
  id: string,
  setup: AccommodationSetup = weddingAccommodationSetup,
): string {
  return setup.input.rooms.find((room) => room.id === id)?.name ?? id;
}

export const propertyNames: Record<string, string> = Object.fromEntries(
  weddingAccommodationSetup.input.properties.map((property) => [
    property.id,
    property.name ?? property.id,
  ]),
);

export const venueRooms = weddingAccommodationSetup.input.rooms
  .filter(
    (room) =>
      room.rate_per_night_gbp !== undefined &&
      weddingAccommodationSetup.input.properties.find(
        (property) => property.id === room.property_id,
      )?.kind === "venue",
  )
  .map((room) => room.id);

export const includedRoomRateGroups = Object.values(
  weddingAccommodationSetup.input.rooms
    .filter((room) => venueRooms.includes(room.id))
    .reduce<Record<string, { label: string; count: number; price: number }>>(
      (groups, room) => {
        const price =
          parseMoneyToMinorUnits(room.rate_per_night_gbp, `${room.id} rate`) ??
          0;
        const label = room.rate_group ?? "rooms";
        const key = `${label}:${price}`;
        const group = groups[key] ?? { label, count: 0, price };
        group.count += 1;
        groups[key] = group;
        return groups;
      },
      {},
    ),
);

export const includedRoomRateTotal = formatMinorCurrency(
  includedRoomRateGroups.reduce(
    (total, group) => total + group.price * group.count,
    0,
  ),
);

export const includedPackageFigure =
  weddingAccommodationSetup.input.venue_suite_package_value_gbp === null
    ? null
    : formatMinorCurrency(
        parseMoneyToMinorUnits(
          weddingAccommodationSetup.input.venue_suite_package_value_gbp,
          "package room figure",
        ) ?? 0,
      );

export function propertyPrice(id: string, bookingBy: BookingParty): string {
  const property = weddingAccommodationSetup.input.properties.find(
    (item) => item.id === id,
  );
  if (!property) return "Price unknown";
  const price = propertyStayPrice(
    { ...property, booking_by: bookingBy },
    weddingAccommodationSetup.input.nights,
  );
  return price === null ? "Price unknown" : formatMinorCurrency(price);
}

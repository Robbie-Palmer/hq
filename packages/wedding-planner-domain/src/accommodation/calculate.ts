import { formatMinorCurrency, parseMoneyToMinorUnits } from "../money";
import { allocateBills, cashFlow } from "./billing";
import { incrementalCottagePrice, propertyStayPrice } from "./prices";
import type { AccommodationSetup } from "./setup";
import type { RoomAllocator, SolvePayload } from "./ports";
import { buildInput } from "./input";
import type {
  Allocation,
  Placement,
  PlannerInput,
  Property,
  State,
} from "./types";

function sumCottagePrices(
  properties: Property[],
  nights: number,
  price: (property: Property, nights: number) => number | null,
): number {
  return properties.reduce(
    (total, property) => total + (price(property, nights) ?? 0),
    0,
  );
}

function detailForCottage(
  input: PlannerInput,
  id: string,
): Allocation["cottage_details"][string] {
  const property = input.properties.find((item) => item.id === id)!;
  const price = propertyStayPrice(property, input.nights);
  const full = propertyStayPrice(
    { ...property, booking_by: "guests" },
    input.nights,
  );
  return {
    availability: property.already_booked
      ? "booked"
      : (property.availability ?? "unknown"),
    booking_by: property.booking_by ?? "guests",
    cost_gbp: price === null ? null : formatMinorCurrency(price),
    discount_gbp:
      price === null || full === null
        ? null
        : formatMinorCurrency(full - price),
  };
}

function fullResult(input: PlannerInput, placement: Placement): Allocation {
  const billing = allocateBills(input, placement);
  const flow = cashFlow(input, placement, billing);
  const bookedCottages = placement.booked_cottages.map(
    (id) => input.properties.find((property) => property.id === id)!,
  );
  const newCottages = bookedCottages.filter(
    (property) => !property.already_booked,
  );
  const newBookings = newCottages.map((property) => property.id);
  const coupleCottages = bookedCottages.filter(
    (property) => property.booking_by === "couple",
  );
  const newCost = sumCottagePrices(
    coupleCottages.filter((property) => !property.already_booked),
    input.nights,
    propertyStayPrice,
  );
  const coupleCost = sumCottagePrices(
    coupleCottages,
    input.nights,
    propertyStayPrice,
  );
  const outsideCost = placement.outside_parties.reduce((total, id) => {
    const party = input.parties.find((item) => item.id === id)!;
    return (
      total +
      (parseMoneyToMinorUnits(party.outside_cost_gbp, `${id} outside`) ?? 0)
    );
  }, 0);
  const knownCottageCost = sumCottagePrices(
    bookedCottages,
    input.nights,
    incrementalCottagePrice,
  );
  const unknownCosts = [
    ...newCottages
      .filter((property) => propertyStayPrice(property, input.nights) === null)
      .map((property) => ({ kind: "cottage" as const, id: property.id })),
    ...placement.outside_parties
      .filter(
        (id) =>
          input.parties.find((item) => item.id === id)?.outside_cost_gbp ===
          null,
      )
      .map((id) => ({ kind: "outside" as const, id })),
  ];
  return {
    status: placement.status,
    rooms: placement.rooms,
    single_bed_assignments: placement.single_bed_assignments,
    outside_parties: placement.outside_parties,
    new_cottage_bookings: newBookings,
    tentative_cottage_bookings: newCottages
      .filter((property) => property.availability === "unknown")
      .map((property) => property.id),
    cottage_details: Object.fromEntries(
      placement.booked_cottages.map((id) => [id, detailForCottage(input, id)]),
    ),
    couple_booking_outlay_gbp: formatMinorCurrency(coupleCost),
    new_couple_booking_cost_gbp: formatMinorCurrency(newCost),
    known_cottage_cost_gbp: formatMinorCurrency(knownCottageCost),
    known_outside_cost_gbp: formatMinorCurrency(outsideCost),
    venue_suite_package_value_gbp:
      input.venue_suite_package_value_gbp === null
        ? null
        : formatMinorCurrency(
            parseMoneyToMinorUnits(
              input.venue_suite_package_value_gbp,
              "suite reference",
            ) ?? 0,
          ),
    unknown_costs: unknownCosts,
    billing,
    cash_flow: flow,
  };
}

function formatReport(
  input: PlannerInput,
  placement: Placement,
  result: Allocation,
): string {
  const parties = new Map(input.parties.map((party) => [party.id, party]));
  const lines = [`Room plan: ${placement.status}`];
  for (const room of input.rooms) {
    const names = (placement.rooms[room.id] ?? [])
      .flatMap((id) => parties.get(id)?.guests ?? [])
      .join(", ");
    lines.push(`${room.name ?? room.id}: ${names || "empty"}`);
  }
  lines.push(
    `Outside accommodation: ${placement.outside_parties.flatMap((id) => parties.get(id)?.guests ?? []).join(", ") || "none"}`,
    "",
    `Cottage bills still due from us: ${formatMinorCurrency(result.cash_flow.still_to_pay_pence)}`,
  );
  for (const [id, detail] of Object.entries(result.cash_flow.by_property)) {
    lines.push(
      `  ${id}: ${formatMinorCurrency(detail.still_to_pay_pence)} due, ${formatMinorCurrency(detail.guest_reimbursements_pence)} expected back from guests`,
    );
  }
  lines.push(
    `Already paid by us: ${formatMinorCurrency(result.cash_flow.already_paid_pence)}`,
    `Expected guest reimbursements: ${formatMinorCurrency(result.cash_flow.cottage_guest_reimbursements_pence)}`,
    `Our final cost beyond the package: ${formatMinorCurrency(result.cash_flow.our_final_cost_pence)}`,
    `Guests expected to pay: ${formatMinorCurrency(result.cash_flow.guest_expected_total_pence)}`,
  );
  for (const property of input.properties.filter(
    (item) => item.kind === "venue",
  )) {
    lines.push(
      `${property.name ?? property.id}: included in the wedding package; no extra bill`,
    );
  }
  return lines.join("\n");
}

export async function calculateRooms(
  state: State,
  setup: AccommodationSetup,
  allocator: RoomAllocator,
): Promise<SolvePayload> {
  const { input, warnings } = buildInput(state, setup);
  const placement = await allocator.solve(input);
  const result = fullResult(input, placement);
  return {
    report: formatReport(input, placement, result),
    warnings,
    result,
    parties: input.parties.map((party) => ({
      id: party.id,
      guests: party.guests,
      free_guest_indexes: party.free_guest_indexes,
    })),
  };
}

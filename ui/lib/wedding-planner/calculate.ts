import { allocateBills, cashFlow } from "./billing";
import { incrementalCottagePrice, propertyStayPrice } from "./prices";
import { type AccommodationSetup, weddingAccommodationSetup } from "./setup";
import { solveRooms } from "./solve-rooms";
import type { SolvePayload } from "./source";
import { buildInput, moneyPence, pounds } from "./state";
import type { Allocation, Placement, PlannerInput, State } from "./types";

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
    cost_gbp: price === null ? null : pounds(price),
    discount_gbp: price === null || full === null ? null : pounds(full - price),
  };
}

function fullResult(input: PlannerInput, placement: Placement): Allocation {
  const billing = allocateBills(input, placement);
  const flow = cashFlow(input, placement, billing);
  const newBookings = placement.booked_cottages.filter(
    (id) => !input.properties.find((item) => item.id === id)?.already_booked,
  );
  const newCost = newBookings.reduce((total, id) => {
    const property = input.properties.find((item) => item.id === id)!;
    return (
      total +
      (property.booking_by === "couple"
        ? (propertyStayPrice(property, input.nights) ?? 0)
        : 0)
    );
  }, 0);
  const coupleCost = placement.booked_cottages.reduce((total, id) => {
    const property = input.properties.find((item) => item.id === id)!;
    return (
      total +
      (property.booking_by === "couple"
        ? (propertyStayPrice(property, input.nights) ?? 0)
        : 0)
    );
  }, 0);
  const outsideCost = placement.outside_parties.reduce((total, id) => {
    const party = input.parties.find((item) => item.id === id)!;
    return total + (moneyPence(party.outside_cost_gbp, `${id} outside`) ?? 0);
  }, 0);
  const knownCottageCost = placement.booked_cottages.reduce((total, id) => {
    const property = input.properties.find((item) => item.id === id)!;
    return total + (incrementalCottagePrice(property, input.nights) ?? 0);
  }, 0);
  const unknownCosts = [
    ...newBookings
      .filter(
        (id) =>
          propertyStayPrice(
            input.properties.find((item) => item.id === id)!,
            input.nights,
          ) === null,
      )
      .map((id) => `${id} cottage booking`),
    ...placement.outside_parties
      .filter(
        (id) =>
          input.parties.find((item) => item.id === id)?.outside_cost_gbp ===
          null,
      )
      .map((id) => `${id} outside stay`),
  ];
  return {
    status: placement.status,
    rooms: placement.rooms,
    single_bed_assignments: placement.single_bed_assignments,
    outside_parties: placement.outside_parties,
    new_cottage_bookings: newBookings,
    tentative_cottage_bookings: newBookings.filter(
      (id) =>
        input.properties.find((item) => item.id === id)?.availability ===
        "unknown",
    ),
    cottage_details: Object.fromEntries(
      placement.booked_cottages.map((id) => [id, detailForCottage(input, id)]),
    ),
    couple_booking_outlay_gbp: pounds(coupleCost),
    new_couple_booking_cost_gbp: pounds(newCost),
    known_cottage_cost_gbp: pounds(knownCottageCost),
    known_outside_cost_gbp: pounds(outsideCost),
    venue_suite_package_value_gbp:
      input.venue_suite_package_value_gbp === null
        ? null
        : pounds(
            moneyPence(
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
  );
  lines.push("");
  lines.push(
    `Cottage bills still due from us: ${pounds(result.cash_flow.still_to_pay_pence)}`,
  );
  for (const [id, detail] of Object.entries(result.cash_flow.by_property)) {
    lines.push(
      `  ${id}: ${pounds(detail.still_to_pay_pence)} due, ${pounds(detail.guest_reimbursements_pence)} expected back from guests`,
    );
  }
  lines.push(
    `Already paid by us: ${pounds(result.cash_flow.already_paid_pence)}`,
  );
  lines.push(
    `Expected guest reimbursements: ${pounds(result.cash_flow.cottage_guest_reimbursements_pence)}`,
  );
  lines.push(
    `Our final cost beyond the package: ${pounds(result.cash_flow.our_final_cost_pence)}`,
  );
  lines.push(
    `Guests expected to pay: ${pounds(result.cash_flow.guest_expected_total_pence)}`,
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
  setup: AccommodationSetup = weddingAccommodationSetup,
): Promise<SolvePayload> {
  const { input, warnings } = buildInput(state, setup);
  const placement = await solveRooms(input);
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

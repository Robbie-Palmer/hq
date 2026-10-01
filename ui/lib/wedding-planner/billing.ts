import { propertyStayPrice } from "./prices";
import { moneyPence } from "./state";
import type {
  Allocation,
  Placement,
  PlannerInput,
  Property,
  Room,
} from "./types";

function split(amount: number, count: number): number[] {
  if (count < 1) return [];
  const whole = Math.floor(amount / count);
  const remainder = amount % count;
  return Array.from(
    { length: count },
    (_, index) => whole + Number(index < remainder),
  );
}

function addAmount(
  target: Map<string, number>,
  id: string,
  amount: number,
): void {
  target.set(id, (target.get(id) ?? 0) + amount);
}

function recordCharge(
  charges: Map<string, number>,
  charged: Map<string, Set<string>>,
  property: string,
  party: string,
  amount: number,
): void {
  addAmount(charges, party, amount);
  const parties = charged.get(property) ?? new Set<string>();
  parties.add(party);
  charged.set(property, parties);
}

function venueUnits(room: Room, placement: Placement): string[][] {
  const occupants = placement.rooms[room.id] ?? [];
  const shared = placement.shared_beds.filter((bed) => bed.room_id === room.id);
  const paired = new Set(shared.flatMap((bed) => bed.parties));
  return [
    ...shared.map((bed) => [...bed.parties]),
    ...occupants.filter((id) => !paired.has(id)).map((id) => [id]),
  ];
}

function chargeUnit(
  charges: Map<string, number>,
  charged: Map<string, Set<string>>,
  property: string,
  unit: string[],
  share: number,
): void {
  const portions = split(share, unit.length);
  for (const [index, id] of unit.entries())
    recordCharge(charges, charged, property, id, portions[index] ?? 0);
}

function venueCharges(input: PlannerInput, placement: Placement) {
  const charges = new Map<string, number>();
  const quoted = new Map<string, number>();
  const chargedParties = new Map<string, Set<string>>();
  const properties = new Map(
    input.properties.map((property) => [property.id, property]),
  );
  for (const room of input.rooms) {
    const property = properties.get(room.property_id)!;
    if (property.kind !== "venue") continue;
    const nightly = moneyPence(room.rate_per_night_gbp, `${room.id} rate`);
    if (nightly === null) continue;
    const price = nightly * input.nights;
    addAmount(quoted, property.id, price);
    if (room.billing_mode === "couple" || !property.charge_guests) continue;
    const units = venueUnits(room, placement);
    const prices = split(
      price,
      room.billing_mode === "full_room" ? units.length : room.double_beds,
    );
    for (const [index, unit] of units.entries()) {
      chargeUnit(
        charges,
        chargedParties,
        property.id,
        unit,
        prices[index] ?? 0,
      );
    }
  }
  return { charges, quoted, chargedParties };
}

function cottageCharges(input: PlannerInput, placement: Placement) {
  const charges = new Map<string, number>();
  const quoted = new Map<string, number>();
  const chargedParties = new Map<string, Set<string>>();
  for (const property of input.properties.filter((item) =>
    placement.booked_cottages.includes(item.id),
  )) {
    const price = propertyStayPrice(property, input.nights);
    if (price === null) continue;
    quoted.set(property.id, price);
    if (!property.charge_guests) continue;
    const occupied = input.rooms.filter(
      (room) =>
        room.property_id === property.id &&
        (placement.rooms[room.id] ?? []).length,
    );
    for (const [roomIndex, room] of occupied.entries()) {
      const occupants = placement.rooms[room.id] ?? [];
      const roomShare = split(price, occupied.length)[roomIndex]!;
      for (const [index, partyId] of occupants.entries()) {
        recordCharge(
          charges,
          chargedParties,
          property.id,
          partyId,
          split(roomShare, occupants.length)[index]!,
        );
      }
    }
  }
  return { charges, quoted, chargedParties };
}

type Billing = Allocation["billing"] & {
  venue_guest_pence: number;
  cottage_guest_pence: number;
  cottage_quoted_pence: number;
};

export function allocateBills(
  input: PlannerInput,
  placement: Placement,
): Billing {
  const venue = venueCharges(input, placement);
  const cottage = cottageCharges(input, placement);
  const quoted = new Map([...venue.quoted, ...cottage.quoted]);
  const parties = new Map(input.parties.map((party) => [party.id, party]));
  const guestByParty: Record<string, number> = {};
  const memberByParty: Record<string, number[]> = {};
  const cap = moneyPence(input.guest_charge_cap_gbp, "Guest charge cap");
  const chargedIds = new Set([
    ...venue.charges.keys(),
    ...cottage.charges.keys(),
  ]);
  for (const id of chargedIds) {
    const party = parties.get(id)!;
    const share = (venue.charges.get(id) ?? 0) + (cottage.charges.get(id) ?? 0);
    const quotedByMember = split(share, party.guests.length);
    const freeIndexes = new Set(party.free_guest_indexes);
    const payingIndexes = quotedByMember.flatMap((_, index) =>
      freeIndexes.has(index) ? [] : [index],
    );
    const chargeable = payingIndexes.reduce(
      (sum, index) => sum + quotedByMember[index]!,
      0,
    );
    const finalCharge =
      cap !== null && !party.charge_cap_exempt
        ? Math.min(chargeable, cap)
        : chargeable;
    const amounts = new Array<number>(party.guests.length).fill(0);
    for (const [index, amount] of split(
      finalCharge,
      payingIndexes.length,
    ).entries()) {
      amounts[payingIndexes[index]!] = amount;
    }
    memberByParty[id] = amounts;
    if (finalCharge) guestByParty[id] = finalCharge;
  }
  const guestByProperty = Object.fromEntries(
    input.properties.map((property) => {
      const ids = new Set([
        ...(venue.chargedParties.get(property.id) ?? []),
        ...(cottage.chargedParties.get(property.id) ?? []),
      ]);
      return [
        property.id,
        [...ids].reduce((sum, id) => sum + (guestByParty[id] ?? 0), 0),
      ];
    }),
  );
  const venueProperties = input.properties.filter(
    (property) => property.kind === "venue",
  );
  const venueQuoted = venueProperties.reduce(
    (total, property) => total + (venue.quoted.get(property.id) ?? 0),
    0,
  );
  const venueGuest = venueProperties.reduce(
    (total, property) => total + (guestByProperty[property.id] ?? 0),
    0,
  );
  const cottageQuoted = [...cottage.quoted.values()].reduce(
    (sum, amount) => sum + amount,
    0,
  );
  const cottageGuest = input.properties
    .filter((property) => property.kind === "cottage")
    .reduce((sum, property) => sum + (guestByProperty[property.id] ?? 0), 0);
  return {
    total_guest_pence: venueGuest + cottageGuest,
    venue_guest_pence: venueGuest,
    cottage_guest_pence: cottageGuest,
    cottage_quoted_pence: cottageQuoted,
    venue_unrecovered_pence: venueQuoted - venueGuest,
    cottage_subsidy_pence: cottageQuoted - cottageGuest,
    guest_pence_by_party: guestByParty,
    member_amounts_pence_by_party: memberByParty,
    by_property: Object.fromEntries(
      input.properties.map((property) => {
        const value = quoted.get(property.id) ?? 0;
        const guests = guestByProperty[property.id] ?? 0;
        return [
          property.id,
          {
            quoted_pence: value,
            guest_pence: guests,
            covered_pence: value - guests,
          },
        ];
      }),
    ),
  };
}

function outsideFlow(input: PlannerInput, placement: Placement) {
  const parties = new Map(input.parties.map((party) => [party.id, party]));
  let guest = 0;
  let covered = 0;
  const byParty: Allocation["cash_flow"]["outside_by_party"] = {};
  const members: Record<string, number[]> = {};
  for (const id of placement.outside_parties) {
    const party = parties.get(id)!;
    const estimate = moneyPence(party.outside_cost_gbp, `${id} outside`);
    if (estimate === null) continue;
    const amounts = split(estimate, party.guests.length).map((amount, index) =>
      party.free_guest_indexes.includes(index) ? 0 : amount,
    );
    const guestShare = amounts.reduce((sum, amount) => sum + amount, 0);
    const coveredShare = estimate - guestShare;
    members[id] = amounts;
    byParty[id] = {
      estimate_pence: estimate,
      guest_pence: guestShare,
      covered_pence: coveredShare,
    };
    guest += guestShare;
    covered += coveredShare;
  }
  return { guest, covered, byParty, members };
}

function cottageShares(
  property: Property,
  rent: number,
  paid: number,
  guestShare: number,
) {
  const ourShare = rent - guestShare;
  if (property.booking_by === "couple") {
    return {
      ourShare,
      remaining: rent - paid,
      reimbursement: guestShare,
      guestDirect: 0,
    };
  }
  const reimbursement = Math.max(0, paid - ourShare);
  return {
    ourShare,
    remaining: Math.max(0, ourShare - paid),
    reimbursement,
    guestDirect: guestShare - reimbursement,
  };
}

export function cashFlow(
  input: PlannerInput,
  placement: Placement,
  billing: Billing,
): Allocation["cash_flow"] {
  let alreadyPaid = 0;
  let stillToPay = 0;
  let reimbursements = 0;
  let guestDirect = 0;
  let paidWithoutRoom = 0;
  const byProperty: Allocation["cash_flow"]["by_property"] = {};
  for (const property of input.properties.filter(
    (item) => item.kind === "cottage",
  )) {
    const paid =
      moneyPence(property.paid_by_us_gbp ?? 0, `${property.id} paid`) ?? 0;
    alreadyPaid += paid;
    if (!placement.booked_cottages.includes(property.id)) {
      paidWithoutRoom += paid;
      continue;
    }
    const rent = propertyStayPrice(property, input.nights);
    if (rent === null) continue;
    if (paid > rent)
      throw new Error(`${property.id}: already paid exceeds the cottage rent`);
    const guestShare = billing.by_property[property.id]?.guest_pence ?? 0;
    const {
      ourShare,
      remaining,
      reimbursement,
      guestDirect: direct,
    } = cottageShares(property, rent, paid, guestShare);
    guestDirect += direct;
    stillToPay += remaining;
    reimbursements += reimbursement;
    byProperty[property.id] = {
      rent_pence: rent,
      already_paid_pence: paid,
      still_to_pay_pence: remaining,
      guest_reimbursements_pence: reimbursement,
      our_final_cost_pence: ourShare,
    };
  }
  const outside = outsideFlow(input, placement);
  stillToPay += outside.covered;
  guestDirect += outside.guest;
  return {
    our_final_cost_pence: alreadyPaid + stillToPay - reimbursements,
    already_paid_pence: alreadyPaid,
    still_to_pay_pence: stillToPay,
    cottage_guest_reimbursements_pence: reimbursements,
    guest_direct_pence: guestDirect,
    venue_guest_contributions_pence: billing.venue_guest_pence,
    guest_expected_total_pence: billing.total_guest_pence + outside.guest,
    paid_without_room_pence: paidWithoutRoom,
    outside_we_cover_pence: outside.covered,
    outside_member_amounts_pence_by_party: outside.members,
    outside_by_party: outside.byParty,
    by_property: byProperty,
  };
}

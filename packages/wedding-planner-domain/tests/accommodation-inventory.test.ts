import { describe, expect, it } from "vitest";
import { parseWeddingPlan, type WeddingPlan } from "../src";
import {
  accommodationProviderManifest,
  auditAccommodationInventory,
  guestAccommodationItinerary,
} from "../src/accommodation";

function plan(): WeddingPlan {
  return parseWeddingPlan({
    version: 2,
    guests: [
      {
        id: "alex",
        name: "Alex",
        household_id: "household-a",
        accessibility_needs: ["step-free"],
      },
      { id: "blair", name: "Blair", household_id: "household-a" },
      { id: "casey", name: "Casey" },
    ],
    guest_directory: {
      households: [{ id: "household-a", name: "Alex and Blair" }],
    },
    hosts: ["Robin", "Sam"],
    accommodation: {
      guests: {
        alex: {
          overnight: "yes",
          stay: {
            arrives_on: "2027-06-04",
            departs_on: "2027-06-06",
            accessibility_needs: ["step-free"],
            must_share_with: ["blair"],
          },
        },
        blair: { overnight: "yes" },
        casey: { overnight: "yes" },
      },
      inventory: {
        properties: [
          {
            id: "hotel",
            name: "Town Hotel",
            kind: "room_block",
            address: "1 High Street",
            provider_name: "Town Hotel reservations",
            provider_contact: "groups@example.test",
            check_in_on: "2027-06-04",
            check_out_on: "2027-06-06",
            booking_deadline: "2027-04-01",
            accessibility: ["step-free"],
            cost: { basis: "nightly", amount_gbp: "125" },
            booking: {
              status: "booked",
              confirmation_reference: "GROUP-42",
              payer: { kind: "couple" },
              commitment_id: "commitment-hotel",
              payment_ids: ["payment-deposit"],
            },
          },
          {
            id: "house",
            name: "Family House",
            kind: "private_house",
            check_in_on: "2027-06-03",
            check_out_on: "2027-06-07",
          },
        ],
        rooms: [
          {
            id: "hotel-101",
            property_id: "hotel",
            name: "Room 101",
            capacity: 2,
            accessibility: ["step-free"],
            beds: [
              {
                id: "hotel-101-bed",
                name: "Double bed",
                kind: "double",
                capacity: 2,
              },
            ],
          },
          {
            id: "house-blue",
            property_id: "house",
            name: "Blue room",
            capacity: 1,
            beds: [
              {
                id: "house-blue-bed",
                name: "Single bed",
                kind: "single",
                capacity: 1,
              },
            ],
          },
        ],
        assignments: [
          {
            id: "hotel-household-a",
            subject: { kind: "household", id: "household-a" },
            room_id: "hotel-101",
            bed_ids: ["hotel-101-bed"],
            arrives_on: "2027-06-04",
            departs_on: "2027-06-06",
            locked: true,
          },
          {
            id: "casey-alternative",
            subject: { kind: "guest", id: "casey" },
            room_id: "house-blue",
            bed_ids: ["house-blue-bed"],
            arrives_on: "2027-06-04",
            departs_on: "2027-06-06",
            status: "alternative",
            alternative_to_assignment_id: "hotel-household-a",
          },
        ],
        self_arranged_stays: [
          {
            id: "casey-own-hotel",
            subject: { kind: "guest", id: "casey" },
            arrives_on: "2027-06-04",
            departs_on: "2027-06-06",
            provider_name: "Casey's hotel",
            address: "Elsewhere",
            confirmation_details: "Booked by Casey",
          },
        ],
      },
    },
    seating: { top_table_capacity: 4, table_capacities: [4] },
  });
}

describe("flexible accommodation inventory", () => {
  it("models mixed inventory, manual locks, alternatives, dates, and ledger links", () => {
    const wedding = plan();
    expect(
      wedding.accommodation.inventory.properties.map((item) => item.kind),
    ).toEqual(["room_block", "private_house"]);
    expect(wedding.accommodation.inventory.assignments[0]?.locked).toBe(true);
    expect(wedding.accommodation.inventory.assignments[1]).toMatchObject({
      status: "alternative",
      alternative_to_assignment_id: "hotel-household-a",
    });
    expect(
      wedding.accommodation.inventory.properties[0]?.booking,
    ).toMatchObject({
      commitment_id: "commitment-hotel",
      payment_ids: ["payment-deposit"],
    });
    expect(
      wedding.accommodation.inventory.properties[0]?.booking,
    ).not.toHaveProperty("amount_paid_gbp");
  });

  it("reports assignment gaps and unused inventory without counting alternatives", () => {
    const wedding = plan();
    wedding.accommodation.inventory.self_arranged_stays = [];
    const audit = auditAccommodationInventory(wedding);
    expect(audit.unassigned_guest_ids).toEqual(["casey"]);
    expect(audit.unused_room_ids).toEqual(["house-blue"]);
    expect(audit.unused_bed_ids).toEqual(["house-blue-bed"]);
    expect(audit.issues).toEqual([]);
  });

  it("reports room, bed, duplicate-stay, and accessibility conflicts", () => {
    const wedding = plan();
    wedding.accommodation.inventory.self_arranged_stays = [];
    wedding.accommodation.inventory.assignments.push({
      id: "casey-primary",
      subject: { kind: "guest", id: "casey" },
      room_id: "hotel-101",
      bed_ids: ["hotel-101-bed"],
      arrives_on: "2027-06-04",
      departs_on: "2027-06-06",
      status: "confirmed",
      alternative_to_assignment_id: null,
      locked: false,
      notes: "",
    });
    const casey = wedding.accommodation.guests.casey;
    expect(casey).toBeDefined();
    if (!casey) return;
    casey.stay = {
      arrives_on: "2027-06-04",
      departs_on: "2027-06-06",
      must_share_with: [],
      must_not_share_with: [],
      accessibility_needs: ["hearing-loop"],
      transport_needs: [],
      needs_child_space: false,
      custom_needs: [],
    };
    const audit = auditAccommodationInventory(wedding);
    expect(audit.issues.map((issue) => issue.kind)).toContain("capacity");
    expect(audit.issues.map((issue) => issue.kind)).toContain("unmet_need");
  });

  it("creates a provider manifest and a guest itinerary without finance or roommate data", () => {
    const wedding = plan();
    const manifest = accommodationProviderManifest(wedding, "hotel");
    expect(manifest.rooms[0]?.stays[0]).toMatchObject({
      names: ["Alex", "Blair"],
      accessibility_needs: ["step-free"],
    });
    const itinerary = guestAccommodationItinerary(wedding, "alex");
    expect(itinerary).toEqual({
      guest: "Alex",
      stay: {
        arranged_by: "planner",
        property: "Town Hotel",
        address: "1 High Street",
        room: "Room 101",
        arrives_on: "2027-06-04",
        departs_on: "2027-06-06",
        confirmation_reference: "GROUP-42",
      },
    });
    expect(JSON.stringify(itinerary)).not.toContain("Blair");
    expect(JSON.stringify(itinerary)).not.toContain("commitment-hotel");
    expect(JSON.stringify(itinerary)).not.toContain("payment-deposit");
  });

  it("rejects references outside the inventory and guest directory", () => {
    const wedding = plan();
    const assignment = wedding.accommodation.inventory.assignments[0];
    const property = wedding.accommodation.inventory.properties[0];
    expect(assignment).toBeDefined();
    expect(property).toBeDefined();
    if (!assignment || !property) return;
    assignment.bed_ids = ["wrong-bed"];
    expect(() => parseWeddingPlan(wedding)).toThrow("bed outside its room");
    assignment.bed_ids = ["hotel-101-bed"];
    property.booking.payer = {
      kind: "guest",
      id: "missing",
    };
    expect(() => parseWeddingPlan(wedding)).toThrow("unknown guest payer");
  });
});

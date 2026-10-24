import { describe, expect, it } from "vitest";
import { parseWeddingPlan, tableInput } from "../src";
import {
  prepareTableProblem,
  type SeatingGuest,
  type TableInput,
} from "../src/seating";

function input(): TableInput {
  return tableInput(
    parseWeddingPlan({
      version: 2,
      guests: ["a", "b", "c"].map((id) => ({
        id,
        name: id.toUpperCase(),
        attendance: "yes",
      })),
      hosts: ["Alex", "Sam"],
      accommodation: {},
      seating: { top_table_capacity: 4, table_capacities: [2, 2] },
    }),
  );
}

function guest(value: TableInput, id: string): SeatingGuest {
  const found = value.guests.find((item) => item.id === id);
  if (!found) throw new Error(`Missing test guest ${id}`);
  return found;
}

describe("seating problem preparation", () => {
  it("weights explicit constraints ahead of invitation-party preferences", () => {
    const value = input();
    guest(value, "a").seating_constraints = {
      prefer_with: ["b"],
      avoid_with: ["c"],
      requires_accessible_seat: false,
      notes: "",
    };
    guest(value, "b").invitation_party_id = "party";
    guest(value, "c").invitation_party_id = "party";

    expect(
      prepareTableProblem(value).pairs.map((pair) => ({
        ids: `${pair.first.id}:${pair.second.id}`,
        decision: pair.decision,
        reason: pair.reason,
        weight: pair.weight,
      })),
    ).toEqual([
      {
        ids: "a:b",
        decision: "yes",
        reason: "They were marked as a must-sit pair",
        weight: 4,
      },
      {
        ids: "a:c",
        decision: "no",
        reason: "They were marked as a cannot-sit pair",
        weight: 0,
      },
      {
        ids: "b:c",
        decision: "yes",
        reason: "They are in the same invitation party",
        weight: 2,
      },
    ]);
  });

  it("uses shared relationship groups as lower-weight preferences", () => {
    const value = input();
    guest(value, "a").relationship_groups = ["Family"];
    guest(value, "c").relationship_groups = ["Family"];

    expect(prepareTableProblem(value).pairs).toMatchObject([
      {
        first: { id: "a" },
        second: { id: "c" },
        decision: "yes",
        reason: "They share the Family relationship group",
        weight: 1,
      },
    ]);
  });

  it("combines hard party and relationship groups transitively", () => {
    const value = input();
    guest(value, "a").source_party = "party";
    guest(value, "b").source_party = "party";
    guest(value, "b").relationship_groups = ["Family"];
    guest(value, "c").relationship_groups = ["Family"];
    value.plan.keep_invitation_parties_together = true;
    value.plan.keep_relationship_groups_together = ["Family"];

    expect(
      prepareTableProblem(value).groups.map((group) =>
        group.map((item) => item.id),
      ),
    ).toEqual([["a", "b", "c"]]);
  });

  it.each<{
    name: string;
    change: (value: TableInput) => void;
    message: string;
  }>([
    {
      name: "duplicate guest IDs",
      change: (value) => {
        guest(value, "b").id = "a";
      },
      message: "Guest IDs must be unique",
    },
    {
      name: "unknown top-table guests",
      change: (value) => {
        value.plan.top_table_guest_ids = ["missing"];
      },
      message: "top table refers to an unknown guest",
    },
    {
      name: "unconfirmed top-table guests",
      change: (value) => {
        guest(value, "a").attendance = "unknown";
        value.plan.top_table_guest_ids = ["a"];
      },
      message: "Confirm A is attending",
    },
    {
      name: "invalid guest preferences",
      change: (value) => {
        guest(value, "a").prefer_table_with = ["a"];
      },
      message: "table preferences have an invalid guest",
    },
    {
      name: "locks for unknown guests",
      change: (value) => {
        value.plan.locked_assignments = {
          missing: { table_id: "table-1" },
        };
      },
      message: "Only attending guests can have locked seats",
    },
    {
      name: "locks for missing tables",
      change: (value) => {
        value.plan.locked_assignments = { a: { table_id: "table-9" } };
      },
      message: "locked table does not exist",
    },
    {
      name: "seat locks outside table capacity",
      change: (value) => {
        value.plan.locked_assignments = {
          a: { table_id: "table-1", seat_index: 2 },
        };
      },
      message: "locked seat is outside the table capacity",
    },
    {
      name: "whole-table locks for missing tables",
      change: (value) => {
        value.plan.locked_table_guest_ids = { "table-9": ["a"] };
      },
      message: "Locked table table-9 does not exist",
    },
    {
      name: "duplicate whole-table locks",
      change: (value) => {
        value.plan.locked_table_guest_ids = { "table-1": ["a", "a"] };
      },
      message: "contains a guest twice",
    },
    {
      name: "whole-table locks beyond capacity",
      change: (value) => {
        value.plan.locked_table_guest_ids = {
          "table-1": ["a", "b", "c"],
        };
      },
      message: "exceeds its capacity",
    },
    {
      name: "whole-table locks for absent guests",
      change: (value) => {
        guest(value, "a").attendance = "no";
        value.plan.locked_table_guest_ids = { "table-1": ["a"] };
      },
      message: "Only attending guests can be locked to a table",
    },
    {
      name: "conflicting individual and whole-table locks",
      change: (value) => {
        value.plan.locked_assignments = { a: { table_id: "table-1" } };
        value.plan.locked_table_guest_ids = { "table-2": ["a"] };
      },
      message: "locked to two different tables",
    },
    {
      name: "top-table locks beyond capacity",
      change: (value) => {
        value.plan.top_table_capacity = 2;
        value.plan.locked_table_guest_ids = { top: ["a"] };
      },
      message: "wedding party exceeds the top table capacity",
    },
    {
      name: "group members forced to different tables",
      change: (value) => {
        guest(value, "a").source_party = "party";
        guest(value, "b").source_party = "party";
        value.plan.keep_invitation_parties_together = true;
        value.plan.locked_assignments = {
          a: { table_id: "table-1" },
          b: { table_id: "table-2" },
        };
      },
      message: "grouped guests are locked to different tables",
    },
  ])("rejects $name", ({ change, message }) => {
    const value = input();
    change(value);
    expect(() => prepareTableProblem(value)).toThrow(message);
  });
});

import { parseWeddingPlan, type WeddingPlan } from "wedding-planner-domain";
import type { StoredWeddingPlan, WeddingPlanStore } from "wedding-planner-data";
import { describe, expect, it, vi } from "vitest";

import {
  createGuestAccessService,
  GuestAccessDeniedError,
  WeddingPlanUnavailableError,
} from "../src/guest-access";

const changedAt = "2026-11-07T12:00:00.000Z";

function plan(): WeddingPlan {
  return parseWeddingPlan({
    version: 2,
    guests: [
      {
        id: "alex",
        name: "Alex Smith",
        email: "alex@example.com",
        private_notes: ["Ask about speech"],
        custom_fields: { meal: "Vegetarian" },
      },
      { id: "sam", name: "Sam Smith" },
    ],
    guest_directory: {
      custom_fields: [
        {
          id: "meal",
          label: "Meal",
          type: "choice",
          choices: ["Vegetarian", "Chicken"],
          access: {
            view: ["couple", "guest", "export_recipient"],
            edit: ["couple", "guest"],
          },
        },
      ],
    },
    hosts: ["Robin", "Taylor"],
    accommodation: {},
    seating: { top_table_capacity: 2, table_capacities: [8] },
  });
}

function storedPlan(value = plan(), revision = 1): StoredWeddingPlan {
  const timestamp = new Date(changedAt);
  return {
    id: "plan-1",
    plan: value,
    revision,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function store(initial: StoredWeddingPlan | null = storedPlan()) {
  let current = initial;
  const load = vi.fn(async () => current);
  const update = vi.fn(
    async (_ownerId: string, expectedRevision: number, value: WeddingPlan) => {
      current = storedPlan(value, expectedRevision + 1);
      return current;
    },
  );
  return {
    current: () => current,
    plans: { load, update } as Pick<WeddingPlanStore, "load" | "update">,
    update,
  };
}

describe("Wedding API guest access", () => {
  it("evaluates persisted guest facts before returning fields", async () => {
    const fixture = store();
    const guests = createGuestAccessService(fixture.plans);

    const own = await guests.readGuest(
      { ownerId: "wedding-1", actor: { role: "guest", guest_id: "alex" } },
      "alex",
    );
    expect(own).toMatchObject({
      id: "alex",
      name: "Alex Smith",
      email: "alex@example.com",
      custom_fields: { meal: "Vegetarian" },
    });
    expect(own).not.toHaveProperty("private_notes");

    await expect(
      guests.readGuest(
        { ownerId: "wedding-1", actor: { role: "guest", guest_id: "sam" } },
        "alex",
      ),
    ).rejects.toBeInstanceOf(GuestAccessDeniedError);
  });

  it("uses Cedar for edits before writing the plan", async () => {
    const fixture = store();
    const guests = createGuestAccessService(fixture.plans);
    const identity = {
      ownerId: "wedding-1",
      actor: { role: "guest" as const, guest_id: "alex" },
    };

    await guests.updateGuest(
      identity,
      "alex",
      { email: "new@example.com" },
      changedAt,
    );
    await guests.updateGuestCustomField(
      identity,
      "alex",
      "meal",
      "Chicken",
      changedAt,
    );

    expect(fixture.update).toHaveBeenCalledTimes(2);
    expect(fixture.current()?.plan.guests[0]).toMatchObject({
      email: "new@example.com",
      custom_fields: { meal: "Chicken" },
    });

    await expect(
      guests.updateGuest(
        identity,
        "alex",
        { private_notes: ["Not allowed"] },
        changedAt,
      ),
    ).rejects.toThrow("guest cannot edit private_notes");
    expect(fixture.update).toHaveBeenCalledTimes(2);
  });

  it("fails closed when no persisted plan exists", async () => {
    const guests = createGuestAccessService(store(null).plans);
    await expect(
      guests.readGuest(
        { ownerId: "missing", actor: { role: "couple", id: "owner" } },
        "alex",
      ),
    ).rejects.toBeInstanceOf(WeddingPlanUnavailableError);
  });
});

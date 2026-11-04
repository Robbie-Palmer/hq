import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseWeddingPlan, type WeddingPlan } from "wedding-planner-domain";
import {
  createWeddingPlannerDb,
  createWeddingPlanRepository,
  WeddingPlanAlreadyExistsError,
  WeddingPlanNotFoundError,
  weddingPlan,
} from "../src";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const { client, db } = createWeddingPlannerDb(connectionString);
const repository = createWeddingPlanRepository(db);

function plan(host = "Alex"): WeddingPlan {
  return parseWeddingPlan({
    version: 2,
    guests: [{ id: "guest-1", name: "Guest", attendance: "yes" }],
    hosts: [host],
    seating: { top_table_capacity: 2, table_capacities: [2] },
  });
}

beforeEach(async () => {
  await db.delete(weddingPlan);
});

afterAll(async () => {
  await client.end({ timeout: 5 });
});

describe("Wedding plan repository", () => {
  it("rejects invalid owner and revision inputs", async () => {
    await expect(repository.load(" ")).rejects.toThrow("Owner ID is required");
    await expect(repository.update("owner-1", 0, plan())).rejects.toThrow(
      "Expected revision must be a positive integer",
    );
  });

  it("creates and loads a validated plan for its owner", async () => {
    const created = await repository.create("owner-1", plan());

    expect(created.revision).toBe(1);
    await expect(repository.load("owner-1")).resolves.toEqual(created);
  });

  it("does not expose one owner's plan to another owner", async () => {
    await repository.create("owner-1", plan());

    await expect(repository.load("owner-2")).resolves.toBeNull();
    await expect(repository.update("owner-2", 1, plan("Sam"))).rejects.toBeInstanceOf(
      WeddingPlanNotFoundError,
    );
  });

  it("uses optimistic revisions to reject stale writes", async () => {
    await repository.create("owner-1", plan());
    const updated = await repository.update("owner-1", 1, plan("Sam"));

    expect(updated.revision).toBe(2);
    await expect(
      repository.update("owner-1", 1, plan("Taylor")),
    ).rejects.toMatchObject({
      ownerId: "owner-1",
      expectedRevision: 1,
      actualRevision: 2,
    });
    await expect(repository.load("owner-1")).resolves.toMatchObject({
      plan: { hosts: ["Sam"] },
      revision: 2,
    });
  });

  it("rejects duplicate creation without replacing the saved plan", async () => {
    await repository.create("owner-1", plan());

    await expect(repository.create("owner-1", plan("Sam"))).rejects.toBeInstanceOf(
      WeddingPlanAlreadyExistsError,
    );
    await expect(repository.load("owner-1")).resolves.toMatchObject({
      plan: { hosts: ["Alex"] },
      revision: 1,
    });
  });

  it("validates plans before writing", async () => {
    const invalid = { ...plan(), hosts: [] } as WeddingPlan;

    await expect(repository.create("owner-1", invalid)).rejects.toThrow(
      /compatible wedding planner plan/,
    );
    await expect(repository.load("owner-1")).resolves.toBeNull();
  });
});

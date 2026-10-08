import { describe, expect, it, vi } from "vitest";
import type { PlannerApplication } from "@/lib/wedding-planner/application";
import { createPlannerApplication } from "@/lib/wedding-planner/application";
import { loadEditorPlan } from "@/lib/wedding-planner/bootstrap";
import { createBrowserWeddingPlanRepository } from "@/lib/wedding-planner/browser-repository";
import {
  editorStateToPlan,
  toEditorState,
} from "@/lib/wedding-planner/editor-projection";
import { createSampleWeddingPlan } from "@/lib/wedding-planner/sample-plan";

function application(existing = false): PlannerApplication {
  return {
    load: vi
      .fn()
      .mockResolvedValue(
        existing ? toEditorState(createSampleWeddingPlan()) : null,
      ),
    save: vi.fn().mockResolvedValue(undefined),
    calculateRooms: vi.fn(),
    calculateTables: vi.fn(),
  };
}

describe("sample wedding plan", () => {
  it("seeds empty browsers on request, saves through the application and retains existing plans", async () => {
    const empty = application();
    expect(await loadEditorPlan(empty, false)).toBeNull();
    expect(empty.save).not.toHaveBeenCalled();
    const seeded = await loadEditorPlan(empty, true);
    expect(seeded?.guests).toHaveLength(26);
    expect(empty.save).toHaveBeenCalledWith(seeded);
    const existing = application(true);
    await loadEditorPlan(existing, true);
    expect(existing.save).not.toHaveBeenCalled();
  });

  it("does not overwrite a stored plan that failed to load", async () => {
    const existing = application();
    vi.mocked(existing.load).mockRejectedValue(new Error("Invalid saved plan"));
    await expect(loadEditorPlan(existing, true)).rejects.toThrow(
      "Invalid saved plan",
    );
    expect(existing.save).not.toHaveBeenCalled();
  });

  it("calculates both plans with roles, separate-bed couples, day guests and seating preferences", async () => {
    const wedding = createSampleWeddingPlan();
    const saved = new Map<string, string>();
    const repository = createBrowserWeddingPlanRepository({
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => {
        saved.set(key, value);
      },
    });
    const planner = createPlannerApplication(repository);
    const state = toEditorState(wedding);
    await planner.save(state);
    expect(editorStateToPlan((await planner.load())!)).toEqual(
      editorStateToPlan(state),
    );
    const tables = await planner.calculateTables(state);
    expect(tables.status).toBe("provisional");
    expect(tables.tables.flatMap((table) => table.guest_ids)).toHaveLength(23);
    expect(
      tables.tables.find((table) => table.id === "top")?.guest_ids,
    ).toHaveLength(8);
    const quinn = tables.tables.find((table) =>
      table.guest_ids.includes("quinn"),
    );
    expect(quinn?.guest_ids).toContain("riley");
    for (const table of tables.tables)
      expect(
        table.guest_ids.length + table.fixed_guests.length,
      ).toBeLessThanOrEqual(table.capacity);
    const rooms = await planner.calculateRooms(state);
    expect(rooms.result.rooms.linen_1).toEqual(["alex"]);
    expect(rooms.parties.flatMap((party) => party.guests)).not.toContain(
      "Milo King",
    );
    expect(rooms.result.cash_flow.already_paid_pence).toBe(15000);
  }, 20000);
});

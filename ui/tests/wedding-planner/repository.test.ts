import { describe, expect, it } from "vitest";
import { setCouple } from "wedding-planner-domain";
import { createBrowserWeddingPlanRepository } from "@/lib/wedding-planner/browser-repository";
import {
  editorStateToPlan,
  toEditorState,
} from "@/lib/wedding-planner/editor-projection";
import {
  decodeWeddingPlan,
  encodeWeddingPlan,
} from "@/lib/wedding-planner/plan-codec";
import { setOwnBed, setPartner } from "@/lib/wedding-planner/sharing";
import {
  accommodationSeatingSuggestions,
  buildTableInput,
  setTablePairDecision,
} from "@/lib/wedding-planner/table-state";

function legacy() {
  return {
    guests: ["a", "b"].map((id) => ({
      id,
      name: id,
      overnight: "yes",
      attendance: "yes",
      fixed_bed_group_id: "ab",
    })),
    payment_modes: {},
    cottage_options: {},
    cottage_paid_by_us_gbp: {},
    custom_note: "Keep this in backups",
  };
}

function storage(initial: Record<string, string>) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

describe("wedding plan persistence and migrations", () => {
  it("captures a save before the caller changes the supplied plan", async () => {
    const repository = createBrowserWeddingPlanRepository(storage({}));
    const wedding = decodeWeddingPlan(legacy());
    const saved = repository.save(wedding);
    wedding.guests[0]!.name = "Changed after saving";
    await saved;
    expect((await repository.load())?.guests[0]?.name).toBe("a");
  });
  it("rejects storage failures through the asynchronous repository contract", async () => {
    const error = new Error("Storage unavailable");
    const repository = createBrowserWeddingPlanRepository({
      getItem: () => {
        throw error;
      },
      setItem: () => {
        throw error;
      },
    });
    await expect(repository.load()).rejects.toBe(error);
    await expect(repository.save(decodeWeddingPlan(legacy()))).rejects.toBe(
      error,
    );
  });
  it("keeps dismissed sharing suggestions through the editor and browser repository", async () => {
    const repository = createBrowserWeddingPlanRepository(storage({}));
    const state = toEditorState(decodeWeddingPlan(legacy()));
    state.couples = [];
    state.guests[0]!.may_share_cottage_with = ["b"];
    expect(accommodationSeatingSuggestions(state)).toHaveLength(1);
    setTablePairDecision(state, "a", "b", "unset");
    await repository.save(editorStateToPlan(state));
    const reloaded = toEditorState((await repository.load())!);
    expect(reloaded.dismissed_accommodation_suggestions).toEqual([["a", "b"]]);
    expect(accommodationSeatingSuggestions(reloaded)).toEqual([]);
    expect(editorStateToPlan(reloaded).extensions).not.toHaveProperty(
      "dismissed_accommodation_suggestions",
    );
  });
  it.each(["wedding-planner:plan:v1", "wedding-rooms:plan:v1"])(
    "migrates %s to a canonical plan while retaining its original copy",
    async (key) => {
      const original = JSON.stringify(legacy());
      const saved = storage({ [key]: original });
      const repository = createBrowserWeddingPlanRepository(saved);
      const wedding = await repository.load();
      expect(wedding?.version).toBe(2);
      expect(wedding?.couples).toEqual([{ id: "ab", guest_ids: ["a", "b"] }]);
      expect(wedding?.accommodation.reservations).toEqual({});
      expect(JSON.parse(saved.getItem("wedding-planner:plan:v2")!)).toEqual(
        wedding,
      );
      expect(saved.getItem(key)).toBe(original);
    },
  );

  it("keeps the relationship after removing a bed pairing and reloading", async () => {
    const saved = storage({});
    const repository = createBrowserWeddingPlanRepository(saved);
    const state = toEditorState(decodeWeddingPlan(legacy()));
    setPartner(state, "a", "");
    expect(state.guests.map((guest) => guest.fixed_bed_group_id)).toEqual([
      "",
      "",
    ]);
    await repository.save(editorStateToPlan(state));
    const loaded = toEditorState((await repository.load())!);
    expect(
      buildTableInput(loaded).guests.map((guest) => guest.partner_id),
    ).toEqual(["b", "a"]);
  });

  it("preserves the couple when the editor asks for a separate double bed", () => {
    const state = toEditorState(decodeWeddingPlan(legacy()));
    setOwnBed(state, "a", true);
    expect(state.guests[0]?.requires_own_bed).toBe(true);
    expect(state.guests.map((guest) => guest.fixed_bed_group_id)).toEqual([
      "",
      "",
    ]);
    expect(
      buildTableInput(state).guests.map((guest) => guest.partner_id),
    ).toEqual(["b", "a"]);
  });

  it("does not infer couples again once an explicit relationship list exists", () => {
    const state = toEditorState(decodeWeddingPlan(legacy()));
    state.couples = [];
    const wedding = editorStateToPlan(state);
    expect(wedding.couples).toEqual([]);
    expect(wedding.accommodation.guests.a?.fixed_bed_group_id).toBe("ab");
    expect(
      buildTableInput(toEditorState(wedding)).guests.every(
        (guest) => !guest.partner_id,
      ),
    ).toBe(true);
  });

  it("round trips new backups and preserves legacy extension fields", () => {
    const wedding = decodeWeddingPlan(legacy());
    setCouple(wedding, "a", null);
    const imported = decodeWeddingPlan(JSON.parse(encodeWeddingPlan(wedding)));
    expect(imported).toEqual(wedding);
    expect(toEditorState(imported).custom_note).toBe("Keep this in backups");
    expect(imported.couples).toEqual([]);
  });

  it("reports an invalid current plan rather than reverting to a stale legacy copy", async () => {
    const repository = createBrowserWeddingPlanRepository(
      storage({
        "wedding-planner:plan:v2": "{",
        "wedding-planner:plan:v1": JSON.stringify(legacy()),
      }),
    );
    await expect(repository.load()).rejects.toThrow();
  });

  it("migrates old v2 top-table choices into seating and preserves explicit role choices", () => {
    const existing = decodeWeddingPlan(legacy());
    const { top_table_guest_ids, ...oldSeating } = existing.seating;
    const guests = existing.guests.map(({ wedding_roles, ...guest }) => guest);
    const migrated = decodeWeddingPlan({
      ...existing,
      guests,
      seating: oldSeating,
      wedding_party_guest_ids: ["a"],
    });
    expect(migrated.seating.top_table_guest_ids).toEqual(["a"]);
    expect(migrated.guests[0]?.wedding_roles).toEqual(["wedding_party"]);
    expect(migrated).not.toHaveProperty("wedding_party_guest_ids");
    const explicit = decodeWeddingPlan({
      ...existing,
      seating: oldSeating,
      wedding_party_guest_ids: ["a"],
    });
    expect(explicit.guests[0]?.wedding_roles).toEqual([]);
    expect(decodeWeddingPlan(JSON.parse(encodeWeddingPlan(migrated)))).toEqual(
      migrated,
    );
  });

  it("rejects unknown future backup versions", () => {
    expect(() =>
      decodeWeddingPlan({ ...decodeWeddingPlan(legacy()), version: 3 }),
    ).toThrow("compatible wedding planner plan");
  });
});

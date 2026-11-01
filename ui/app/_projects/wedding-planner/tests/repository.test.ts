import { describe, expect, it } from "vitest";
import {
  parseWeddingPlan,
  setCouple,
  type WeddingPlan,
} from "wedding-planner-domain";
import { createBrowserWeddingPlanRepository } from "@/app/_projects/wedding-planner/application/browser-repository";
import {
  editorStateToPlan,
  toEditorState,
} from "@/app/_projects/wedding-planner/application/editor-projection";
import {
  decodeWeddingPlan,
  encodeWeddingPlan,
} from "@/app/_projects/wedding-planner/application/plan-codec";
import {
  setOwnBed,
  setPartner,
} from "@/app/_projects/wedding-planner/application/sharing";
import {
  accommodationSeatingSuggestions,
  buildTableInput,
  setTablePairDecision,
} from "@/app/_projects/wedding-planner/application/table-state";

function currentPlan(): WeddingPlan {
  return parseWeddingPlan({
    version: 2,
    guests: ["a", "b"].map((id) => ({ id, name: id, attendance: "yes" })),
    couples: [{ id: "ab", guest_ids: ["a", "b"] }],
    hosts: ["You", "Your partner"],
    accommodation: {
      guests: Object.fromEntries(
        ["a", "b"].map((id) => [
          id,
          { overnight: "yes", fixed_bed_group_id: "ab" },
        ]),
      ),
    },
    seating: { top_table_capacity: 2, table_capacities: [8] },
    extensions: { custom_note: "Keep this in backups" },
  });
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

describe("wedding plan persistence", () => {
  it("captures a save before the caller changes the supplied plan", async () => {
    const repository = createBrowserWeddingPlanRepository(storage({}));
    const wedding = currentPlan();
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
    await expect(repository.save(currentPlan())).rejects.toBe(error);
  });
  it("keeps dismissed sharing suggestions through the editor and browser repository", async () => {
    const repository = createBrowserWeddingPlanRepository(storage({}));
    const state = toEditorState(currentPlan());
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
  it("keeps the relationship after removing a bed pairing and reloading", async () => {
    const saved = storage({});
    const repository = createBrowserWeddingPlanRepository(saved);
    const state = toEditorState(currentPlan());
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
    const state = toEditorState(currentPlan());
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
    const state = toEditorState(currentPlan());
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

  it("round trips current backups and preserves extension fields", () => {
    const wedding = currentPlan();
    setCouple(wedding, "a", null);
    const imported = decodeWeddingPlan(encodeWeddingPlan(wedding));
    expect(imported).toEqual(wedding);
    expect(toEditorState(imported).custom_note).toBe("Keep this in backups");
    expect(imported.couples).toEqual([]);
  });

  it("reports malformed serialized plans at the codec boundary", () => {
    expect(() => decodeWeddingPlan("{")).toThrow(
      "This file is not valid JSON.",
    );
  });

  it("reports an invalid stored plan", async () => {
    const repository = createBrowserWeddingPlanRepository(
      storage({ "wedding-planner:plan:v2": "{" }),
    );
    await expect(repository.load()).rejects.toThrow();
  });

  it("rejects unknown future backup versions", () => {
    expect(() => decodeWeddingPlan({ ...currentPlan(), version: 3 })).toThrow(
      "compatible wedding planner plan",
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { AccommodationEditor } from "@/components/wedding-planner/accommodation-editor";
import type { PlannerApplication } from "@/lib/wedding-planner/application";
import { calculateRooms } from "@/lib/wedding-planner/calculate";
import {
  editorStateToPlan,
  toEditorState,
} from "@/lib/wedding-planner/editor-projection";
import { solveTables } from "@/lib/wedding-planner/solve-tables";
import { buildTableInput } from "@/lib/wedding-planner/table-state";
import type { Guest, WeddingPlanDraft } from "@/lib/wedding-planner/types";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@/tests/test-utils";

function guest(id: string, name: string, changes: Partial<Guest> = {}): Guest {
  return {
    id,
    name,
    source_party: "",
    tags: "",
    overnight: "yes",
    fixed_bed_group_id: "",
    requires_own_bed: false,
    safe_for_our_booking: true,
    may_share_bed_with: [],
    avoid_bed_with: [],
    can_share_room: false,
    room_share_mode: "none",
    may_share_room_with: [],
    can_share_cottage: true,
    cottage_share_mode: "any",
    may_share_cottage_with: [],
    avoid_room_with: [],
    avoid_cottage_with: [],
    priority: 3,
    fixed_room_id: "",
    preferred_property_ids: [],
    outside_cost_gbp: "",
    charge_cap_exempt: false,
    free_stay_reasons: [],
    include_partner_in_free_stay: true,
    ...changes,
  };
}

function sampleState(): WeddingPlanDraft {
  return toEditorState(
    editorStateToPlan({
      nights: 1,
      guests: [
        guest("linen-a", "Alex", {
          fixed_bed_group_id: "linen-a",
          fixed_room_id: "linen_1",
        }),
        guest("linen-b", "Blair", {
          fixed_bed_group_id: "linen-a",
          fixed_room_id: "linen_1",
        }),
        guest("casey", "Casey", { source_party: "friends" }),
        guest("drew", "Drew", { source_party: "friends" }),
      ],
      payment_modes: {
        venue: "couple",
        black_sheep: "guests",
        river_side: "guests",
        linen: "guests",
      },
      cottage_options: {
        black_sheep: { availability: "available", booking_by: "couple" },
        river_side: { availability: "available", booking_by: "couple" },
      },
      cottage_paid_by_us_gbp: {
        black_sheep: "0",
        river_side: "0",
        linen: "150",
      },
      reservations: {
        linen_1: { guest_ids: ["linen-a", "linen-b"], approved_guest_ids: [] },
      },
      reviewed_non_couples: [],
      suite_billing_modes: {},
      guest_charge_cap_gbp: "",
      max_cottage_spend_gbp: "",
      default_outside_cost_gbp: "",
      optimization_mode: "priority_first",
    }),
  );
}

vi.mock("@/components/wedding-planner/table-room-canvas", () => ({
  default: () => null,
}));

describe("accommodation editor", () => {
  it("reviews sharing suggestions and preserves manual seating decisions", async () => {
    const state = sampleState();
    state.guests.find(
      (person) => person.id === "casey",
    )!.may_share_cottage_with = ["drew", "linen-a"];
    state.guests.find(
      (person) => person.id === "drew",
    )!.may_share_cottage_with = ["linen-b"];
    state.guests[0]!.avoid_table_with = ["casey"];
    const save = vi.fn<PlannerApplication["save"]>().mockResolvedValue();
    const application: PlannerApplication = {
      load: vi.fn().mockResolvedValue(state),
      save,
      calculateRooms,
      calculateTables: (state) => solveTables(buildTableInput(state)),
    };
    render(<AccommodationEditor application={application} />);
    await screen.findByText("Who shares a bed?");
    fireEvent.click(screen.getByRole("button", { name: "Tables" }));
    expect(
      screen.getByRole("button", { name: "Accept all 2 sharing suggestions" }),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Table preferences for guest" }),
      { target: { value: "casey" } },
    );
    expect(
      screen.getByText("Suggested from cottage sharing"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Accept sharing suggestion for Casey and Drew",
      }),
    );
    const pair = screen.getByRole("group", {
      name: "Casey and Drew table preference",
    });
    expect(
      within(pair).getByRole("button", { name: "Love to sit together" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      within(pair).getByRole("button", { name: "No preference" }),
    );
    expect(
      screen.queryByText("Suggested from cottage sharing"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Accept all 1 sharing suggestion" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalled());
    const saved = save.mock.lastCall![0];
    expect(
      saved.guests.find((person) => person.id === "drew")?.prefer_table_with,
    ).toEqual(["linen-b"]);
    expect(saved.guests[0]?.avoid_table_with).toEqual(["casey"]);
    expect(saved.dismissed_accommodation_suggestions).toEqual([
      ["casey", "drew"],
    ]);
    expect(
      saved.guests.find((person) => person.id === "casey")
        ?.may_share_cottage_with,
    ).toEqual(["drew", "linen-a"]);
  });
  it("saves and calculates tables from shared guest choices and clears stale results", async () => {
    const state = sampleState();
    for (const person of state.guests) person.attendance = "yes";
    const save = vi.fn<PlannerApplication["save"]>().mockResolvedValue();
    const application: PlannerApplication = {
      calculateTables: (state) => solveTables(buildTableInput(state)),
      load: vi.fn().mockResolvedValue(state),
      save,
      calculateRooms: calculateRooms,
    };
    render(<AccommodationEditor application={application} />);
    await screen.findByText("Who shares a bed?");
    fireEvent.click(screen.getByRole("button", { name: "Tables" }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Number of guest tables" }),
      { target: { value: "2" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Seats per guest table" }),
      { target: { value: "2" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply to all guest tables" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Casey at top table" }),
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Table preferences for guest" }),
      { target: { value: "linen-a" } },
    );
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Alex and Drew table preference" }),
      ).getByRole("button", { name: "Keep apart" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Calculate tables" }));
    const result = await screen.findByRole("region", {
      name: "Calculated table plan",
    });
    expect(within(result).getByText("Top table")).toBeInTheDocument();
    expect(within(result).getByText("Casey")).toBeInTheDocument();
    const saved = save.mock.lastCall?.[0];
    expect(saved?.table_plan?.top_table_guest_ids).toEqual(["casey"]);
    expect(saved?.table_plan?.table_capacities).toEqual([2, 2]);
    expect(
      saved?.guests.find((person) => person.id === "drew")?.avoid_table_with,
    ).toEqual(["linen-a"]);
    expect(saved?.guests[0]?.fixed_bed_group_id).toBe("linen-a");
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "Wedding party" },
    });
    expect(within(result).getByText("Wedding party")).toBeInTheDocument();
    expect(within(result).getByText("Casey")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rotate table" }));
    expect(screen.getByRole("region", { name: "Calculated table plan" })).toBe(
      result,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Casey wedding attendance" }),
      { target: { value: "no" } },
    );
    expect(
      screen.queryByRole("region", { name: "Calculated table plan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Casey at top table" }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Calculate tables" }));
    await screen.findByRole("region", { name: "Calculated table plan" });
    expect(save.mock.lastCall?.[0].table_plan?.top_table_guest_ids).toEqual([]);
  });

  it.each(["layout", "attendance"])(
    "handles a %s edit while seating is being calculated",
    async (edit) => {
      const state = sampleState();
      for (const person of state.guests) person.attendance = "yes";
      const result = await solveTables(buildTableInput(state));
      let finish = () => {};
      const pending = new Promise<typeof result>((resolve) => {
        finish = () => resolve(result);
      });
      const calculateTables = vi.fn().mockReturnValue(pending);
      const application: PlannerApplication = {
        load: vi.fn().mockResolvedValue(state),
        save: vi.fn<PlannerApplication["save"]>().mockResolvedValue(),
        calculateRooms,
        calculateTables,
      };
      render(<AccommodationEditor application={application} />);
      await screen.findByText("Who shares a bed?");
      fireEvent.click(screen.getByRole("button", { name: "Tables" }));
      fireEvent.click(screen.getByRole("button", { name: "Calculate tables" }));
      await waitFor(() => expect(calculateTables).toHaveBeenCalledOnce());
      if (edit === "layout") {
        fireEvent.change(screen.getByLabelText("Table name"), {
          target: { value: "Wedding party" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Rotate table" }));
      } else {
        fireEvent.change(
          screen.getByRole("combobox", { name: "Casey wedding attendance" }),
          {
            target: { value: "no" },
          },
        );
      }
      await act(async () => {
        finish();
        await pending;
      });
      if (edit === "layout") {
        expect(
          screen.getByRole("region", { name: "Calculated table plan" }),
        ).toHaveTextContent("Wedding party");
      } else {
        expect(
          screen.queryByRole("region", { name: "Calculated table plan" }),
        ).toBeNull();
      }
    },
  );

  it("explains insufficient table capacity and recalculates after adding tables", async () => {
    const state = sampleState();
    for (const person of state.guests) person.attendance = "yes";
    state.table_plan = {
      top_table_capacity: 2,
      top_table_guest_ids: [],
      table_capacities: [2],
    };
    const application: PlannerApplication = {
      calculateTables: (state) => solveTables(buildTableInput(state)),
      load: vi.fn().mockResolvedValue(state),
      save: vi.fn<PlannerApplication["save"]>().mockResolvedValue(),
      calculateRooms: calculateRooms,
    };
    render(<AccommodationEditor application={application} />);
    await screen.findByText("Who shares a bed?");
    fireEvent.click(screen.getByRole("button", { name: "Tables" }));
    fireEvent.click(screen.getByRole("button", { name: "Calculate tables" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only 2");
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Number of guest tables" }),
      { target: { value: "2" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Calculate tables" }));
    expect(
      await screen.findByRole("region", { name: "Calculated table plan" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("loads the sample from the empty-state action and persists wedding roles", async () => {
    const save = vi.fn<PlannerApplication["save"]>().mockResolvedValue();
    const application: PlannerApplication = {
      load: vi.fn().mockResolvedValue(null),
      save,
      calculateRooms,
      calculateTables: (state) => solveTables(buildTableInput(state)),
    };
    render(<AccommodationEditor application={application} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Use sample plan" }),
    );
    await screen.findByText(/26 fictional guests/);
    expect(save.mock.lastCall?.[0].guests).toHaveLength(26);
    fireEvent.click(screen.getByRole("button", { name: /Guests/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /Casey Brooks.*Staying/ }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Casey Brooks: Bridesmaid" }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Casey Brooks: Parent of the groom",
      }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(
      save.mock.lastCall?.[0].guests.find((guest) => guest.id === "casey")
        ?.wedding_roles,
    ).toEqual(["bridesmaid", "parent_of_groom"]);
    fireEvent.click(screen.getByRole("button", { name: "Tables" }));
    expect(
      screen.getByText("Bridesmaid · Parent of the groom"),
    ).toBeInTheDocument();
  });

  it("records partners independently of their own-bed choices", async () => {
    const save = vi.fn<PlannerApplication["save"]>().mockResolvedValue();
    const application: PlannerApplication = {
      load: vi.fn().mockResolvedValue(sampleState()),
      save,
      calculateRooms,
      calculateTables: (state) => solveTables(buildTableInput(state)),
    };
    render(<AccommodationEditor application={application} />);
    await screen.findByText("Who shares a bed?");
    fireEvent.click(screen.getByRole("button", { name: /Guests/ }));
    fireEvent.click(screen.getByRole("button", { name: /Casey.*Staying/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Casey partner" }), {
      target: { value: "drew" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Needs their own double bed/ }),
    );
    expect(screen.getByRole("combobox", { name: "Casey partner" })).toHaveValue(
      "drew",
    );
    await waitFor(() => expect(save).toHaveBeenCalled());
    const saved = save.mock.lastCall![0];
    expect(
      saved.guests.find((person) => person.id === "casey")?.requires_own_bed,
    ).toBe(true);
    expect(saved.couples).toContainEqual({
      id: JSON.stringify(["casey", "drew"]),
      guest_ids: ["casey", "drew"],
    });
    expect(
      buildTableInput(saved).guests.find((person) => person.id === "drew")
        ?.partner_id,
    ).toBe("casey");
  });

  it("records bed, guest, sharing, and price choices across its sections", async () => {
    const save = vi.fn<PlannerApplication["save"]>().mockResolvedValue();
    const application: PlannerApplication = {
      calculateTables: (state) => solveTables(buildTableInput(state)),
      load: vi.fn().mockResolvedValue(sampleState()),
      save,
      calculateRooms: calculateRooms,
    };
    render(<AccommodationEditor application={application} />);

    expect(await screen.findByText("Casey & Drew")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not a couple" }));
    expect(screen.getByText(/Casey.*Drew.*Not a couple/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Guests/ }));
    fireEvent.click(screen.getByRole("button", { name: /Casey.*Staying/ }));
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(
      screen.getByText("Not staying", { selector: "small" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: /Sharing map/ }));
    fireEvent.click(screen.getByRole("button", { name: "One double bed" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Needs their own double bed/ }),
    );
    expect(
      screen.getByText(/needs their own double bed\. Turn off/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Needs their own double bed/ }),
    );
    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Sharing with Drew" }),
      ).getByRole("button", { name: "Yes" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cottage" }));
    fireEvent.click(screen.getByRole("button", { name: "Only yes matches" }));
    fireEvent.click(screen.getByRole("button", { name: /Rooms & costs/ }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Guest charge cap" }),
      {
        target: { value: "100" },
      },
    );

    await waitFor(() => expect(save).toHaveBeenCalled());
    const saved = save.mock.lastCall?.[0];
    expect(
      saved?.guests.find((person) => person.id === "casey")?.overnight,
    ).toBe("yes");
    expect(saved?.guest_charge_cap_gbp).toBe("100");
    expect(saved?.reviewed_non_couples).toEqual([["casey", "drew"]]);

    fireEvent.click(screen.getByRole("button", { name: /Room plan/ }));
    fireEvent.click(screen.getByRole("button", { name: "Calculate rooms" }));
    expect(
      await screen.findByText("Guests expected to pay"),
    ).toBeInTheDocument();
    expect(screen.getByText("Payment breakdown")).toBeInTheDocument();
  });

  it("imports a plan after reporting an invalid file", async () => {
    const save = vi.fn<PlannerApplication["save"]>().mockResolvedValue();
    const application: PlannerApplication = {
      calculateTables: (state) => solveTables(buildTableInput(state)),
      load: vi.fn().mockResolvedValue(null),
      save,
      calculateRooms: vi.fn(),
    };
    render(<AccommodationEditor application={application} />);
    expect(await screen.findByText("No plan loaded")).toBeInTheDocument();
    const input = screen.getByLabelText("Choose a wedding room plan");
    const invalid = Object.assign(new File(["{}"], "invalid.json"), {
      text: async () => "{}",
    });
    fireEvent.change(input, { target: { files: [invalid] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "not a compatible wedding planner plan",
    );

    const state = sampleState();
    const valid = Object.assign(
      new File([JSON.stringify(state)], "plan.json"),
      {
        text: async () => JSON.stringify(state),
      },
    );
    fireEvent.change(input, { target: { files: [valid] } });
    expect(await screen.findByText("Who shares a bed?")).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith(state);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("flushes a pending edit before calculating", async () => {
    const save = vi.fn<PlannerApplication["save"]>().mockResolvedValue();
    const solve = vi
      .fn<PlannerApplication["calculateRooms"]>()
      .mockImplementation(async (state) => {
        expect(save).toHaveBeenCalledWith(state);
        return calculateRooms(state);
      });
    const application: PlannerApplication = {
      calculateTables: (state) => solveTables(buildTableInput(state)),
      load: vi.fn().mockResolvedValue(sampleState()),
      save,
      calculateRooms: solve,
    };
    render(<AccommodationEditor application={application} />);
    await screen.findByText("Who shares a bed?");
    fireEvent.click(screen.getByRole("button", { name: /Rooms & costs/ }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Guest charge cap" }),
      { target: { value: "19.99" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Room plan/ }));
    fireEvent.click(screen.getByRole("button", { name: "Calculate rooms" }));

    expect(
      await screen.findByText("Guests expected to pay"),
    ).toBeInTheDocument();
    expect(solve).toHaveBeenCalledTimes(1);
    expect(save.mock.lastCall?.[0].guest_charge_cap_gbp).toBe("19.99");
    expect(screen.getByText("Saved in this browser")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(save).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { AccommodationEditor } from "@/components/wedding-planner/accommodation-editor";
import { calculateRooms } from "@/lib/wedding-planner/calculate";
import type { PlannerSource } from "@/lib/wedding-planner/source";
import type { Guest, State } from "@/lib/wedding-planner/types";
import { fireEvent, render, screen, waitFor, within } from "@/tests/test-utils";

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

function sampleState(): State {
  return {
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
    cottage_paid_by_us_gbp: { black_sheep: "0", river_side: "0", linen: "150" },
    reservations: {
      linen_1: { guest_ids: ["linen-a", "linen-b"], approved_guest_ids: [] },
    },
    reviewed_non_couples: [],
    suite_billing_modes: {},
    guest_charge_cap_gbp: "",
    max_cottage_spend_gbp: "",
    default_outside_cost_gbp: "",
    optimization_mode: "priority_first",
  };
}

describe("accommodation editor", () => {
  it("records bed, guest, sharing, and price choices across its sections", async () => {
    const save = vi.fn<PlannerSource["save"]>().mockResolvedValue();
    const source: PlannerSource = {
      load: vi.fn().mockResolvedValue(sampleState()),
      save,
      solve: calculateRooms,
    };
    render(<AccommodationEditor source={source} />);

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
    expect(
      screen.getByText(/Nothing extra is due for Riverside suites/),
    ).toBeInTheDocument();
  });

  it("imports a plan after reporting an invalid file", async () => {
    const save = vi.fn<PlannerSource["save"]>().mockResolvedValue();
    const source: PlannerSource = {
      load: vi.fn().mockResolvedValue(null),
      save,
      solve: vi.fn(),
    };
    render(<AccommodationEditor source={source} />);
    expect(
      await screen.findByText("Bring in your room plan"),
    ).toBeInTheDocument();
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
    const save = vi.fn<PlannerSource["save"]>().mockResolvedValue();
    const solve = vi
      .fn<PlannerSource["solve"]>()
      .mockImplementation(async (state) => {
        expect(save).toHaveBeenCalledWith(state);
        return calculateRooms(state);
      });
    const source: PlannerSource = {
      load: vi.fn().mockResolvedValue(sampleState()),
      save,
      solve,
    };
    render(<AccommodationEditor source={source} />);
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

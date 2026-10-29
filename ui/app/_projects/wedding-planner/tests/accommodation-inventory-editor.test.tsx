import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  editorStateToPlan,
  toEditorState,
} from "@/app/_projects/wedding-planner/application/editor-projection";
import { createSampleWeddingPlan } from "@/app/_projects/wedding-planner/application/sample-plan";
import type { WeddingPlanDraft } from "@/app/_projects/wedding-planner/application/types";
import { AccommodationInventoryEditor } from "@/app/_projects/wedding-planner/components/accommodation-inventory-editor";
import { fireEvent, render, screen, waitFor, within } from "@/tests/test-utils";

function inventoryState(): WeddingPlanDraft {
  const state = toEditorState(createSampleWeddingPlan());
  state.guest_directory = {
    households: [
      {
        id: "household-one",
        name: "Alex and Blair",
        address_lines: [],
        city: "",
        region: "",
        postal_code: "",
        country: "",
        private_notes: [],
      },
    ],
    invitation_parties: [],
    events: [],
    custom_fields: [],
    history: [],
    imports: [],
  };
  return state;
}

function InventoryHarness({
  initialState,
  onState,
}: Readonly<{
  initialState: WeddingPlanDraft;
  onState?: (state: WeddingPlanDraft) => void;
}>) {
  const [state, setState] = useState(initialState);
  return (
    <AccommodationInventoryEditor
      state={state}
      onUpdate={(change) =>
        setState((current) => {
          const next = structuredClone(current);
          change(next);
          onState?.(next);
          return next;
        })
      }
    />
  );
}

function selectMultiple(select: HTMLElement, values: string[]) {
  for (const option of within(select).getAllByRole("option")) {
    (option as HTMLOptionElement).selected = values.includes(
      (option as HTMLOptionElement).value,
    );
  }
  fireEvent.change(select);
}

function mockDownloads() {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:accommodation"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  return vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
}

describe("accommodation inventory editor", () => {
  it("edits property, booking, room, and bed records", async () => {
    mockDownloads();
    let latest = inventoryState();
    render(
      <InventoryHarness
        initialState={latest}
        onState={(state) => {
          latest = state;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Provider export" }));
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("Harbour Hotel kind"), {
      target: { value: "private_house" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel check-in"), {
      target: { value: "2027-06-03" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel check-out"), {
      target: { value: "2027-06-07" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel address"), {
      target: { value: "2 Quay Road" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel provider name"), {
      target: { value: "Quay Stays" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel provider contact"), {
      target: { value: "stay@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel accessibility"), {
      target: { value: "step-free, lift" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel custom attributes"), {
      target: { value: "parking=on site, malformed, pets=yes" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel quoted price"), {
      target: { value: "140" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel price basis"), {
      target: { value: "none" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel price basis"), {
      target: { value: "fixed" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel quoted price"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel booking state"), {
      target: { value: "booked" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel booking deadline"), {
      target: { value: "2027-03-01" },
    });
    fireEvent.change(
      screen.getByLabelText("Harbour Hotel confirmation reference"),
      { target: { value: "BOOK-42" } },
    );
    fireEvent.change(
      screen.getByLabelText("Harbour Hotel confirmation details"),
      { target: { value: "Call reception on arrival" } },
    );
    expect(
      screen.queryByLabelText("Harbour Hotel commitment ID"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Harbour Hotel payment IDs"),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Harbour Hotel payer"), {
      target: { value: "guest" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel payer record"), {
      target: { value: "alex" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel payer"), {
      target: { value: "household" },
    });
    fireEvent.change(screen.getByLabelText("Harbour Hotel payer record"), {
      target: { value: "household-one" },
    });
    fireEvent.change(
      screen.getByLabelText("Harbour Hotel cancellation state"),
      { target: { value: "requested" } },
    );
    fireEvent.change(screen.getByLabelText("Harbour Hotel refund state"), {
      target: { value: "pending" },
    });

    fireEvent.change(screen.getByLabelText("sample-hotel-101 room name"), {
      target: { value: "Family room" },
    });
    fireEvent.change(screen.getByLabelText("Family room capacity"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Family room accessibility"), {
      target: { value: "lift, shower seat" },
    });
    fireEvent.change(screen.getByLabelText("Family room bed name"), {
      target: { value: "King bed" },
    });
    fireEvent.change(screen.getByLabelText("King bed kind"), {
      target: { value: "other" },
    });
    fireEvent.change(screen.getByLabelText("King bed capacity"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add bed" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Bed 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Add room" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Room 2" }));

    fireEvent.change(screen.getByLabelText("sample-hotel property name"), {
      target: { value: "Quay House" },
    });
    fireEvent.change(screen.getByLabelText("New accommodation name"), {
      target: { value: "Overflow Hotel" },
    });
    fireEvent.change(screen.getByLabelText("New accommodation kind"), {
      target: { value: "hotel" },
    });
    fireEvent.change(screen.getByLabelText("New accommodation check-in"), {
      target: { value: "2027-06-04" },
    });
    fireEvent.change(screen.getByLabelText("New accommodation check-out"), {
      target: { value: "2027-06-06" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add accommodation" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove property" })[1]!,
    );

    await waitFor(() =>
      expect(latest.inventory?.properties[0]).toMatchObject({
        name: "Quay House",
        kind: "private_house",
        address: "2 Quay Road",
        custom_attributes: { parking: "on site", pets: "yes" },
        cost: { basis: "fixed", amount_gbp: "500" },
        booking: {
          status: "booked",
          payer: { kind: "household", id: "household-one" },
          cancellation_state: "requested",
          refund_state: "pending",
        },
      }),
    );
    expect(latest.inventory?.rooms[0]).toMatchObject({
      name: "Family room",
      capacity: 3,
      accessibility: ["lift", "shower seat"],
      beds: [{ name: "King bed", kind: "other", capacity: 3 }],
    });
  });

  it("manages confirmed, alternative, and self-arranged stays", async () => {
    let latest = inventoryState();
    render(
      <InventoryHarness
        initialState={latest}
        onState={(state) => {
          latest = state;
        }}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Assignment guest or household" }),
      { target: { value: "guest:blair" } },
    );
    fireEvent.change(screen.getByLabelText("Assignment room"), {
      target: { value: "sample-hotel-101" },
    });
    fireEvent.change(screen.getByLabelText("Assignment type"), {
      target: { value: "alternative" },
    });
    expect(
      screen.getByRole("button", { name: "Add assignment" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Assignment type"), {
      target: { value: "confirmed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add assignment" }));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Assignment guest or household" }),
      { target: { value: "guest:blair" } },
    );
    fireEvent.change(screen.getByLabelText("Assignment type"), {
      target: { value: "alternative" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add assignment" }));

    fireEvent.change(screen.getAllByLabelText("Blair Bennett arrival")[0]!, {
      target: { value: "2027-06-05" },
    });
    fireEvent.change(screen.getAllByLabelText("Blair Bennett departure")[0]!, {
      target: { value: "2027-06-06" },
    });
    const blairCards = screen
      .getAllByText("Blair Bennett")
      .map((label) => label.closest(".inventory-assignment-card"));
    const confirmedCard = blairCards.find((card) =>
      card?.textContent?.includes("confirmed"),
    ) as HTMLElement | undefined;
    expect(confirmedCard).not.toBeNull();
    fireEvent.click(
      within(confirmedCard!).getByRole("checkbox", { name: "Lock" }),
    );
    fireEvent.click(
      within(confirmedCard!).getByRole("checkbox", { name: "Double bed" }),
    );

    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Self-arranged guest or household",
      }),
      { target: { value: "household:household-one" } },
    );
    fireEvent.change(screen.getByLabelText("Self-arranged provider"), {
      target: { value: "Cottage Co" },
    });
    fireEvent.change(screen.getByLabelText("Self-arranged arrival"), {
      target: { value: "2027-06-03" },
    });
    fireEvent.change(screen.getByLabelText("Self-arranged departure"), {
      target: { value: "2027-06-07" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add guest-arranged stay" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove self-arranged stay for Alex and Blair household",
      }),
    );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Remove assignment for Blair Bennett",
      })[1]!,
    );

    await waitFor(() => {
      const assignments = latest.inventory?.assignments ?? [];
      expect(
        assignments.find((item) => item.subject.id === "blair"),
      ).toMatchObject({
        arrives_on: "2027-06-05",
        departs_on: "2027-06-06",
        status: "confirmed",
        locked: true,
        bed_ids: ["sample-hotel-101-double"],
      });
      expect(
        latest.inventory?.self_arranged_stays.some(
          (stay) => stay.subject.kind === "household",
        ),
      ).toBe(false);
    });
  });

  it("records guest and household needs and exports an itinerary", async () => {
    mockDownloads();
    let latest = inventoryState();
    render(
      <InventoryHarness
        initialState={latest}
        onState={(state) => {
          latest = state;
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Accommodation needs guest"), {
      target: { value: "alex" },
    });
    fireEvent.change(
      screen.getByLabelText("Alex Bennett accommodation arrival"),
      {
        target: { value: "2027-06-03" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Alex Bennett accommodation departure"),
      {
        target: { value: "2027-06-07" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Alex Bennett accommodation accessibility needs"),
      { target: { value: "step-free, shower seat" } },
    );
    fireEvent.change(
      screen.getByLabelText("Alex Bennett accommodation transport needs"),
      {
        target: { value: "late shuttle" },
      },
    );
    selectMultiple(
      screen.getByLabelText("Alex Bennett must share accommodation with"),
      ["blair"],
    );
    selectMultiple(
      screen.getByLabelText("Alex Bennett must not share accommodation with"),
      ["casey"],
    );
    fireEvent.change(
      screen.getByLabelText("Alex Bennett other accommodation needs"),
      {
        target: { value: "quiet room" },
      },
    );
    fireEvent.click(
      screen.getAllByRole("checkbox", { name: "Needs space for children" })[0]!,
    );

    fireEvent.change(screen.getByLabelText("Accommodation needs household"), {
      target: { value: "household-one" },
    });
    fireEvent.change(
      screen.getByLabelText("Alex and Blair accommodation arrival"),
      { target: { value: "2027-06-04" } },
    );
    fireEvent.change(
      screen.getByLabelText("Alex and Blair accommodation departure"),
      { target: { value: "2027-06-06" } },
    );
    fireEvent.change(
      screen.getByLabelText("Alex and Blair accommodation accessibility needs"),
      { target: { value: "ground floor" } },
    );
    fireEvent.change(
      screen.getByLabelText("Alex and Blair accommodation transport needs"),
      { target: { value: "taxi" } },
    );
    fireEvent.change(
      screen.getByLabelText("Alex and Blair other accommodation needs"),
      { target: { value: "cot" } },
    );
    fireEvent.click(
      screen.getAllByRole("checkbox", { name: "Needs space for children" })[1]!,
    );
    fireEvent.change(screen.getByLabelText("Guest itinerary export"), {
      target: { value: "alex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guest itinerary" }));

    await waitFor(() => {
      expect(latest.guests.find((guest) => guest.id === "alex")?.stay).toEqual({
        arrives_on: "2027-06-03",
        departs_on: "2027-06-07",
        must_share_with: ["blair"],
        must_not_share_with: ["casey"],
        accessibility_needs: ["step-free", "shower seat"],
        transport_needs: ["late shuttle"],
        needs_child_space: true,
        custom_needs: ["quiet room"],
      });
      expect(
        latest.inventory?.household_requirements["household-one"],
      ).toMatchObject({
        accessibility_needs: ["ground floor"],
        transport_needs: ["taxi"],
        custom_needs: ["cot"],
        needs_child_space: true,
      });
    });
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it("shows incomplete inventory errors without hiding the editors", () => {
    const state = inventoryState();
    state.inventory!.assignments[0]!.room_id = "missing-room";
    render(<InventoryHarness initialState={state} />);
    expect(screen.getByText(/unknown room/i)).toBeInTheDocument();
    expect(screen.getByText("Room assignments")).toBeInTheDocument();
    expect(() => editorStateToPlan(state)).toThrow();
  });
});

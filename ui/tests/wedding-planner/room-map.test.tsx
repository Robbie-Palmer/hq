import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TableRoomMap } from "@/components/wedding-planner/table-room-map";
import { tableRotation, tableSeats } from "@/lib/wedding-planner/room-layout";
import { tablePlanSchema } from "@/lib/wedding-planner/table-state";
import type {
  TableAllocation,
  WeddingPlanDraft,
} from "@/lib/wedding-planner/types";
import { fireEvent, render, screen } from "@/tests/test-utils";

vi.mock("next/dynamic", () => ({ default: () => () => null }));

const allocation: TableAllocation = {
  status: "optimal",
  tables: [
    {
      id: "top",
      name: "Top table",
      capacity: 2,
      fixed_guests: ["Alex", "Blair"],
      guest_ids: [],
    },
    {
      id: "table-1",
      name: "Table 1",
      capacity: 8,
      fixed_guests: [],
      guest_ids: [],
    },
  ],
  preferences_met: 0,
  preferences_total: 0,
  unmet_preferences: [],
  warnings: [],
};

function Editor() {
  const [state, setState] = useState<WeddingPlanDraft>({
    reviewed_non_couples: [],
    reservations: {},
    suite_billing_modes: {},
    guest_charge_cap_gbp: "",
    max_cottage_spend_gbp: "",
    default_outside_cost_gbp: "",
    optimization_mode: "priority_first",
    guests: [],
    payment_modes: {},
    cottage_options: {},
    cottage_paid_by_us_gbp: {},
    table_plan: {
      top_table_capacity: 2,
      top_table_guest_ids: [],
      table_capacities: [8],
    },
  });
  return (
    <>
      <TableRoomMap
        state={state}
        allocation={allocation}
        onUpdate={(change) =>
          setState((previous) => {
            const draft = structuredClone(previous);
            change(draft);
            return draft;
          })
        }
      />
      <output data-testid="saved-layout">
        {JSON.stringify(state.table_plan?.table_layout)}
      </output>
    </>
  );
}

describe("table room map", () => {
  it("renames and moves tables while keeping seated guests visible", () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "Wedding party" },
    });
    const table = screen.getByRole("button", {
      name: /Wedding party, 2 of 2 seats/,
    });
    fireEvent.keyDown(table, { key: "ArrowRight" });
    fireEvent.keyDown(table, { key: "ArrowUp", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Rotate table" }));
    const layout = JSON.parse(
      screen.getByTestId("saved-layout").textContent || "{}",
    );
    expect(layout.top).toEqual({
      name: "Wedding party",
      x: 510,
      y: 100,
      rotation: 90,
    });
    expect(screen.getByText("Alex, Blair")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset positions" }));
    expect(
      JSON.parse(screen.getByTestId("saved-layout").textContent || "{}").top,
    ).toEqual({ name: "Wedding party" });
  });

  it("lets each guest table have its own name and shape", () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Edit table"), {
      target: { value: "table-1" },
    });
    expect(screen.getByLabelText("Table shape")).toHaveValue("round");
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "Dublin" },
    });
    fireEvent.change(screen.getByLabelText("Table shape"), {
      target: { value: "long" },
    });
    expect(
      JSON.parse(screen.getByTestId("saved-layout").textContent || "{}")[
        "table-1"
      ],
    ).toEqual({ name: "Dublin", shape: "long" });
  });
});

describe("table seat layout", () => {
  it.each([2, 10, 100])(
    "puts all %i top table seats along one long edge",
    (count) => {
      const seats = tableSeats("long", true, count);
      expect(seats).toHaveLength(count);
      expect(
        seats.every((seat) => seat.y === -48 && Math.abs(seat.x) <= 68),
      ).toBe(true);
      expect(new Set(seats.map((seat) => seat.x)).size).toBe(count);
    },
  );

  it("uses both long edges for guest tables", () => {
    const seats = tableSeats("long", false, 9);
    expect(seats.filter((seat) => seat.y < 0)).toHaveLength(5);
    expect(seats.filter((seat) => seat.y > 0)).toHaveLength(4);
  });

  it("keeps round tables seated around their circumference", () => {
    const seats = tableSeats("round", true, 8);
    expect(
      seats.every((seat) => Math.abs(Math.hypot(seat.x, seat.y) - 70) < 0.001),
    ).toBe(true);
  });

  it("normalizes free rotation for saving and reload", () => {
    expect(tableRotation(-35.5)).toBe(324.5);
    expect(tableRotation(405)).toBe(45);
    const plan = tablePlanSchema.parse({
      top_table_capacity: 10,
      top_table_guest_ids: [],
      table_capacities: [8],
      table_layout: { top: { rotation: tableRotation(-35.5) } },
    });
    expect(plan.table_layout?.top?.rotation).toBe(324.5);
  });
});

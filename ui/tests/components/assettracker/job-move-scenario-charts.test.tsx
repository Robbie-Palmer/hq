import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { JobMoveScenarioCharts } from "@/components/assettracker/job-move-scenario-charts";
import type { JobMoveScenarioComparison } from "@/lib/domain/assettracker";

vi.mock("recharts", async () => {
  const React = await import("react");
  const WithChildren = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  const XAxis = ({
    tickFormatter,
  }: {
    tickFormatter?: (value: string) => string;
  }) => <span>{tickFormatter?.("2027-01-01")}</span>;
  const YAxis = ({
    tickFormatter,
  }: {
    tickFormatter?: (value: number) => string;
  }) => <span>{tickFormatter?.(1_000)}</span>;
  return {
    Area: () => null,
    AreaChart: WithChildren,
    CartesianGrid: () => null,
    Line: () => null,
    LineChart: WithChildren,
    Legend: WithChildren,
    ReferenceLine: ({ label }: { label?: { value?: string } }) =>
      label?.value == null ? null : <span>{label.value}</span>,
    ResponsiveContainer: WithChildren,
    Tooltip: ({ content }: { content?: ReactNode }) => {
      if (!React.isValidElement(content)) return null;
      return React.cloneElement(
        content as ReactElement<Record<string, unknown>>,
        {
          active: true,
          payload: [
            {
              payload: {
                date: "2027-01-01",
                baseline: 100_000,
                scenario: 120_000,
                cash: 1_000,
                liquid: 2_000,
                illiquid: 3_000,
                unfunded: 4_000,
                liquidGain: 5_000,
                netWorthGain: 6_000,
              },
            },
          ],
        },
      );
    },
    XAxis,
    YAxis,
  };
});

function balance(
  totalBalance: number,
  spendingDrawdown = { cash: 0, liquid: 0, illiquid: 0, unfunded: 0 },
) {
  return {
    cashBalance: 20_000,
    totalBalance,
    liquidBalance: 40_000,
    liquidMonths: 20,
    totalMonths: 50,
    emergencyFundBalance: 10_000,
    emergencyFundMonths: 5,
    spendingDrawdown,
  };
}

function comparison(
  drawdown = false,
  target: number | null = 110_000,
): JobMoveScenarioComparison {
  return {
    scenarioId: "scenario",
    warnings: [],
    compensation: {
      baselineAnnualTakeHomePay: 36_000,
      baselineAnnualPensionContribution: 2_000,
      scenarioAnnualTakeHomePay: 48_000,
      scenarioAnnualEmployeePensionContribution: 4_000,
      scenarioAnnualEmployerPensionContribution: 4_000,
      currency: "GBP",
    },
    calculation: { kind: "not-applicable" },
    timeline: [
      {
        date: "2027-01-01",
        baseline: balance(100_000),
        scenario: balance(
          100_000,
          drawdown
            ? { cash: 1_000, liquid: 2_000, illiquid: 3_000, unfunded: 4_000 }
            : undefined,
        ),
      },
      {
        date: "2028-01-01",
        baseline: balance(110_000),
        scenario: balance(130_000),
      },
      {
        date: "2030-01-01",
        baseline: balance(130_000),
        scenario: balance(170_000),
      },
    ],
    milestones: [
      {
        date: "2027-01-01",
        kind: "income-stops",
        label: "Current pay stops",
        detail: "Current pay stops here.",
      },
      {
        date: "2027-01-01",
        kind: "new-role-starts",
        label: "New role starts",
        detail: "New pay starts here.",
      },
    ],
    financialIndependenceTarget: target,
    financialIndependenceDates: {
      baseline: null,
      scenario: "2028-01-01",
    },
  };
}

describe("JobMoveScenarioCharts", () => {
  it("charts growth, combines same-day markers, and filters the visible window", () => {
    render(<JobMoveScenarioCharts comparison={comparison()} currency="GBP" />);

    expect(screen.getByText("Asset growth from the move")).toBeVisible();
    expect(screen.getAllByText("1, 2")).toHaveLength(2);
    expect(screen.getAllByText("Additional net worth")).toHaveLength(2);
    expect(screen.getByText("£6,000")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Chart time window"), {
      target: { value: "1" },
    });
    expect(screen.getByLabelText("Chart time window")).toHaveValue("1");
  });

  it("charts all drawdown sources and supports an FI path without a target", () => {
    render(
      <JobMoveScenarioCharts
        comparison={comparison(true, null)}
        currency="GBP"
      />,
    );

    expect(screen.getByText("Drawdown funding over time")).toBeVisible();
    expect(screen.getAllByText("Cash reserves used")).toHaveLength(2);
    expect(screen.getByText("£1,000")).toBeVisible();
    expect(screen.getByText("£4,000")).toBeVisible();
    expect(
      screen.getByText(/Set an FI target to add the target line/),
    ).toBeVisible();
  });

  it("omits controls and milestone details when no timeline exists", () => {
    const empty = {
      ...comparison(),
      timeline: [],
      milestones: [],
    };
    render(<JobMoveScenarioCharts comparison={empty} currency="GBP" />);

    expect(screen.queryByLabelText("Chart time window")).toBeNull();
    expect(screen.queryByText("Forecast milestones")).toBeNull();
  });
});

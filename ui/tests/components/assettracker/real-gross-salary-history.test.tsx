import { fireEvent, render, screen } from "@testing-library/react";
import { latestOnsInflationRelease } from "finance-inflation-indices/dataset";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { RealGrossSalaryHistory } from "@/components/assettracker/real-gross-salary-history";
import type { SalaryHistoryRecord } from "@/lib/domain/assettracker";

const latestCpihRelease = latestOnsInflationRelease("CPIH");
if (latestCpihRelease == null) {
  throw new Error("The bundled CPIH release is required by this test");
}

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => (
    <div data-chart-data={JSON.stringify(data)} data-testid="salary-chart">
      {children}
    </div>
  ),
  Line: ({
    dataKey,
    strokeDasharray,
    type,
  }: {
    dataKey: string;
    strokeDasharray?: string;
    type: string;
  }) => (
    <div
      data-line-type={type}
      data-series={dataKey}
      data-stroke-dasharray={strokeDasharray}
    />
  ),
  CartesianGrid: () => null,
  Legend: () => null,
  Tooltip: ({
    content,
    labelFormatter,
  }: {
    content?: ReactNode;
    labelFormatter?: (value: number) => string;
  }) => (
    <div
      data-testid="salary-tooltip"
      data-tooltip-label={labelFormatter?.(Date.parse("2024-01-01"))}
    >
      {isValidElement(content)
        ? cloneElement(
            content as ReactElement<{
              active: boolean;
              payload: Array<{
                color: string;
                dataKey: string;
                value: number;
              }>;
            }>,
            {
              active: true,
              payload: [
                {
                  color: "blue",
                  dataKey: "nominal",
                  value: 60_000,
                },
                { color: "green", dataKey: "real", value: 62_000 },
                {
                  color: "blue",
                  dataKey: "assumedNominal",
                  value: 60_000,
                },
                {
                  color: "green",
                  dataKey: "assumedReal",
                  value: 62_000,
                },
              ],
            },
          )
        : content}
    </div>
  ),
  XAxis: ({
    dataKey,
    domain,
    scale,
    tickFormatter,
    ticks,
    type,
  }: {
    dataKey?: string;
    domain?: readonly number[];
    scale?: string;
    tickFormatter?: (date: number) => string;
    ticks?: readonly number[];
    type?: string;
  }) => (
    <div
      data-axis-domain={JSON.stringify(domain)}
      data-axis-key={dataKey}
      data-axis-scale={scale}
      data-axis-test-label={tickFormatter?.(Date.parse("2024-01-01"))}
      data-axis-ticks={JSON.stringify(ticks)}
      data-axis-type={type}
      data-testid="salary-x-axis"
    />
  ),
  YAxis: () => null,
}));

function salaryRecord(
  overrides: Partial<SalaryHistoryRecord> = {},
): SalaryHistoryRecord {
  return {
    id: "salary-2024",
    person: "Alex",
    employer: "Example Ltd",
    employmentId: "example",
    currency: "GBP",
    jurisdiction: "England",
    effectiveStart: "2024-04-01",
    effectiveEnd: "2025-03-31",
    payFrequency: "monthly",
    amountKind: "annualSalary",
    grossPay: 60_000,
    otherTaxableIncome: 0,
    otherDeductions: 0,
    nationalInsuranceCategory: "A",
    isCompanyDirector: false,
    employeePension: {
      arrangement: "salarySacrifice",
      amount: 6_000,
      basis: "grossPay",
    },
    employerPension: {
      arrangement: "other",
      amount: 3_000,
      basis: "grossPay",
    },
    source: { kind: "manual" },
    acceptedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("RealGrossSalaryHistory", () => {
  it("plots salary facts and exposes the calculation table and controls", () => {
    render(<RealGrossSalaryHistory salaryHistory={[salaryRecord()]} />);

    expect(screen.getByText("Salary over time")).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: "Nominal and inflation-adjusted annual salary rate for Alex",
      }),
    ).toBeVisible();
    expect(screen.getByLabelText("Salary inflation index")).toHaveTextContent(
      "CPIH",
    );
    expect(screen.getByLabelText("Salary reference month")).toHaveValue(
      latestCpihRelease.source.coverageThrough,
    );
    expect(screen.getByText("£60,000")).toBeVisible();
    expect(
      screen.getAllByText(
        new RegExp(
          `Dataset ${latestCpihRelease.versionId.replaceAll(".", "\\.")}`,
        ),
      )[0],
    ).toBeVisible();
    expect(screen.getAllByText(/Salary fact salary-2024/)[0]).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Hypothetical net salary with no employee pension",
      }),
    ).toBeVisible();
    const grossChart = screen.getByRole("img", {
      name: "Nominal and inflation-adjusted annual salary rate for Alex",
    });
    const netChart = screen.getByRole("img", {
      name: "Hypothetical nominal and inflation-adjusted net annual salary rate with no employee pension for Alex",
    });
    const netNominal = screen.getByRole("button", {
      name: "Hypothetical nominal net pay",
    });
    expect(netChart).toBeVisible();
    const [grossAxis, netAxis] = screen.getAllByTestId("salary-x-axis");
    expect(grossAxis).toHaveAttribute("data-axis-key", "timestamp");
    expect(grossAxis).toHaveAttribute("data-axis-type", "number");
    expect(grossAxis).toHaveAttribute("data-axis-scale", "time");
    expect(grossAxis).toHaveAttribute("data-axis-test-label", "Jan 24");
    expect(netAxis).toHaveAttribute(
      "data-axis-domain",
      grossAxis?.getAttribute("data-axis-domain"),
    );
    expect(grossAxis).toHaveAttribute("data-axis-ticks");
    expect(netAxis).toHaveAttribute(
      "data-axis-ticks",
      grossAxis?.getAttribute("data-axis-ticks"),
    );
    for (const tooltip of screen.getAllByTestId("salary-tooltip")) {
      expect(tooltip).toHaveAttribute("data-tooltip-label", "January 2024");
    }
    expect(netNominal).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(netNominal);
    expect(netChart.querySelector('[data-series="nominal"]')).toBeNull();
    expect(grossChart.querySelector('[data-series="nominal"]')).toBeVisible();
    expect(screen.getByText(/Employer pension remains separate/)).toBeVisible();
  });

  it("recalculates the table for another reference month", () => {
    render(<RealGrossSalaryHistory salaryHistory={[salaryRecord()]} />);
    const latestRealValue = screen.getAllByText(/^£[\d,]+$/)[1]?.textContent;

    fireEvent.change(screen.getByLabelText("Salary reference month"), {
      target: { value: "2024-04" },
    });

    expect(screen.getByLabelText("Salary reference month")).toHaveValue(
      "2024-04",
    );
    expect(screen.getAllByText(/^£[\d,]+$/)[1]?.textContent).not.toBe(
      latestRealValue,
    );

    fireEvent.change(screen.getByLabelText("Salary reference month"), {
      target: { value: "" },
    });
    expect(screen.getByLabelText("Salary reference month")).toHaveValue(
      "2024-04",
    );
  });

  it("bounds both chart axes by the selected reference month", () => {
    render(
      <RealGrossSalaryHistory
        salaryHistory={[salaryRecord({ effectiveEnd: undefined })]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Salary reference month"), {
      target: { value: "2025-03" },
    });

    const start = Date.parse("2024-04-01");
    const end = Date.parse("2025-03-01");
    const expectedDomain = JSON.stringify([start, end]);
    const axes = screen.getAllByTestId("salary-x-axis");
    for (const axis of axes) {
      expect(axis).toHaveAttribute("data-axis-domain", expectedDomain);
    }
    const ticks = JSON.parse(
      axes[0]?.getAttribute("data-axis-ticks") ?? "[]",
    ) as number[];
    expect(ticks).toHaveLength(4);
    expect(ticks[0]).toBe(start);
    expect(ticks.at(-1)).toBe(end);
    expect(axes[1]).toHaveAttribute(
      "data-axis-ticks",
      axes[0]?.getAttribute("data-axis-ticks"),
    );
  });

  it("interpolates known facts and toggles chart series from the legend", () => {
    render(
      <RealGrossSalaryHistory
        salaryHistory={[
          salaryRecord(),
          salaryRecord({
            id: "salary-2025",
            effectiveStart: "2025-04-01",
            effectiveEnd: "2026-03-31",
            grossPay: 65_000,
          }),
        ]}
      />,
    );

    const grossChart = screen.getByRole("img", {
      name: "Nominal and inflation-adjusted annual salary rate for Alex",
    });
    expect(grossChart.querySelector('[data-series="nominal"]')).toHaveAttribute(
      "data-line-type",
      "linear",
    );
    expect(grossChart.querySelector('[data-series="real"]')).toHaveAttribute(
      "data-line-type",
      "linear",
    );

    const nominal = screen.getByRole("button", { name: "Nominal gross pay" });
    const real = screen.getByRole("button", {
      name: "Inflation-adjusted gross pay",
    });
    expect(nominal).toHaveAttribute("aria-pressed", "true");
    expect(real).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(nominal);
    expect(nominal).toHaveAttribute("aria-pressed", "false");
    expect(grossChart.querySelector('[data-series="nominal"]')).toBeNull();
    expect(grossChart.querySelector('[data-series="real"]')).toBeVisible();

    fireEvent.click(nominal);
    fireEvent.click(real);
    expect(grossChart.querySelector('[data-series="nominal"]')).toBeVisible();
    expect(grossChart.querySelector('[data-series="real"]')).toBeNull();
  });

  it("marks an open-ended salary carried to the reference month as assumed", () => {
    render(
      <RealGrossSalaryHistory
        salaryHistory={[salaryRecord({ effectiveEnd: undefined })]}
      />,
    );
    const grossChart = screen.getByRole("img", {
      name: "Nominal and inflation-adjusted annual salary rate for Alex",
    });
    const chart = grossChart.querySelector('[data-testid="salary-chart"]');
    if (!(chart instanceof HTMLElement)) {
      throw new Error("Expected the gross salary chart");
    }
    const chartData = JSON.parse(chart.dataset.chartData ?? "[]");

    expect(chartData).toEqual([
      expect.objectContaining({
        id: "salary-2024",
        nominal: 60_000,
        assumedNominal: 60_000,
      }),
      expect.objectContaining({
        id: "salary-2024:assumed",
        date: `${latestCpihRelease.source.coverageThrough}-01`,
        assumedNominal: 60_000,
        assumedReal: 60_000,
      }),
    ]);
    expect(
      grossChart.querySelector('[data-series="assumedNominal"]'),
    ).toHaveAttribute("data-stroke-dasharray", "6 4");
    expect(
      screen.getByText(
        "Dashed segments assume the latest open-ended salary remained unchanged to the reference month.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("Nominal gross pay, assumed unchanged"),
    ).toBeNull();
    expect(
      screen.queryByText("Inflation-adjusted gross pay, assumed unchanged"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Nominal gross pay" }));
    expect(grossChart.querySelector('[data-series="nominal"]')).toBeNull();
    expect(
      grossChart.querySelector('[data-series="assumedNominal"]'),
    ).toBeNull();
    expect(grossChart.querySelector('[data-series="real"]')).toBeVisible();
    expect(
      grossChart.querySelector('[data-series="assumedReal"]'),
    ).toBeVisible();
  });

  it("keeps non-GBP salary facts visible as unavailable", () => {
    render(
      <RealGrossSalaryHistory
        salaryHistory={[salaryRecord({ currency: "USD" })]}
      />,
    );

    expect(screen.getByText("US$60,000")).toBeVisible();
    expect(screen.getAllByText("Unavailable")[0]).toBeVisible();
    expect(screen.getByText(/cannot adjust USD values/)).toBeVisible();
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      "1 salary record has no real-terms value",
    );
  });

  it("switches salary basis, person, and inflation index", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    render(
      <RealGrossSalaryHistory
        salaryHistory={[
          salaryRecord(),
          salaryRecord({
            id: "sam-period-pay",
            person: "Sam",
            amountKind: "periodPay",
            grossPay: 4_000,
          }),
        ]}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("Salary person"), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "Sam" }));
    expect(
      screen.getByText(/No annual salary rate records for Sam/),
    ).toBeVisible();

    fireEvent.keyDown(screen.getByLabelText("Gross salary figure"), {
      key: "ArrowDown",
    });
    fireEvent.click(
      screen.getByRole("option", { name: "Actual period earnings" }),
    );
    expect(screen.getByText("£4,000")).toBeVisible();

    fireEvent.keyDown(screen.getByLabelText("Salary inflation index"), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "RPI" }));
    expect(screen.getByText(/RPI is a legacy measure/)).toBeVisible();
  });

  it("links to salary import when no history exists", () => {
    render(<RealGrossSalaryHistory salaryHistory={[]} />);

    expect(screen.getByText("No salary history yet")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Import salary history" }),
    ).toHaveAttribute("href", "/assettracker/imports");
  });
});

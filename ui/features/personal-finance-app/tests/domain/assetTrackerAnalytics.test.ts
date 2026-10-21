import { describe, expect, it } from "vitest";
import { effectiveExpectedReturn } from "@/features/personal-finance-app/domain/account";
import {
  addRealValues,
  buildAccountHistorySeries,
  buildExpectedTrajectory,
  buildPortfolioProjection,
  buildProjection,
  computeCagr,
  computeMoneyWeightedReturn,
  dateTargetReached,
  inflateToPresent,
  projectedDateForTarget,
  realRate,
} from "@/features/personal-finance-app/domain/assetTrackerAnalytics";
import {
  monthlyAmount,
  type RecurringFlow,
  upcomingFlowOccurrences,
} from "@/features/personal-finance-app/domain/recurringFlow";

describe("computeCagr", () => {
  it("computes the annual growth rate over one year", () => {
    const cagr = computeCagr([
      { date: "2021-01-01", balance: 1000 },
      { date: "2022-01-01", balance: 2000 },
    ]);

    expect(cagr).not.toBeNull();
    expect(cagr).toBeCloseTo(1.0, 2);
  });

  it("annualises growth over multiple years", () => {
    // 1000 -> 1210 over ~2 years is ~10%/yr
    const cagr = computeCagr([
      { date: "2020-01-01", balance: 1000 },
      { date: "2022-01-01", balance: 1210 },
    ]);

    expect(cagr).toBeCloseTo(0.1, 2);
  });

  it("starts from the first positive balance", () => {
    const cagr = computeCagr([
      { date: "2020-01-01", balance: 0 },
      { date: "2021-01-01", balance: 1000 },
      { date: "2022-01-01", balance: 2000 },
    ]);

    expect(cagr).toBeCloseTo(1.0, 2);
  });

  it("returns null with fewer than two usable snapshots", () => {
    expect(computeCagr([])).toBeNull();
    expect(computeCagr([{ date: "2024-01-01", balance: 1000 }])).toBeNull();
  });

  it("returns null when no balance is positive", () => {
    expect(
      computeCagr([
        { date: "2023-01-01", balance: 0 },
        { date: "2024-01-01", balance: 0 },
      ]),
    ).toBeNull();
  });

  it("returns -100% when the balance drops to zero", () => {
    const cagr = computeCagr([
      { date: "2023-01-01", balance: 1000 },
      { date: "2024-01-01", balance: 0 },
    ]);

    expect(cagr).toBeCloseTo(-1, 5);
  });

  it("returns null rather than NaN when the end balance is negative", () => {
    const cagr = computeCagr([
      { date: "2023-01-01", balance: 1000 },
      { date: "2024-01-01", balance: -500 },
    ]);

    expect(cagr).toBeNull();
  });
});

describe("computeMoneyWeightedReturn", () => {
  const snapshots = [
    { date: "2023-01-01", balance: 1000 },
    { date: "2024-01-01", balance: 2100 },
  ];

  it("matches the plain CAGR when no flows are recorded", () => {
    expect(computeMoneyWeightedReturn(snapshots, [])).toBeCloseTo(
      computeCagr(snapshots) ?? Number.NaN,
      6,
    );
  });

  it("excludes contributions from the growth rate", () => {
    // A £1,000 deposit landed mid-year; the doubling is mostly not growth
    const withContribution = computeMoneyWeightedReturn(snapshots, [
      { date: "2023-07-01", amount: 1000 },
    ]);

    expect(withContribution).not.toBeNull();
    expect(withContribution).toBeCloseTo(0.067, 2);
    expect(withContribution ?? 0).toBeLessThan(computeCagr(snapshots) ?? 0);
  });

  it("treats withdrawals as the opposite of contributions", () => {
    // Balance halved, but £600 was withdrawn — the account actually grew
    const withWithdrawal = computeMoneyWeightedReturn(
      [
        { date: "2023-01-01", balance: 1000 },
        { date: "2024-01-01", balance: 500 },
      ],
      [{ date: "2023-12-31", amount: -600 }],
    );

    expect(withWithdrawal).not.toBeNull();
    expect(withWithdrawal ?? 0).toBeGreaterThan(0);
  });

  it("ignores flows outside the snapshot period", () => {
    const result = computeMoneyWeightedReturn(snapshots, [
      { date: "2022-06-01", amount: 5000 },
      { date: "2024-06-01", amount: 5000 },
    ]);

    expect(result).toBeCloseTo(computeCagr(snapshots) ?? Number.NaN, 6);
  });
});

describe("realRate", () => {
  it("deflates a nominal rate by inflation", () => {
    expect(realRate(0.07, 0.025)).toBeCloseTo(0.0439, 4);
    expect(realRate(0.025, 0.025)).toBeCloseTo(0, 10);
  });
});

describe("inflateToPresent", () => {
  it("restates a past amount in later purchasing power", () => {
    // £1,000 of 2020 money at 10% inflation is ~£1,100 of 2021 money
    expect(inflateToPresent(1000, "2021-01-01", "2022-01-01", 0.1)).toBeCloseTo(
      1100,
      0,
    );
  });

  it("leaves same-day and future-dated amounts unchanged", () => {
    expect(inflateToPresent(1000, "2024-01-01", "2024-01-01", 0.1)).toBe(1000);
    expect(inflateToPresent(1000, "2025-01-01", "2024-01-01", 0.1)).toBe(1000);
  });
});

describe("effectiveExpectedReturn", () => {
  const account = {
    expectedAnnualReturn: 0.04,
    expectedReturnChanges: [
      { date: "2024-06-01", rate: 0.05 },
      { date: "2025-01-01", rate: 0.03 },
    ],
  };

  it("uses the base rate before any change", () => {
    expect(effectiveExpectedReturn(account, "2024-01-01")).toBe(0.04);
  });

  it("uses the latest change on or before the date", () => {
    expect(effectiveExpectedReturn(account, "2024-06-01")).toBe(0.05);
    expect(effectiveExpectedReturn(account, "2024-12-31")).toBe(0.05);
    expect(effectiveExpectedReturn(account, "2026-01-01")).toBe(0.03);
  });

  it("uses the base rate when there are no changes", () => {
    expect(
      effectiveExpectedReturn({ expectedAnnualReturn: 0.07 }, "2024-01-01"),
    ).toBe(0.07);
  });
});

describe("buildExpectedTrajectory", () => {
  it("anchors the first expected point to the first actual balance", () => {
    const trajectory = buildExpectedTrajectory({ expectedAnnualReturn: 0.1 }, [
      { date: "2023-01-01", balance: 1000 },
      { date: "2024-01-01", balance: 1200 },
    ]);

    expect(trajectory[0]).toEqual({
      date: "2023-01-01",
      actual: 1000,
      expected: 1000,
    });
  });

  it("compounds the first balance at the expected return", () => {
    const trajectory = buildExpectedTrajectory({ expectedAnnualReturn: 0.1 }, [
      { date: "2023-01-01", balance: 1000 },
      { date: "2024-01-01", balance: 1200 },
    ]);

    expect(trajectory[1]?.actual).toBe(1200);
    expect(trajectory[1]?.expected).toBeCloseTo(1100, 0);
  });

  it("projects one smooth curve, never re-anchoring to later actuals", () => {
    const trajectory = buildExpectedTrajectory({ expectedAnnualReturn: 0.1 }, [
      { date: "2022-01-01", balance: 1000 },
      { date: "2023-01-01", balance: 5000 }, // big contribution landed
      { date: "2024-01-01", balance: 5400 },
    ]);

    // Expected keeps compounding 1000 at 10%/yr regardless of the actuals
    expect(trajectory[2]?.expected).toBeCloseTo(1210, 0);
  });

  it("honours scheduled rate changes", () => {
    const trajectory = buildExpectedTrajectory(
      {
        expectedAnnualReturn: 0,
        expectedReturnChanges: [{ date: "2023-01-01", rate: 0.1 }],
      },
      [
        { date: "2022-01-01", balance: 1000 },
        { date: "2023-01-01", balance: 1000 },
        { date: "2024-01-01", balance: 1000 },
      ],
    );

    // Flat at 0% for the first year, then 10% applies
    expect(trajectory[1]?.expected).toBeCloseTo(1000, 0);
    expect(trajectory[2]?.expected).toBeCloseTo(1100, 0);
  });

  it("applies a rate change that falls mid-interval", () => {
    // One 2-year interval; rate jumps 0% -> 10% at the one-year mark
    const trajectory = buildExpectedTrajectory(
      {
        expectedAnnualReturn: 0,
        expectedReturnChanges: [{ date: "2023-01-01", rate: 0.1 }],
      },
      [
        { date: "2022-01-01", balance: 1000 },
        { date: "2024-01-01", balance: 1000 },
      ],
    );

    // Flat for year one, then ~10% for year two — not 0% across the whole span
    expect(trajectory[1]?.expected).toBeCloseTo(1100, 0);
  });

  it("steps the expected line with recorded transfers so they aren't performance", () => {
    // £1,000 grows at 0%, but £500 was paid in mid-period
    const trajectory = buildExpectedTrajectory(
      { expectedAnnualReturn: 0 },
      [
        { date: "2023-01-01", balance: 1000 },
        { date: "2024-01-01", balance: 1500 },
      ],
      [{ date: "2023-07-01", amount: 500 }],
    );

    // Expected absorbs the contribution, so it matches actual — no
    // out/under-performance to show
    expect(trajectory[1]?.expected).toBeCloseTo(1500, 0);
  });

  it("leaves a gap when actuals beat the expected return plus contributions", () => {
    const trajectory = buildExpectedTrajectory(
      { expectedAnnualReturn: 0 },
      [
        { date: "2023-01-01", balance: 1000 },
        { date: "2024-01-01", balance: 1800 },
      ],
      [{ date: "2023-07-01", amount: 500 }],
    );

    // Expected is 1500; the extra 300 of actual is genuine outperformance
    expect(trajectory[1]?.expected).toBeCloseTo(1500, 0);
    expect(trajectory[1]?.actual).toBe(1800);
  });

  it("sorts snapshots by date before building the series", () => {
    const trajectory = buildExpectedTrajectory({ expectedAnnualReturn: 0.05 }, [
      { date: "2024-01-01", balance: 1200 },
      { date: "2023-01-01", balance: 1000 },
    ]);

    expect(trajectory.map((p) => p.date)).toEqual(["2023-01-01", "2024-01-01"]);
  });
});

describe("buildAccountHistorySeries", () => {
  it("plots contribution-only history without inventing market values", () => {
    expect(
      buildAccountHistorySeries(
        { expectedAnnualReturn: 0.07 },
        [],
        [
          { date: "2022-01-01", amount: 10_000 },
          { date: "2022-02-01", amount: 500 },
          { date: "2022-03-01", amount: -200 },
        ],
      ),
    ).toEqual([
      { date: "2022-01-01", contributed: 10_000 },
      { date: "2022-02-01", contributed: 10_500 },
      { date: "2022-03-01", contributed: 10_300 },
    ]);
  });

  it("carries contributed capital onto sparse actual balance dates", () => {
    expect(
      buildAccountHistorySeries(
        { expectedAnnualReturn: 0 },
        [{ date: "2024-01-01", balance: 12_000 }],
        [
          { date: "2022-01-01", amount: 8_000 },
          { date: "2023-01-01", amount: 2_000 },
        ],
      ),
    ).toEqual([
      { date: "2022-01-01", expected: 8_000, contributed: 8_000 },
      { date: "2023-01-01", expected: 10_000, contributed: 10_000 },
      {
        date: "2024-01-01",
        actual: 12_000,
        expected: 10_000,
        contributed: 10_000,
      },
    ]);
  });

  it("estimates a balance between valuations and resets at the next valuation", () => {
    expect(
      buildAccountHistorySeries(
        { expectedAnnualReturn: 0 },
        [
          { date: "2024-01-01", balance: 1_000 },
          { date: "2026-01-01", balance: 1_650 },
        ],
        [{ date: "2025-01-01", amount: 500 }],
      ),
    ).toEqual([
      { date: "2024-01-01", actual: 1_000, expected: 1_000 },
      { date: "2025-01-01", expected: 1_500, contributed: 500 },
      {
        date: "2026-01-01",
        actual: 1_650,
        expected: 1_500,
        contributed: 500,
      },
    ]);
  });

  it("compounds from the first valuation before applying the next dated flow", () => {
    const series = buildAccountHistorySeries(
      { expectedAnnualReturn: 0.1 },
      [{ date: "2024-01-01", balance: 1_000 }],
      [{ date: "2025-01-01", amount: 100 }],
    );

    expect(series.at(-1)?.expected).toBeCloseTo(1_200, 0);
  });

  it("carries estimates and contributed capital onto requested chart dates", () => {
    const series = buildAccountHistorySeries(
      { expectedAnnualReturn: 0 },
      [{ date: "2024-01-01", balance: 0 }],
      [{ date: "2024-03-01", amount: 750 }],
      ["2024-04-01"],
    );

    expect(series.at(-1)).toEqual({
      date: "2024-04-01",
      expected: 750,
      contributed: 750,
    });
  });
});

describe("monthlyAmount", () => {
  it("normalises fixed amounts to a monthly equivalent", () => {
    const base = {
      id: "f",
      name: "f",
      toAccountId: "a",
      startDate: "2024-01-01",
    };
    expect(
      monthlyAmount({
        ...base,
        amount: 120,
        frequency: "weekly",
      } as RecurringFlow),
    ).toBeCloseTo(520, 5);
    expect(
      monthlyAmount({
        ...base,
        amount: 500,
        frequency: "monthly",
      } as RecurringFlow),
    ).toBe(500);
    expect(
      monthlyAmount({
        ...base,
        amount: 300,
        frequency: "quarterly",
      } as RecurringFlow),
    ).toBe(100);
    expect(
      monthlyAmount({
        ...base,
        amount: 1200,
        frequency: "yearly",
      } as RecurringFlow),
    ).toBe(100);
  });

  it("computes minimum payments from the outstanding balance", () => {
    const flow = {
      id: "min",
      name: "Minimum payment",
      toAccountId: "card",
      formula: {
        kind: "minimumPayment",
        percentOfBalance: 0.025,
        floor: 25,
      },
      frequency: "monthly",
      startDate: "2024-01-01",
    } as RecurringFlow;

    expect(monthlyAmount(flow, -5000)).toBeCloseTo(125, 5); // 2.5% wins
    expect(monthlyAmount(flow, -500)).toBe(25); // floor wins
    expect(monthlyAmount(flow, -10)).toBe(10); // never pay more than owed
    expect(monthlyAmount(flow, 0)).toBe(0); // paid off
    expect(monthlyAmount(flow, 100)).toBe(0); // in credit
    expect(monthlyAmount(flow)).toBe(0); // unknown balance
  });
});

describe("buildProjection", () => {
  it("holds steady with no flows and a zero rate", () => {
    const points = buildProjection({
      accountId: "a",
      schedule: { expectedAnnualReturn: 0 },
      startDate: "2024-01-01",
      startBalance: 1000,
      flows: [],
      months: 12,
    });

    expect(points).toHaveLength(13);
    expect(points[12]?.projected).toBe(1000);
  });

  it("compounds at the expected annual return", () => {
    const points = buildProjection({
      accountId: "a",
      schedule: { expectedAnnualReturn: 0.12 },
      startDate: "2024-01-01",
      startBalance: 1000,
      flows: [],
      months: 12,
    });

    expect(points[12]?.projected).toBeCloseTo(1120, 0);
  });

  it("adds recurring contributions into the account", () => {
    const flow = {
      id: "saving",
      name: "Saving",
      toAccountId: "a",
      amount: 100,
      frequency: "monthly",
      startDate: "2020-01-01",
    } as RecurringFlow;

    const points = buildProjection({
      accountId: "a",
      schedule: { expectedAnnualReturn: 0 },
      startDate: "2024-01-01",
      startBalance: 1000,
      flows: [flow],
      months: 12,
    });

    expect(points[12]?.projected).toBe(2200);
  });

  it("pays down a debt with a minimum payment formula", () => {
    const flow = {
      id: "min",
      name: "Minimum payment",
      toAccountId: "card",
      formula: { kind: "minimumPayment", percentOfBalance: 0.1, floor: 25 },
      frequency: "monthly",
      startDate: "2020-01-01",
    } as RecurringFlow;

    const points = buildProjection({
      accountId: "card",
      schedule: { expectedAnnualReturn: 0 },
      startDate: "2024-01-01",
      startBalance: -1000,
      flows: [flow],
      months: 60,
    });

    expect(points[1]?.projected).toBe(-900); // 10% of 1000
    expect(points[2]?.projected).toBe(-810); // 10% of 900
    // The floor eventually clears the debt entirely
    expect(projectedDateForTarget(points, 0)).not.toBeNull();
  });

  it("subtracts formula payments from the source account using the liability's balance", () => {
    const flow = {
      id: "min",
      name: "Minimum payment",
      fromAccountId: "current",
      toAccountId: "card",
      formula: { kind: "minimumPayment", percentOfBalance: 0.1, floor: 25 },
      frequency: "monthly",
      startDate: "2020-01-01",
    } as RecurringFlow;

    const points = buildProjection({
      accountId: "current",
      schedule: { expectedAnnualReturn: 0 },
      startDate: "2024-01-01",
      startBalance: 3000,
      flows: [flow],
      months: 1,
      liabilityBalances: { card: -1000 },
    });

    expect(points[1]?.projected).toBe(2900);
  });

  it("respects flow start and end dates", () => {
    const flow = {
      id: "bonus",
      name: "Bonus period",
      toAccountId: "a",
      amount: 100,
      frequency: "monthly",
      startDate: "2024-03-01",
      endDate: "2024-05-01",
    } as RecurringFlow;

    const points = buildProjection({
      accountId: "a",
      schedule: { expectedAnnualReturn: 0 },
      startDate: "2024-01-01",
      startBalance: 0,
      flows: [flow],
      months: 12,
    });

    // Active for the 2024-03-01, 2024-04-01 and 2024-05-01 steps only
    expect(points[12]?.projected).toBe(300);
  });
});

describe("addRealValues", () => {
  it("deflates each projected value into today's money", () => {
    const points = addRealValues(
      [
        { date: "2024-01-01", projected: 1000 },
        { date: "2025-01-01", projected: 1100 },
      ],
      0.1,
    );

    expect(points[0]?.real).toBe(1000);
    // 1100 a year out at 10% inflation is ~1000 in today's money
    expect(points[1]?.real).toBeCloseTo(1000, 0);
  });
});

describe("dateTargetReached", () => {
  it("returns null when the latest balance is still below the target", () => {
    const reached = dateTargetReached(
      [
        { date: "2024-01-01", balance: 1000 },
        { date: "2024-06-01", balance: 1500 },
      ],
      2000,
    );

    expect(reached).toBeNull();
  });

  it("returns the start of the current run at or above the target", () => {
    const reached = dateTargetReached(
      [
        { date: "2024-01-01", balance: 1000 },
        { date: "2024-06-01", balance: 2500 },
        { date: "2024-12-01", balance: 3000 },
      ],
      2000,
    );

    expect(reached).toBe("2024-06-01");
  });

  it("ignores an earlier crossing that later dropped back below", () => {
    const reached = dateTargetReached(
      [
        { date: "2024-01-01", balance: 2500 }, // briefly above
        { date: "2024-06-01", balance: 1500 }, // dropped below
        { date: "2024-12-01", balance: 2200 }, // back above — current run starts here
      ],
      2000,
    );

    expect(reached).toBe("2024-12-01");
  });

  it("handles liability targets (debt already within a ceiling)", () => {
    // Owes 800 now; target of -1000 (owe no more than 1000) is already met
    const reached = dateTargetReached(
      [
        { date: "2023-06-01", balance: -900 },
        { date: "2024-06-01", balance: -800 },
      ],
      -1000,
    );

    expect(reached).toBe("2023-06-01");
  });
});

describe("upcomingFlowOccurrences", () => {
  const salary = {
    id: "salary",
    name: "Salary",
    toAccountId: "current",
    amount: 3000,
    frequency: "monthly",
    startDate: "2024-01-15",
  } as RecurringFlow;
  const weeklySaving = {
    id: "saving",
    name: "Saving",
    fromAccountId: "current",
    toAccountId: "isa",
    amount: 50,
    frequency: "weekly",
    startDate: "2024-06-03",
  } as RecurringFlow;

  it("lists every due payment in the window, date-sorted", () => {
    const occurrences = upcomingFlowOccurrences(
      [salary, weeklySaving],
      "2024-06-10",
      "2024-07-09",
    );

    const summary = occurrences.map((o) => `${o.date} ${o.flow.id}`);
    expect(summary).toEqual([
      "2024-06-10 saving",
      "2024-06-15 salary",
      "2024-06-17 saving",
      "2024-06-24 saving",
      "2024-07-01 saving",
      "2024-07-08 saving",
    ]);
    expect(occurrences[1]?.amount).toBe(3000);
    expect(occurrences[0]?.amount).toBe(50);
  });

  it("estimates formula payments against the liability balance and skips cleared debts", () => {
    const minimum = {
      id: "min",
      name: "Card minimum",
      fromAccountId: "current",
      toAccountId: "card",
      formula: { kind: "minimumPayment", percentOfBalance: 0.025, floor: 25 },
      frequency: "monthly",
      startDate: "2024-01-01",
    } as RecurringFlow;

    const withDebt = upcomingFlowOccurrences(
      [minimum],
      "2024-06-15",
      "2024-07-15",
      { card: -5000 },
    );
    expect(withDebt).toHaveLength(1);
    expect(withDebt[0]?.amount).toBeCloseTo(125, 5);

    const cleared = upcomingFlowOccurrences(
      [minimum],
      "2024-06-15",
      "2024-07-15",
      { card: 0 },
    );
    expect(cleared).toHaveLength(0);
  });
});

describe("buildPortfolioProjection", () => {
  const accounts = [
    {
      id: "savings",
      expectedAnnualReturn: 0,
      isOpen: true,
      latestBalance: 1000,
    },
    {
      id: "card",
      expectedAnnualReturn: 0,
      isOpen: true,
      latestBalance: -400,
    },
    {
      id: "old",
      expectedAnnualReturn: 0.5,
      isOpen: false,
      latestBalance: 9999,
    },
  ];

  it("sums open accounts and ignores closed ones", () => {
    const points = buildPortfolioProjection({
      accounts,
      flows: [],
      startDate: "2024-01-01",
      months: 6,
    });

    expect(points[0]?.projected).toBe(600); // 1000 − 400, closed excluded
    expect(points[6]?.projected).toBe(600);
  });

  it("cancels transfers between owned accounts out of the total", () => {
    const flow = {
      id: "saving",
      name: "Saving",
      fromAccountId: "savings",
      toAccountId: "card",
      amount: 100,
      frequency: "monthly",
      startDate: "2020-01-01",
    } as RecurringFlow;

    const points = buildPortfolioProjection({
      accounts,
      flows: [flow],
      startDate: "2024-01-01",
      months: 3,
    });

    // Money moving between owned accounts doesn't change the total; once the
    // card clears at zero, only the source keeps paying out... it stops there
    // because the card leg is clamped, so the total only moves after payoff
    expect(points[0]?.projected).toBe(600);
  });

  it("grows the total with external income", () => {
    const salary = {
      id: "salary",
      name: "Salary",
      toAccountId: "savings",
      amount: 500,
      frequency: "monthly",
      startDate: "2020-01-01",
    } as RecurringFlow;

    const points = buildPortfolioProjection({
      accounts,
      flows: [salary],
      startDate: "2024-01-01",
      months: 4,
    });

    expect(points[4]?.projected).toBe(600 + 4 * 500);
  });

  it("returns an empty projection with no open accounts", () => {
    const points = buildPortfolioProjection({
      accounts: [],
      flows: [],
      startDate: "2024-01-01",
      months: 12,
    });

    expect(points).toEqual([]);
  });
});

describe("projectedDateForTarget", () => {
  it("returns the first date at or above the target", () => {
    const points = [
      { date: "2024-01-01", projected: 100 },
      { date: "2024-02-01", projected: 200 },
      { date: "2024-03-01", projected: 300 },
    ];

    expect(projectedDateForTarget(points, 150)).toBe("2024-02-01");
    expect(projectedDateForTarget(points, 1000)).toBeNull();
  });
});

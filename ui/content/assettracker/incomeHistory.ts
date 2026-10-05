import type { IncomeRecord } from "@/lib/domain/assettracker/incomeRecord";

/**
 * Six-month household take-home income totals. The gradual nominal pay rises
 * cross the 2021-23 inflation spike, which makes the CPIH comparison useful.
 */
export const incomeHistory: IncomeRecord[] = [
  { date: "2020-06-01", amount: 14_400, currency: "GBP" },
  { date: "2020-12-01", amount: 14_400, currency: "GBP" },
  { date: "2021-06-01", amount: 15_000, currency: "GBP" },
  { date: "2021-12-01", amount: 15_000, currency: "GBP" },
  { date: "2022-06-01", amount: 15_600, currency: "GBP" },
  { date: "2022-12-01", amount: 15_600, currency: "GBP" },
  { date: "2023-06-01", amount: 17_100, currency: "GBP" },
  { date: "2023-12-01", amount: 17_100, currency: "GBP" },
  { date: "2024-06-01", amount: 19_200, currency: "GBP" },
  { date: "2024-12-01", amount: 19_200, currency: "GBP" },
];

import type { RecurringFlow } from "@/lib/domain/assettracker/recurringFlow";

export const recurringFlows: RecurringFlow[] = [
  {
    id: "salary",
    name: "Salary",
    toAccountId: "nationwide-current",
    amount: 3200,
    currency: "GBP",
    frequency: "monthly",
    startDate: "2024-01-01",
  },
  {
    id: "isa-contribution",
    name: "ISA contribution",
    fromAccountId: "nationwide-current",
    toAccountId: "trading-212-isa",
    amount: 500,
    currency: "GBP",
    frequency: "monthly",
    startDate: "2024-01-01",
  },
  {
    id: "mortgage-payment",
    name: "Mortgage payment",
    fromAccountId: "nationwide-current",
    toAccountId: "home-mortgage",
    amount: 1150,
    currency: "GBP",
    frequency: "monthly",
    startDate: "2023-03-01",
  },
  {
    id: "amex-minimum-payment",
    name: "Amex minimum payment",
    fromAccountId: "nationwide-current",
    toAccountId: "amex-credit-card",
    // Greater of 2.5% of the outstanding balance or £25
    formula: { kind: "minimumPayment", percentOfBalance: 0.025, floor: 25 },
    currency: "GBP",
    frequency: "monthly",
    startDate: "2023-06-01",
  },
];

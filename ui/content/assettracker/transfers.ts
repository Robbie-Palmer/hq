import type { Transfer } from "@/lib/domain/assettracker/transfer";

export const transfers: Transfer[] = [
  {
    id: "gbp-to-us-brokerage-2024-09-15",
    date: "2024-09-15",
    fromAccountId: "nationwide-current",
    toAccountId: "us-brokerage",
    amount: 1000,
    fromAmount: 1000,
    toAmount: 1270,
    feeAmount: 4,
    conversionProvider: "Wise",
  },
];

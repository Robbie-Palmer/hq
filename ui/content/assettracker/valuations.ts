import type {
  ExchangeRateObservation,
  HoldingObservation,
  Instrument,
  PriceObservation,
} from "@/lib/domain/assettracker/valuation";

export const instruments: Instrument[] = [
  {
    id: "us-total-market-etf",
    symbol: "VTI",
    name: "US Total Market ETF",
    currency: "USD",
  },
];

const brokerStatementSource = {
  kind: "import" as const,
  id: "demo-broker-statement",
  label: "Demo broker statement",
};

export const holdingObservations: HoldingObservation[] = [
  {
    id: "us-total-market-holding-2024-06-01",
    accountId: "us-brokerage",
    instrumentId: "us-total-market-etf",
    quantity: 16,
    validAt: "2024-06-01",
    acceptedAt: "2024-06-01T18:00:00Z",
    source: brokerStatementSource,
  },
  {
    id: "us-total-market-holding-2024-09-15",
    accountId: "us-brokerage",
    instrumentId: "us-total-market-etf",
    quantity: 18,
    validAt: "2024-09-15",
    acceptedAt: "2024-09-15T18:00:00Z",
    source: brokerStatementSource,
  },
  {
    id: "us-total-market-holding-2024-12-01",
    accountId: "us-brokerage",
    instrumentId: "us-total-market-etf",
    quantity: 20,
    validAt: "2024-12-01",
    acceptedAt: "2024-12-01T18:00:00Z",
    source: brokerStatementSource,
  },
];

const marketDataSource = {
  kind: "provider" as const,
  id: "demo-market-data",
  label: "Demo market close",
};

export const priceObservations: PriceObservation[] = [
  {
    id: "us-total-market-price-2024-06-01",
    instrumentId: "us-total-market-etf",
    price: 500,
    currency: "USD",
    validAt: "2024-06-01",
    acceptedAt: "2024-06-01T18:05:00Z",
    source: marketDataSource,
  },
  {
    id: "us-total-market-price-2024-09-15",
    instrumentId: "us-total-market-etf",
    price: 515,
    currency: "USD",
    validAt: "2024-09-15",
    acceptedAt: "2024-09-15T18:05:00Z",
    source: marketDataSource,
  },
  {
    id: "us-total-market-price-2024-12-01-original",
    instrumentId: "us-total-market-etf",
    price: 540,
    currency: "USD",
    validAt: "2024-12-01",
    acceptedAt: "2024-12-01T18:05:00Z",
    source: marketDataSource,
  },
  {
    id: "us-total-market-price-2024-12-01-corrected",
    instrumentId: "us-total-market-etf",
    price: 550,
    currency: "USD",
    validAt: "2024-12-01",
    acceptedAt: "2024-12-02T09:00:00Z",
    source: marketDataSource,
    correctsId: "us-total-market-price-2024-12-01-original",
  },
];

const exchangeRateSource = {
  kind: "reference" as const,
  id: "demo-fx-reference",
  label: "Demo FX reference",
};

const triangulatedRateSource = {
  kind: "reference" as const,
  id: "demo-fx-triangulated",
  label: "Demo triangulated FX reference",
};

const directRateHistory = [
  { date: "2020-06-01", gbpUsd: 1.25, gbpEur: 1.12 },
  { date: "2020-12-01", gbpUsd: 1.34, gbpEur: 1.11 },
  { date: "2021-06-01", gbpUsd: 1.42, gbpEur: 1.16 },
  { date: "2021-12-01", gbpUsd: 1.33, gbpEur: 1.17 },
  { date: "2022-06-01", gbpUsd: 1.25, gbpEur: 1.16 },
  { date: "2022-12-01", gbpUsd: 1.21, gbpEur: 1.16 },
  { date: "2023-03-01", gbpUsd: 1.2, gbpEur: 1.13 },
  { date: "2023-06-01", gbpUsd: 1.25, gbpEur: 1.16 },
  { date: "2023-12-01", gbpUsd: 1.27, gbpEur: 1.16 },
  { date: "2024-03-01", gbpUsd: 1.26, gbpEur: 1.17 },
] as const;

const directObservations = directRateHistory.flatMap<ExchangeRateObservation>(
  ({ date, gbpUsd, gbpEur }) => [
    {
      id: `gbp-usd-${date}`,
      fromCurrency: "GBP",
      toCurrency: "USD",
      rate: gbpUsd,
      validAt: date,
      acceptedAt: `${date}T18:10:00Z`,
      source: exchangeRateSource,
    },
    {
      id: `gbp-eur-${date}`,
      fromCurrency: "GBP",
      toCurrency: "EUR",
      rate: gbpEur,
      validAt: date,
      acceptedAt: `${date}T18:10:00Z`,
      source: exchangeRateSource,
    },
  ],
);

export const exchangeRateObservations: ExchangeRateObservation[] = [
  ...directObservations,
  {
    id: "gbp-usd-2024-06-01",
    fromCurrency: "GBP",
    toCurrency: "USD",
    rate: 1.27,
    validAt: "2024-06-01",
    acceptedAt: "2024-06-01T18:10:00Z",
    source: exchangeRateSource,
    providerObservations: [
      {
        provider: "ECB",
        observedDate: "2024-05-31",
        rate: 1.27,
        carried: true,
        excluded: false,
      },
    ],
  },
  {
    id: "gbp-eur-2024-06-01",
    fromCurrency: "GBP",
    toCurrency: "EUR",
    rate: 1.18,
    validAt: "2024-06-01",
    acceptedAt: "2024-06-01T18:10:00Z",
    source: exchangeRateSource,
    providerObservations: [
      {
        provider: "ECB",
        observedDate: "2024-05-31",
        rate: 1.18,
        carried: true,
        excluded: false,
      },
    ],
  },
  {
    id: "usd-eur-2024-06-01",
    fromCurrency: "USD",
    toCurrency: "EUR",
    rate: 1.18 / 1.27,
    validAt: "2024-06-01",
    acceptedAt: "2024-06-01T18:10:00Z",
    source: triangulatedRateSource,
    derivation: {
      method: "triangulated",
      legs: ["gbp-usd-2024-06-01", "gbp-eur-2024-06-01"],
    },
  },
  {
    id: "gbp-eur-2024-09-15",
    fromCurrency: "GBP",
    toCurrency: "EUR",
    rate: 1.18,
    validAt: "2024-09-15",
    acceptedAt: "2024-09-15T18:10:00Z",
    source: exchangeRateSource,
    providerObservations: [
      {
        provider: "ECB",
        observedDate: "2024-09-13",
        rate: 1.18,
        carried: true,
        excluded: false,
      },
    ],
  },
  {
    id: "eur-usd-2024-09-15",
    fromCurrency: "EUR",
    toCurrency: "USD",
    rate: 1.31 / 1.18,
    validAt: "2024-09-15",
    acceptedAt: "2024-09-15T18:10:00Z",
    source: exchangeRateSource,
    providerObservations: [
      {
        provider: "ECB",
        observedDate: "2024-09-13",
        rate: 1.31 / 1.18,
        carried: true,
        excluded: false,
      },
    ],
  },
  {
    id: "gbp-usd-2024-09-15",
    fromCurrency: "GBP",
    toCurrency: "USD",
    rate: 1.31,
    validAt: "2024-09-15",
    acceptedAt: "2024-09-15T18:10:00Z",
    source: triangulatedRateSource,
    derivation: {
      method: "triangulated",
      legs: ["gbp-eur-2024-09-15", "eur-usd-2024-09-15"],
    },
  },
  {
    id: "gbp-usd-2024-12-01-original",
    fromCurrency: "GBP",
    toCurrency: "USD",
    rate: 1.3,
    validAt: "2024-12-01",
    acceptedAt: "2024-12-01T18:10:00Z",
    source: exchangeRateSource,
  },
  {
    id: "gbp-usd-2024-12-01-corrected",
    fromCurrency: "GBP",
    toCurrency: "USD",
    rate: 1.28,
    validAt: "2024-12-01",
    acceptedAt: "2024-12-02T09:00:00Z",
    source: exchangeRateSource,
    correctsId: "gbp-usd-2024-12-01-original",
    providerObservations: [
      {
        provider: "ECB",
        observedDate: "2024-11-29",
        rate: 1.28,
        carried: true,
        excluded: false,
      },
    ],
  },
  {
    id: "gbp-eur-2024-12-01",
    fromCurrency: "GBP",
    toCurrency: "EUR",
    rate: 1.2,
    validAt: "2024-12-01",
    acceptedAt: "2024-12-01T18:10:00Z",
    source: exchangeRateSource,
    providerObservations: [
      {
        provider: "ECB",
        observedDate: "2024-11-29",
        rate: 1.2,
        carried: true,
        excluded: false,
      },
    ],
  },
  {
    id: "usd-eur-2024-12-01",
    fromCurrency: "USD",
    toCurrency: "EUR",
    rate: 1.2 / 1.28,
    validAt: "2024-12-01",
    acceptedAt: "2024-12-02T09:00:00Z",
    source: triangulatedRateSource,
    derivation: {
      method: "triangulated",
      legs: ["gbp-usd-2024-12-01-corrected", "gbp-eur-2024-12-01"],
    },
  },
];

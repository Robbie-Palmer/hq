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

export const exchangeRateObservations: ExchangeRateObservation[] = [
  {
    id: "gbp-usd-2024-06-01",
    fromCurrency: "GBP",
    toCurrency: "USD",
    rate: 1.27,
    validAt: "2024-06-01",
    acceptedAt: "2024-06-01T18:10:00Z",
    source: exchangeRateSource,
  },
  {
    id: "gbp-usd-2024-09-15",
    fromCurrency: "GBP",
    toCurrency: "USD",
    rate: 1.31,
    validAt: "2024-09-15",
    acceptedAt: "2024-09-15T18:10:00Z",
    source: exchangeRateSource,
  },
  {
    id: "gbp-usd-2024-12-01",
    fromCurrency: "GBP",
    toCurrency: "USD",
    rate: 1.28,
    validAt: "2024-12-01",
    acceptedAt: "2024-12-01T18:10:00Z",
    source: exchangeRateSource,
  },
];

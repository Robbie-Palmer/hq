"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatAccountCurrency } from "@/lib/assettracker";
import type {
  PropertyComparableView,
  PropertyMarketTrendView,
} from "@/lib/domain/assettracker";

const propertyTypeLabels = {
  all: "All property types",
  detached: "Detached",
  "semi-detached": "Semi-detached",
  terraced: "Terraced",
  "flat-maisonette": "Flat or maisonette",
  other: "Other",
} as const;

const tenureLabels = {
  freehold: "Freehold",
  leasehold: "Leasehold",
  unknown: "Tenure unavailable",
} as const;

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}

function formatQuarter(period: string): string {
  const month = Number(period.slice(5, 7));
  return `Q${Math.ceil(month / 3)} ${period.slice(0, 4)}`;
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    signDisplay: "always",
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value / 100);
}

function newBuildLabel(value: "include" | "exclude" | "only"): string {
  if (value === "only") return "New builds only";
  if (value === "exclude") return "Established homes only";
  return "New builds included";
}

function ComparableSearchSummary({
  view,
}: Readonly<{
  view: Extract<PropertyComparableView, { status: "ready" | "empty" }>;
}>) {
  const { criteria } = view;
  return (
    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
      <p>
        <span className="font-medium text-foreground">Search area</span>{" "}
        {criteria.searchArea.label}
      </p>
      <p>
        <span className="font-medium text-foreground">Completed</span>{" "}
        {formatDate(criteria.completedFrom)} to{" "}
        {formatDate(criteria.completedTo)}
      </p>
      <p>
        <span className="font-medium text-foreground">Property types</span>{" "}
        {criteria.propertyTypes
          .map((type) => propertyTypeLabels[type])
          .join(", ")}
      </p>
      <p>
        <span className="font-medium text-foreground">Tenure</span>{" "}
        {criteria.tenures.map((tenure) => tenureLabels[tenure]).join(", ")}
        {" · "}
        {newBuildLabel(criteria.newBuild)}
      </p>
    </div>
  );
}

function ComparableEvidence({
  view,
}: Readonly<{
  view: Extract<
    PropertyComparableView,
    { status: "ready" | "empty" | "unsupported-region" }
  >;
}>) {
  return (
    <div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
      <p>{view.evidence.registrationLag}</p>
      <p>{view.evidence.recentDataWarning}</p>
      <p>
        Source{" "}
        <a
          className="underline underline-offset-2"
          href={view.evidence.pageUrl}
          rel="noreferrer"
          target="_blank"
        >
          {view.evidence.provider} {view.evidence.dataset}
        </a>
        {" · "}retrieved {formatDate(view.evidence.retrievedAt)}
        {" · "}dataset {view.evidence.versionId}
      </p>
    </div>
  );
}

function ComparableStatusMessage({
  badge,
  children,
  message,
}: Readonly<{
  badge: string;
  children?: ReactNode;
  message: string;
}>) {
  return (
    <section className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Recent completed sales</h3>
        <Badge variant="outline">{badge}</Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      {children}
    </section>
  );
}

type ReadyMarketTrend = Extract<
  PropertyMarketTrendView,
  { status: "ready" }
>["trend"];

function MarketTrendStatistics({
  trend,
}: Readonly<{ trend: ReadyMarketTrend }>) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
      <div>
        <p className="text-xs text-muted-foreground">Average price</p>
        <p className="font-medium">
          {formatAccountCurrency(trend.averagePrice, "GBP")}
        </p>
      </div>
      {trend.annualChangePercent != null && (
        <div>
          <p className="text-xs text-muted-foreground">Annual change</p>
          <p className="font-medium">
            {formatPercent(trend.annualChangePercent)}
          </p>
        </div>
      )}
      {trend.reportedSalesVolume != null && (
        <div className="col-span-2">
          <p className="text-xs text-muted-foreground">Reported sales</p>
          <p className="font-medium">
            {trend.reportedSalesVolume.count.toLocaleString("en-GB")} in{" "}
            {formatQuarter(trend.reportedSalesVolume.period)} · all property
            types
          </p>
        </div>
      )}
    </div>
  );
}

function MarketTrendEvidence({ trend }: Readonly<{ trend: ReadyMarketTrend }>) {
  return (
    <div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
      <p>{trend.limitation}</p>
      {trend.provisional && <p>{trend.provisionalWarning}</p>}
      <p>
        Source{" "}
        <a
          className="underline underline-offset-2"
          href={trend.evidence.pageUrl}
          rel="noreferrer"
          target="_blank"
        >
          {trend.evidence.provider} {trend.evidence.dataset}
        </a>
        {" · "}retrieved {formatDate(trend.evidence.retrievedAt)}
        {" · "}dataset {trend.evidence.versionId}
      </p>
    </div>
  );
}

function NorthernIrelandMarketTrend({
  marketTrend,
}: Readonly<{ marketTrend: PropertyMarketTrendView }>) {
  if (marketTrend.status === "unavailable") {
    return (
      <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">
          Area market trend unavailable
        </p>
        <p className="mt-1">{marketTrend.message}</p>
        <p className="mt-1">Dataset {marketTrend.datasetVersion}</p>
      </div>
    );
  }

  const { trend } = marketTrend;
  return (
    <div className="mt-3 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-medium">Area market trend</h4>
        <Badge variant="secondary">NI HPI</Badge>
        {trend.provisional && <Badge variant="outline">Provisional</Badge>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {trend.geographyName} · {propertyTypeLabels[trend.propertyType]} ·{" "}
        {formatQuarter(trend.period)}
      </p>
      <MarketTrendStatistics trend={trend} />
      <MarketTrendEvidence trend={trend} />
    </div>
  );
}

function UnsupportedComparableEvidence({
  view,
}: Readonly<{
  view: Extract<PropertyComparableView, { status: "unsupported-region" }>;
}>) {
  return (
    <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
      Comparable-sale source{" "}
      <a
        className="underline underline-offset-2"
        href={view.evidence.pageUrl}
        rel="noreferrer"
        target="_blank"
      >
        {view.evidence.provider} {view.evidence.dataset}
      </a>
      {" · "}England and Wales coverage · retrieved{" "}
      {formatDate(view.evidence.retrievedAt)}
    </p>
  );
}

function ComparableSalesTable({
  view,
}: Readonly<{
  view: Extract<PropertyComparableView, { status: "ready" }>;
}>) {
  return (
    <div className="mt-4 overflow-x-auto rounded-md border">
      <table
        className="w-full min-w-[640px] text-sm"
        aria-label="Recent completed-sale comparables"
      >
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Sale price</th>
            <th className="px-3 py-2 font-medium">Completed</th>
            <th className="px-3 py-2 font-medium">Property</th>
            <th className="px-3 py-2 font-medium">Location</th>
          </tr>
        </thead>
        <tbody>
          {view.sales.map((sale) => (
            <tr className="border-t" key={sale.transactionId}>
              <td className="whitespace-nowrap px-3 py-3 font-medium">
                {formatAccountCurrency(sale.price, "GBP")}
              </td>
              <td className="whitespace-nowrap px-3 py-3">
                {formatDate(sale.completionDate)}
              </td>
              <td className="px-3 py-3">
                <span>{propertyTypeLabels[sale.propertyType]}</span>
                <span className="block text-xs text-muted-foreground">
                  {tenureLabels[sale.tenure]} ·{" "}
                  {sale.newBuild ? "New build" : "Established"}
                </span>
              </td>
              <td className="px-3 py-3">
                <span>{sale.location.postcode}</span>
                <span className="block text-xs text-muted-foreground">
                  {sale.location.townCity} · full postcode
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComparableResult({
  view,
}: Readonly<{
  view: Extract<PropertyComparableView, { status: "ready" | "empty" }>;
}>) {
  return (
    <section className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Recent completed sales</h3>
        <Badge variant="secondary">Comparable evidence</Badge>
        <Badge variant="outline">{view.sales.length} matches</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        These sales are evidence, not a valuation of this home.
      </p>
      <ComparableSearchSummary view={view} />
      {view.status === "empty" ? (
        <p className="mt-4 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
          {view.message} The search was not widened automatically.
        </p>
      ) : (
        <ComparableSalesTable view={view} />
      )}

      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">
          Matching rules
        </summary>
        <p className="mt-2">{view.criteria.matchingRule}</p>
        <p className="mt-1">At most {view.criteria.maxResults} results.</p>
      </details>
      <ComparableEvidence view={view} />
    </section>
  );
}

export function PropertyComparables({
  view,
}: Readonly<{ view: PropertyComparableView }>) {
  if (view.status === "unavailable") {
    return (
      <ComparableStatusMessage badge="Unavailable" message={view.message}>
        <p className="mt-1 text-xs text-muted-foreground">
          Dataset {view.datasetVersion}
        </p>
      </ComparableStatusMessage>
    );
  }
  if (view.status === "unsupported-region") {
    return (
      <ComparableStatusMessage
        badge={
          view.nation === "northern-ireland"
            ? "No open sales records"
            : "Unsupported region"
        }
        message={view.message}
      >
        {view.nation === "northern-ireland" && view.marketTrend != null && (
          <NorthernIrelandMarketTrend marketTrend={view.marketTrend} />
        )}
        <UnsupportedComparableEvidence view={view} />
      </ComparableStatusMessage>
    );
  }
  return <ComparableResult view={view} />;
}

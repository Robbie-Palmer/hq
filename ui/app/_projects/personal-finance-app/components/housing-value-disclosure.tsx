"use client";

import {
  type HousingValue,
  isHousingValueStale,
} from "finance-housing-indices/browser";
import { formatAccountCurrency } from "@/app/_projects/personal-finance-app/lib";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/generic/styles";

const kindLabels: Record<HousingValue["kind"], string> = {
  "recorded-purchase": "Recorded purchase",
  "recorded-valuation": "Recorded valuation",
  "index-estimate": "Index estimate",
  "regional-index-statistic": "Regional index statistic",
  "completed-sale": "Completed sale",
  "asking-price": "Asking price",
  "manual-override": "Manual override",
  forecast: "Future scenario",
};

const sourceKindLabels: Record<HousingValue["source"]["kind"], string> = {
  "transaction-record": "Transaction record",
  "professional-valuation": "Professional valuation",
  "official-index": "Official index",
  "official-completed-sale": "Official completed-sale record",
  "property-listing": "Property listing",
  "manual-entry": "Manual entry",
  "scenario-model": "Scenario model",
};

const precisionLabels: Record<
  HousingValue["source"]["geography"]["precision"],
  string
> = {
  "exact-property": "exact property",
  "full-postcode": "full postcode",
  "postcode-district": "postcode district",
  "local-authority": "local authority",
  region: "region",
  nation: "nation",
};

const sourceDateLabels: Record<HousingValue["source"]["dateKind"], string> = {
  published: "Published",
  retrieved: "Retrieved",
  recorded: "Recorded",
  entered: "Entered",
};

export function HousingValueDisclosure({
  value,
  compact = false,
}: Readonly<{ value: HousingValue; compact?: boolean }>) {
  const stale = isHousingValueStale(value);
  return (
    <article
      className={cn(
        "rounded-md border bg-background p-3",
        compact && "bg-muted/20",
      )}
      aria-label={`${kindLabels[value.kind]} evidence`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{kindLabels[value.kind]}</Badge>
        {value.dataStatus === "provisional" && (
          <Badge variant="outline">Provisional</Badge>
        )}
        {value.dataStatus === "revised" && (
          <Badge variant="outline">Revised</Badge>
        )}
        {value.fallback && <Badge variant="outline">Fallback</Badge>}
        {stale && <Badge variant="outline">Stale</Badge>}
      </div>
      <p className="mt-2 text-base font-semibold">
        {formatAccountCurrency(value.amount, value.currency)}
      </p>
      {value.uncertainty.kind === "indicative-range" && (
        <p className="mt-1 text-xs text-muted-foreground">
          Indicative range{" "}
          {formatAccountCurrency(value.uncertainty.lower, value.currency)} to{" "}
          {formatAccountCurrency(value.uncertainty.upper, value.currency)}
        </p>
      )}
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-medium text-foreground">As of</dt>
          <dd className="text-muted-foreground">{value.asOf}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Geography</dt>
          <dd className="text-muted-foreground">
            {value.source.geography.name} ·{" "}
            {precisionLabels[value.source.geography.precision]}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Source</dt>
          <dd className="text-muted-foreground">
            {sourceKindLabels[value.source.kind]} · {value.source.name}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">
            {sourceDateLabels[value.source.dateKind]}
          </dt>
          <dd className="text-muted-foreground">{value.source.date}</dd>
        </div>
      </dl>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">
          Why this number is shown
        </summary>
        <p className="mt-2">{value.explanation}</p>
        <p className="mt-1">
          {value.uncertainty.kind === "indicative-range"
            ? value.uncertainty.rule
            : value.uncertainty.explanation}
        </p>
        {value.revisionNote && <p className="mt-1">{value.revisionNote}</p>}
        {value.fallback && (
          <p className="mt-1">Fallback rule: {value.fallback.explanation}</p>
        )}
        {stale && (
          <p className="mt-1">
            Freshness rule: stale after {value.freshness.staleAfterDays} days,
            assessed {value.freshness.assessedAt}.
          </p>
        )}
      </details>
    </article>
  );
}

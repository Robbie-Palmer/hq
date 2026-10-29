"use client";

import type { InflationDatasetRelease } from "finance-inflation-indices";
import type {
  Currency,
  GrowthProjection,
  GrowthProjectionPoint,
  GrowthScenario,
} from "@/app/_projects/personal-finance-app/domain";
import { formatCurrency } from "@/app/_projects/personal-finance-app/lib";
import { CompoundGrowthCharts } from "./compound-growth-chart";
import type { GrowthProjections } from "./compound-growth-planner-model";

function ProjectionTable({
  currency,
  points,
}: Readonly<{
  currency: Currency;
  points: readonly GrowthProjectionPoint[];
}>) {
  const rows = points.filter(
    (_, index) => index % 12 === 0 || index === points.length - 1,
  );
  return (
    <div className="max-h-96 overflow-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          Annual compound growth calculation
        </caption>
        <thead className="sticky top-0 bg-background">
          <tr>
            <th>Date</th>
            <th>Contributions</th>
            <th>Withdrawals</th>
            <th>Growth</th>
            <th>Fees</th>
            <th>Taxes</th>
            <th>Nominal balance</th>
            <th>Purchasing power</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((point) => (
            <tr key={point.date}>
              <td>{point.date}</td>
              <td>{formatCurrency(point.contributions, currency)}</td>
              <td>{formatCurrency(point.withdrawals, currency)}</td>
              <td>{formatCurrency(point.growth, currency)}</td>
              <td>{formatCurrency(point.fees, currency)}</td>
              <td>{formatCurrency(point.taxes, currency)}</td>
              <td>{formatCurrency(point.nominalBalance, currency)}</td>
              <td>{formatCurrency(point.purchasingPower, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectionSummary({
  currency,
  projections,
}: Readonly<{ currency: Currency; projections: GrowthProjections }>) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {projections.map((projection) => {
        const finalPoint = projection.points.at(-1);
        return (
          <div key={projection.scenario} className="rounded-md border p-4">
            <p className="font-medium capitalize">{projection.scenario}</p>
            <p className="text-2xl font-semibold">
              {formatCurrency(finalPoint?.nominalBalance ?? 0, currency)}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(finalPoint?.purchasingPower ?? 0, currency)}{" "}
              purchasing power · {(projection.annualReturn * 100).toFixed(1)}%
              return · {(projection.futureInflationRate * 100).toFixed(1)}%
              inflation
            </p>
          </div>
        );
      })}
    </div>
  );
}

function ReturnTypeDisclosure({
  returnType,
}: Readonly<{ returnType: GrowthScenario["returnType"] }>) {
  return (
    <p className="text-sm">
      {returnType === "guaranteed-savings"
        ? "The entered rate is labelled as guaranteed savings interest. Confirm its guarantee period and deposit protection separately."
        : "The entered investment return is uncertain. The downside and upside cases are sensitivities, not forecasts."}
    </p>
  );
}

function RuleDisclosures({
  currency,
  projection,
}: Readonly<{ currency: Currency; projection: GrowthProjection }>) {
  return (
    <>
      {projection.limitIssues.map((issue) => (
        <p
          key={`${issue.wrapper}-${issue.taxYear}`}
          className="text-sm text-destructive"
          role="alert"
        >
          {issue.wrapper.toUpperCase()} contributions exceed the {issue.taxYear}{" "}
          limit by {formatCurrency(issue.excess, currency)}.{" "}
          <a className="underline" href={issue.sourceUrl}>
            Read the sourced rule
          </a>
          .
        </p>
      ))}
      {projection.contributionRule ? (
        <p className="text-sm text-muted-foreground">
          The planner checks {projection.contributionRule.wrapper.toUpperCase()}{" "}
          contributions against a yearly limit of{" "}
          {formatCurrency(projection.contributionRule.limit, currency)}.{" "}
          <a className="underline" href={projection.contributionRule.sourceUrl}>
            Read the sourced rule
          </a>
          .
        </p>
      ) : null}
      {projection.unsupportedCases.map((unsupported) => (
        <p key={unsupported} className="text-sm text-muted-foreground">
          Unsupported: {unsupported}
        </p>
      ))}
    </>
  );
}

function InflationDisclosure({
  release,
}: Readonly<{ release: InflationDatasetRelease | null }>) {
  if (release == null) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Historical GBP comparisons use pinned ONS {release.index} observations
      from dataset {release.versionId}, release {release.source.releaseVersion},
      through {release.source.coverageThrough}. Future purchasing power uses the
      editable hypothetical inflation rate above.{" "}
      <a className="underline" href={release.source.sourceUrl}>
        ONS source
      </a>
      .
    </p>
  );
}

export function CompoundGrowthResults({
  currency,
  inflationRelease,
  projectionError,
  projections,
  returnType,
}: Readonly<{
  currency: Currency;
  inflationRelease: InflationDatasetRelease | null;
  projectionError: string | null;
  projections: GrowthProjections;
  returnType: GrowthScenario["returnType"];
}>) {
  const expected = projections[0];
  const end = expected?.points.at(-1);
  return (
    <>
      {projectionError ? (
        <p className="text-sm text-destructive" role="alert">
          {projectionError}
        </p>
      ) : null}
      <ProjectionSummary currency={currency} projections={projections} />
      <ReturnTypeDisclosure returnType={returnType} />
      {expected ? (
        <CompoundGrowthCharts currency={currency} points={expected.points} />
      ) : null}
      {expected ? (
        <ProjectionTable currency={currency} points={expected.points} />
      ) : null}
      {expected ? (
        <RuleDisclosures currency={currency} projection={expected} />
      ) : null}
      <InflationDisclosure release={inflationRelease} />
      <p className="sr-only" aria-live="polite">
        Expected ending balance{" "}
        {formatCurrency(end?.nominalBalance ?? 0, currency)}
      </p>
    </>
  );
}

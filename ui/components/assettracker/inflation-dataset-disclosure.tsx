import type {
  Currency,
  InflationDatasetRelease,
} from "@/lib/domain/assettracker";
import { inflationDatasetDisclosure } from "@/lib/domain/assettracker";

export function InflationDatasetDisclosure({
  release,
  referenceDate,
  currency,
}: Readonly<{
  release: InflationDatasetRelease | null;
  referenceDate: string;
  currency: Currency;
}>) {
  if (release == null) {
    return (
      <p role="status" className="text-sm text-destructive">
        The selected inflation index is unavailable.
      </p>
    );
  }
  const disclosure = inflationDatasetDisclosure(
    release,
    referenceDate,
    currency,
  );
  return (
    <div className="space-y-1 text-sm">
      <p>
        <span className="font-medium">{disclosure.indexLabel}</span>
        {` to ${disclosure.referencePeriod}`}
      </p>
      <p className="text-muted-foreground">
        {disclosure.releaseLabel}. {disclosure.sourceLabel}.
      </p>
      {disclosure.warning != null && (
        <p role="alert" className="text-destructive">
          {disclosure.warning}
        </p>
      )}
    </div>
  );
}

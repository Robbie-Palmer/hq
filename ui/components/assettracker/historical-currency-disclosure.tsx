import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import { formatAccountCurrency } from "@/lib/assettracker";
import type {
  Currency,
  NetWorthAccountConversion,
  NetWorthDataPoint,
} from "@/lib/domain/assettracker";

function formatNative(account: NetWorthAccountConversion): string {
  if (account.nativeValue == null || account.nativeCurrency == null) {
    return "No native value";
  }
  return formatAccountCurrency(account.nativeValue, account.nativeCurrency);
}

function formatConverted(
  account: NetWorthAccountConversion,
  targetCurrency: Currency,
): string {
  return account.convertedValue == null
    ? "Conversion unavailable"
    : formatAccountCurrency(account.convertedValue, targetCurrency);
}

function rateDescription(account: NetWorthAccountConversion): string {
  if (account.issues.length > 0) {
    return account.issues
      .map((issue) => {
        if (issue.kind === "stale_exchange_rate" && issue.observedAt != null) {
          return `Rate from ${issue.observedAt} is too old`;
        }
        if (issue.kind === "missing_exchange_rate") {
          return `No ${issue.currency ?? "required"} exchange rate`;
        }
        return issue.kind.replaceAll("_", " ");
      })
      .join("; ");
  }
  if (account.rates.length === 0) return "No conversion needed";
  return account.rates
    .map((rate) => {
      const flags = [
        rate.method === "inverse" ? "inverse" : null,
        rate.method === "triangulated" ? "triangulated" : null,
        rate.carriedForward ? "carried forward" : null,
      ].filter(Boolean);
      const suffix = flags.length > 0 ? `, ${flags.join(", ")}` : "";
      return `${rate.source}, effective ${rate.effectiveDate}${suffix}`;
    })
    .join("; ");
}

export function HistoricalCurrencyDisclosure({
  data,
  currency,
}: Readonly<{ data: NetWorthDataPoint[]; currency: Currency }>) {
  const conversions = data.flatMap((point) =>
    point.conversion == null ? [] : [{ date: point.date, ...point.conversion }],
  );
  if (conversions.length === 0) return null;

  const incompleteCount = conversions.filter(
    (point) => point.status === "incomplete",
  ).length;

  return (
    <details className="rounded-lg border bg-muted/20 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">
        Exchange-rate history{" "}
        <span className="ml-2 font-normal text-muted-foreground">
          {incompleteCount === 0
            ? `All ${conversions.length} points complete`
            : `${incompleteCount} of ${conversions.length} points incomplete`}
        </span>
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">
        Each row keeps the recorded amount beside its value in {currency}. Rates
        never come from a date after the history point.
      </p>
      <div className="mt-3 max-h-96 overflow-auto">
        <table className="w-full min-w-3xl text-left text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b">
              <th className="px-2 py-2 font-medium">Date</th>
              <th className="px-2 py-2 font-medium">Account</th>
              <th className="px-2 py-2 font-medium">Native value</th>
              <th className="px-2 py-2 font-medium">Value in {currency}</th>
              <th className="px-2 py-2 font-medium">Rate evidence</th>
            </tr>
          </thead>
          <tbody>
            {conversions.flatMap((point) =>
              point.accounts.map((account) => (
                <tr
                  key={`${point.date}-${account.accountId}`}
                  className="border-b align-top last:border-0"
                >
                  <td className="whitespace-nowrap px-2 py-2">{point.date}</td>
                  <td className="px-2 py-2">{account.accountName}</td>
                  <td className="whitespace-nowrap px-2 py-2">
                    {formatNative(account)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      {account.convertedValue == null ? (
                        <AlertCircleIcon
                          className="size-3.5 text-destructive"
                          aria-hidden="true"
                        />
                      ) : (
                        <CheckCircle2Icon
                          className="size-3.5 text-emerald-600"
                          aria-hidden="true"
                        />
                      )}
                      {formatConverted(account, currency)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {rateDescription(account)}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}

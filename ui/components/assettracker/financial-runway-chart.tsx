import {
  type Currency,
  DEFAULT_BASE_CURRENCY,
  formatCurrency,
} from "@/lib/domain/assettracker";
import type { FinancialRunway } from "@/lib/domain/assettracker/portfolioReconciliation";

type RunwayKey = keyof FinancialRunway;

const RUNWAY_ROWS: {
  key: RunwayKey;
  label: string;
  description: string;
  colour: string;
}[] = [
  {
    key: "cash",
    label: "Cash",
    description: "Available without selling investments",
    colour: "bg-sky-500 dark:bg-sky-400",
  },
  {
    key: "liquid",
    label: "Liquid assets",
    description: "Cash plus investments you can readily sell",
    colour: "bg-emerald-500 dark:bg-emerald-400",
  },
  {
    key: "total",
    label: "Total net worth",
    description: "Includes pensions, property equity, and liabilities",
    colour: "bg-violet-500 dark:bg-violet-400",
  },
];

function formatDuration(months: number | null): string {
  if (months == null) return "Needs spending history";
  if (months < 24) return `${months.toFixed(1)} months`;
  return `${(months / 12).toFixed(1)} years`;
}

export function FinancialRunwayChart({
  runway,
  currency = DEFAULT_BASE_CURRENCY,
}: Readonly<{ runway: FinancialRunway; currency?: Currency }>) {
  const maximumMonths = Math.max(
    ...RUNWAY_ROWS.map(({ key }) => runway[key].months ?? 0),
  );

  return (
    <section className="min-w-0 space-y-4" aria-labelledby="runway-heading">
      <div>
        <h3 id="runway-heading" className="text-sm font-medium">
          Financial runway
        </h3>
        <p className="text-xs text-muted-foreground">
          How long each pool could cover current spending with no income, before
          tax, fees, or investment growth.
        </p>
      </div>
      <div
        role="img"
        aria-label="Financial runway from cash, liquid assets, and total net worth"
        className="space-y-4"
      >
        {RUNWAY_ROWS.map(({ key, label, description, colour }) => {
          const pool = runway[key];
          const width =
            maximumMonths > 0 && pool.months != null
              ? Math.max((Math.max(pool.months, 0) / maximumMonths) * 100, 0)
              : 0;
          return (
            <div key={key} className="grid gap-2 sm:grid-cols-[9rem_1fr_auto]">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              <div className="self-center overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-3 rounded-full ${colour}`}
                  style={{ width: `${width}%` }}
                />
              </div>
              <div className="min-w-28 text-left sm:text-right">
                <p className="text-sm font-semibold">
                  {formatDuration(pool.months)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(Math.round(pool.balance), currency)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <table className="sr-only" aria-label="Financial runway data">
        <thead>
          <tr>
            <th>Pool</th>
            <th>Balance</th>
            <th>Runway</th>
          </tr>
        </thead>
        <tbody>
          {RUNWAY_ROWS.map(({ key, label }) => (
            <tr key={key}>
              <th>{label}</th>
              <td>
                {formatCurrency(Math.round(runway[key].balance), currency)}
              </td>
              <td>{formatDuration(runway[key].months)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

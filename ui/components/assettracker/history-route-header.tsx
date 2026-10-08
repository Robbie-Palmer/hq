import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type Currency,
  CurrencySchema,
  SUPPORTED_CURRENCIES,
} from "@/lib/domain/assettracker";
import { AccountHistoryImportDrawer } from "./account-history-import-drawer";

export function HistoryRouteHeader({
  currency,
  onCurrencyChange,
}: Readonly<{
  currency: Currency;
  onCurrencyChange: (currency: Currency) => void;
}>) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="mb-2 text-3xl font-bold sm:text-4xl">History</h1>
        <p className="text-lg text-muted-foreground">
          Follow net worth, contributed capital, and allocation over time.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Show net worth in</span>
        <Select
          value={currency}
          onValueChange={(value) =>
            onCurrencyChange(CurrencySchema.parse(value))
          }
        >
          <SelectTrigger
            className="w-24"
            aria-label="Historical target currency"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_CURRENCIES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AccountHistoryImportDrawer />
      </div>
    </div>
  );
}

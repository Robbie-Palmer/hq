import type { AssetTrackerData } from "@/lib/domain/assettracker/assetTrackerData";

function csvField(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/**
 * Balance history as spreadsheet-friendly long-format CSV: one row per
 * recorded balance, joined with the account's metadata. This is the bridge
 * back to the spreadsheets the target users are migrating from.
 */
export function toBalancesCsv(data: AssetTrackerData): string {
  const accountsById = new Map(
    data.accounts.map((account) => [account.id, account]),
  );
  const header = ["date", "account", "provider", "type", "currency", "balance"];
  const rows = [...data.snapshots]
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.accountId.localeCompare(b.accountId),
    )
    .map((snapshot) => {
      const account = accountsById.get(snapshot.accountId);
      return [
        snapshot.date,
        account?.name ?? snapshot.accountId,
        account?.provider ?? "",
        account?.assetType ?? "",
        account?.currency ?? "",
        snapshot.balance,
      ]
        .map(csvField)
        .join(",");
    });
  return [header.join(","), ...rows].join("\n");
}

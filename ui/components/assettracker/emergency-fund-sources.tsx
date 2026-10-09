"use client";

import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/assettracker";
import type {
  AccountDetailView,
  Currency,
  EmergencyFundAccountPolicy,
  EmergencyFundAnalysis,
  EmergencyFundSource,
} from "@/lib/domain/assettracker";

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type PolicyChange = (
  accountId: string,
  update: Partial<EmergencyFundAccountPolicy>,
) => void;

function SourceTableHeader() {
  const columns = [
    "Use",
    "Account",
    "Balance",
    "Usable now",
    "Kind",
    "Access days",
    "Potential loss (%)",
    "Fee",
  ];
  return (
    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
      <tr>
        {columns.map((column) => (
          <th
            key={column}
            className={`px-3 py-2 ${column === "Balance" ? "text-right" : ""}`}
          >
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function PolicyNumberInput({
  account,
  label,
  value,
  max,
  onChange,
}: Readonly<{
  account: AccountDetailView;
  label: string;
  value: number | string;
  max?: number;
  onChange(value: string): void;
}>) {
  return (
    <Input
      className="w-28"
      aria-label={`${label} for ${account.name}`}
      type="number"
      min={0}
      max={max}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function SourceIdentity({
  account,
  source,
  currency,
}: Readonly<{
  account: AccountDetailView;
  source?: EmergencyFundSource;
  currency: Currency;
}>) {
  return (
    <>
      <td className="px-3 py-2">
        <p className="font-medium">{account.name}</p>
        <p className="text-xs text-muted-foreground">{account.provider}</p>
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {source == null
          ? "Unavailable"
          : formatCurrency(Math.round(source.balance), currency)}
      </td>
      <td className="max-w-48 px-3 py-2 text-xs">
        {source?.included
          ? formatCurrency(Math.round(source.effectiveBalance), currency)
          : (source?.exclusionReason ?? "Excluded")}
      </td>
    </>
  );
}

function SourcePolicyInputs({
  account,
  policy,
  onChange,
}: Readonly<{
  account: AccountDetailView;
  policy: EmergencyFundAccountPolicy;
  onChange: PolicyChange;
}>) {
  const updateNumber = (
    key: "accessDelayDays" | "capitalRiskRate" | "withdrawalFee",
    value: string,
  ) => onChange(account.id, { [key]: numberValue(value) });
  return (
    <>
      <td className="px-3 py-2">
        <PolicyNumberInput
          account={account}
          label="Access delay"
          value={policy.accessDelayDays}
          onChange={(value) => updateNumber("accessDelayDays", value)}
        />
      </td>
      <td className="px-3 py-2">
        <PolicyNumberInput
          account={account}
          label="Potential loss percentage"
          max={100}
          value={policy.capitalRiskRate * 100}
          onChange={(value) =>
            onChange(account.id, { capitalRiskRate: numberValue(value) / 100 })
          }
        />
      </td>
      <td className="px-3 py-2">
        <PolicyNumberInput
          account={account}
          label="Withdrawal fee"
          value={policy.withdrawalFee}
          onChange={(value) => updateNumber("withdrawalFee", value)}
        />
      </td>
    </>
  );
}

function SourceRow({
  account,
  policy,
  source,
  currency,
  onChange,
}: Readonly<{
  account: AccountDetailView;
  policy: EmergencyFundAccountPolicy;
  source?: EmergencyFundSource;
  currency: Currency;
  onChange: PolicyChange;
}>) {
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        <input
          type="checkbox"
          aria-label={`Use ${account.name} as an emergency reserve`}
          checked={policy.included}
          onChange={(event) =>
            onChange(account.id, { included: event.target.checked })
          }
          className="size-4 accent-primary"
        />
      </td>
      <SourceIdentity account={account} source={source} currency={currency} />
      <td className="px-3 py-2">
        {policy.kind === "cash" ? "Cash" : "Cash-equivalent"}
      </td>
      <SourcePolicyInputs
        account={account}
        policy={policy}
        onChange={onChange}
      />
    </tr>
  );
}

export function EmergencyFundSources({
  accounts,
  analysis,
  baseCurrency,
  policies,
  onPolicyChange,
}: Readonly<{
  accounts: AccountDetailView[];
  analysis: EmergencyFundAnalysis | null;
  baseCurrency: Currency;
  policies: EmergencyFundAccountPolicy[];
  onPolicyChange: PolicyChange;
}>) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">Reserve sources</h4>
        <p className="text-xs text-muted-foreground">
          Pension, home equity, illiquid accounts, business working capital, and
          tax reserves start excluded. Each account can be reviewed.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[1180px] text-sm">
          <SourceTableHeader />
          <tbody>
            {accounts.map((account) => {
              const policy = policies.find(
                (item) => item.accountId === account.id,
              );
              if (policy == null) return null;
              const source = analysis?.sources.find(
                (item) => item.accountId === account.id,
              );
              return (
                <SourceRow
                  key={account.id}
                  account={account}
                  policy={policy}
                  source={source}
                  currency={baseCurrency}
                  onChange={onPolicyChange}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

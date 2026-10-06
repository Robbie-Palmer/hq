"use client";

import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/assettracker";
import type {
  AccountDetailView,
  Currency,
  EmergencyFundAccountPolicy,
  EmergencyFundAnalysis,
} from "@/lib/domain/assettracker";

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  onPolicyChange(
    accountId: string,
    update: Partial<EmergencyFundAccountPolicy>,
  ): void;
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
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Use</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2">Usable now</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Access days</th>
              <th className="px-3 py-2">Capital at risk</th>
              <th className="px-3 py-2">Fee</th>
              <th className="px-3 py-2">Protection limit</th>
              <th className="px-3 py-2">Source URL</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const policy = policies.find(
                ({ accountId }) => accountId === account.id,
              );
              if (policy == null) return null;
              const source = analysis?.sources.find(
                ({ accountId }) => accountId === account.id,
              );
              return (
                <tr key={account.id} className="border-t align-top">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Use ${account.name} as an emergency reserve`}
                      checked={policy.included}
                      onChange={(event) =>
                        onPolicyChange(account.id, {
                          included: event.target.checked,
                        })
                      }
                      className="size-4 accent-primary"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium">{account.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {account.provider}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {source == null
                      ? "Unavailable"
                      : formatCurrency(
                          Math.round(source.balance),
                          baseCurrency,
                        )}
                  </td>
                  <td className="max-w-48 px-3 py-2 text-xs">
                    {source?.included
                      ? formatCurrency(
                          Math.round(source.effectiveBalance),
                          baseCurrency,
                        )
                      : (source?.exclusionReason ?? "Excluded")}
                  </td>
                  <td className="px-3 py-2">
                    {policy.kind === "cash" ? "Cash" : "Cash-equivalent"}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      className="w-24"
                      aria-label={`Access delay for ${account.name}`}
                      type="number"
                      min={0}
                      value={policy.accessDelayDays}
                      onChange={(event) =>
                        onPolicyChange(account.id, {
                          accessDelayDays: numberValue(event.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      className="w-24"
                      aria-label={`Capital risk for ${account.name}`}
                      type="number"
                      min={0}
                      max={100}
                      value={policy.capitalRiskRate * 100}
                      onChange={(event) =>
                        onPolicyChange(account.id, {
                          capitalRiskRate:
                            numberValue(event.target.value) / 100,
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      className="w-28"
                      aria-label={`Withdrawal fee for ${account.name}`}
                      type="number"
                      min={0}
                      value={policy.withdrawalFee}
                      onChange={(event) =>
                        onPolicyChange(account.id, {
                          withdrawalFee: numberValue(event.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      className="w-32"
                      aria-label={`Protection limit for ${account.name}`}
                      type="number"
                      min={0}
                      value={policy.protectionLimit ?? ""}
                      onChange={(event) =>
                        onPolicyChange(account.id, {
                          protectionLimit: optionalNumber(event.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      className="w-56"
                      aria-label={`Protection source for ${account.name}`}
                      type="url"
                      placeholder="https://…"
                      value={policy.protectionSourceUrl ?? ""}
                      onChange={(event) =>
                        onPolicyChange(account.id, {
                          protectionSourceUrl:
                            event.target.value.trim() || undefined,
                        })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

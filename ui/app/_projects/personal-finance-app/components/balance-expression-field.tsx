"use client";

import { useMemo } from "react";
import { evaluateBalanceExpression } from "@/app/_projects/personal-finance-app/domain/balanceExpression";
import type { Currency } from "@/app/_projects/personal-finance-app/domain/currency";
import { formatAccountCurrency } from "@/app/_projects/personal-finance-app/lib";
import { Input } from "@/components/ui/input";

interface BalanceExpressionFieldProps {
  currency?: Currency;
  onChange: (value: string) => void;
  value: string;
}

export function BalanceExpressionField({
  currency,
  onChange,
  value,
}: Readonly<BalanceExpressionFieldProps>) {
  const evaluatedBalance = useMemo(() => {
    if (value.trim() === "") return null;
    try {
      return evaluateBalanceExpression(value);
    } catch {
      return null;
    }
  }, [value]);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="log-balance-amount" className="text-sm font-medium">
        Balance{currency ? ` (${currency})` : ""}
      </label>
      <Input
        id="log-balance-amount"
        type="text"
        inputMode="decimal"
        required
        autoComplete="off"
        spellCheck={false}
        placeholder="0.00 or 2648 + 16058"
        value={value}
        aria-describedby="log-balance-help log-balance-result"
        onChange={(event) => onChange(event.target.value)}
      />
      <p id="log-balance-help" className="text-xs text-muted-foreground">
        Enter an amount or use +, -, *, /, and parentheses. Negative balances
        record debt.
      </p>
      <p
        id="log-balance-result"
        aria-live="polite"
        className="min-h-4 text-xs text-muted-foreground"
      >
        {evaluatedBalance != null && currency
          ? `Result: ${formatAccountCurrency(evaluatedBalance, currency)}`
          : null}
      </p>
    </div>
  );
}

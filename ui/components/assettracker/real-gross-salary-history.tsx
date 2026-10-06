"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SalaryHistoryRecord } from "@/lib/domain/assettracker";
import { RealGrossSalaryContent } from "./real-gross-salary-history-content";
import { useRealGrossSalaryHistory } from "./use-real-gross-salary-history";

function EmptySalaryHistory() {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center">
      <div className="space-y-1">
        <p className="font-medium">No salary history yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Import gross pay before tax, employee pension deductions, and salary
          sacrifice to compare salary purchasing power.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/assettracker/imports">Import salary history</Link>
      </Button>
    </div>
  );
}

export function RealGrossSalaryHistory({
  salaryHistory,
}: Readonly<{ salaryHistory: readonly SalaryHistoryRecord[] }>) {
  const view = useRealGrossSalaryHistory(salaryHistory);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Salary over time</CardTitle>
        <CardDescription>
          Compare recorded gross pay with a hypothetical no-employee-pension net
          salary in nominal pounds and reference-period purchasing power.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-2 sm:px-6">
        {view.hasSalaryHistory ? (
          <RealGrossSalaryContent view={view} />
        ) : (
          <EmptySalaryHistory />
        )}
      </CardContent>
    </Card>
  );
}

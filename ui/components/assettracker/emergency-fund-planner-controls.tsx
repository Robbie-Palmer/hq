"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  EmergencyFundPlanInput,
  EmergencyFundStressScenario,
} from "@/lib/domain/assettracker";

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
}: Readonly<{
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}>) {
  const inputId = useId();
  return (
    <div className="grid gap-1 text-sm">
      <label htmlFor={inputId} className="text-xs text-muted-foreground">
        {label}
      </label>
      <span className="flex items-center gap-2">
        <Input
          id={inputId}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(numberValue(event.target.value))}
        />
        {suffix && (
          <span className="text-xs text-muted-foreground">{suffix}</span>
        )}
      </span>
    </div>
  );
}

export function PlannerHeader({
  activePlan,
}: Readonly<{
  activePlan?: { version: number; createdAt: string };
}>) {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
      <div>
        <h3 className="font-semibold">Emergency reserve plan</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Compare household-selected reserve policies against income loss,
          delayed side income, unexpected costs, inflation, and selected
          decisions. There is no preset correct number of months.
        </p>
      </div>
      <div className="text-xs text-muted-foreground sm:text-right">
        {activePlan == null ? (
          <p>Not saved yet</p>
        ) : (
          <>
            <p>Version {activePlan.version}</p>
            <p>{new Date(activePlan.createdAt).toLocaleDateString()}</p>
          </>
        )}
      </div>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
}>) {
  return (
    <div className="grid gap-1 text-sm">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function ReservePreferences({
  draft,
  coverageText,
  missingDataText,
  onDraftChange,
  onCoverageChange,
  onMissingDataChange,
}: Readonly<{
  draft: EmergencyFundPlanInput;
  coverageText: string;
  missingDataText: string;
  onDraftChange(update: Partial<EmergencyFundPlanInput>): void;
  onCoverageChange(value: string): void;
  onMissingDataChange(value: string): void;
}>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <NumberField
        label="Irregular essentials per year"
        value={draft.annualIrregularEssentialCosts}
        onChange={(value) =>
          onDraftChange({ annualIrregularEssentialCosts: value })
        }
      />
      <NumberField
        label="Funds needed within"
        value={draft.accessNeedDays}
        suffix="days"
        onChange={(value) => onDraftChange({ accessNeedDays: value })}
      />
      <TextField
        id="emergency-fund-coverage-months"
        label="Policies to compare, in months"
        value={coverageText}
        onChange={onCoverageChange}
      />
      <TextField
        id="emergency-fund-missing-data"
        label="Missing or uncertain facts"
        value={missingDataText}
        onChange={onMissingDataChange}
      />
    </div>
  );
}

export function MissingDataWarning({ items }: Readonly<{ items: string[] }>) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <p className="font-medium">Review before choosing a policy</p>
      <p className="mt-1 text-muted-foreground">{items.join("; ")}</p>
    </div>
  );
}

export function StressAssumptions({
  scenarios,
  onChange,
}: Readonly<{
  scenarios: EmergencyFundStressScenario[];
  onChange(index: number, update: Partial<EmergencyFundStressScenario>): void;
}>) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">Stress assumptions</h4>
        <p className="text-xs text-muted-foreground">
          These are explicit what-if events, not probability scores. Inflation
          comes from the shared tracker setting.
        </p>
      </div>
      {scenarios.map((scenario, index) => (
        <StressScenarioFields
          key={scenario.id}
          scenario={scenario}
          onChange={(update) => onChange(index, update)}
        />
      ))}
    </div>
  );
}

function StressScenarioFields({
  scenario,
  onChange,
}: Readonly<{
  scenario: EmergencyFundStressScenario;
  onChange(update: Partial<EmergencyFundStressScenario>): void;
}>) {
  return (
    <div className="grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <NumberField
        label="Duration"
        value={scenario.durationMonths}
        suffix="months"
        onChange={(durationMonths) => onChange({ durationMonths })}
      />
      <NumberField
        label="Employment income lost"
        value={scenario.employmentIncomeLossRate * 100}
        max={100}
        suffix="%"
        onChange={(value) =>
          onChange({ employmentIncomeLossRate: value / 100 })
        }
      />
      <NumberField
        label="Side-income delay"
        value={scenario.sideIncomeDelayMonths}
        suffix="months"
        onChange={(sideIncomeDelayMonths) =>
          onChange({ sideIncomeDelayMonths })
        }
      />
      <NumberField
        label="Unexpected cost"
        value={scenario.unexpectedCost}
        onChange={(unexpectedCost) => onChange({ unexpectedCost })}
      />
    </div>
  );
}

export function SaveControls({
  saving,
  hasActivePlan,
  error,
  onSave,
}: Readonly<{
  saving: boolean;
  hasActivePlan: boolean;
  error: string | null;
  onSave(): void;
}>) {
  const label = saving
    ? "Saving…"
    : hasActivePlan
      ? "Save as new version"
      : "Save reserve plan";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" onClick={onSave} disabled={saving}>
        {label}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

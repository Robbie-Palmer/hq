"use client";

import { Check, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useUnitPreference } from "@/hooks/use-unit-preference";
import {
  convertToSystem,
  type MeasurementDimension,
  type MeasurementSystem,
  preferenceForSystem,
  UNIT_LABELS,
  type Unit,
  type UnitPreference,
  type UnitTier,
} from "@/lib/domain/recipe/unit";
import { cn } from "@/lib/generic/styles";
import { PanelHead } from "./panel-head";

const PRESETS: {
  id: MeasurementSystem;
  label: string;
  sub: string;
  description: string;
}[] = [
  {
    id: "metric",
    label: "Metric",
    sub: "tsp · ml · L · g",
    description:
      "Metric uses teaspoons and tablespoons for small volumes, then ml and litres; weights move from grams to kilograms.",
  },
  {
    id: "uk",
    label: "UK",
    sub: "tsp · ml · pints · g",
    description:
      "UK uses teaspoons and tablespoons for small volumes, then ml, pints and litres; weights move from grams to kilograms.",
  },
  {
    id: "us",
    label: "US",
    sub: "tsp · cups · oz · lb",
    description:
      "US uses teaspoons and tablespoons for small volumes, then cups and pints; weights move from ounces to pounds.",
  },
];

const CUSTOM_DESCRIPTION =
  "Custom uses the units and hand-off thresholds shown in your ladders below.";

const UNIT_OPTIONS: Record<MeasurementDimension, Unit[]> = {
  weight: ["g", "oz", "lb", "kg"],
  volume: [
    "tsp",
    "tbsp",
    "us_fl_oz",
    "ml",
    "us_cup",
    "us_pint",
    "uk_pint",
    "l",
  ],
};

const SHORT_LABELS: Partial<Record<Unit, string>> = {
  us_fl_oz: "fl oz",
  us_cup: "cups",
  us_pint: "US pints",
  uk_pint: "pints",
  l: "litres",
};

const DEFAULT_THRESHOLD: Partial<Record<Unit, number>> = {
  tsp: 15,
  tbsp: 45,
  us_fl_oz: 120,
  ml: 1000,
  us_cup: 1000,
  us_pint: 1200,
  uk_pint: 2000,
  l: 4000,
  g: 1000,
  oz: 340,
  lb: 2000,
  kg: 4000,
};

const MAX_THRESHOLD = 10_000;
const MIN_THRESHOLD = 2;
const BAND_COLORS = [
  "rgba(200, 105, 60, 0.18)",
  "rgba(143, 166, 119, 0.22)",
  "rgba(184, 138, 74, 0.20)",
  "rgba(150, 110, 140, 0.18)",
  "rgba(120, 150, 170, 0.18)",
];
const BAND_INK = [
  "var(--terracotta-deep)",
  "var(--sage)",
  "#9a6b33",
  "#7c5a78",
  "#4f6e84",
];

const SAMPLE: { name: string; amount: number; unit: Unit }[] = [
  { name: "baking powder", amount: 5, unit: "ml" },
  { name: "olive oil", amount: 30, unit: "ml" },
  { name: "plain flour", amount: 250, unit: "g" },
  { name: "whole milk", amount: 600, unit: "ml" },
  { name: "chicken thighs", amount: 1200, unit: "g" },
  { name: "chicken stock", amount: 1500, unit: "ml" },
];

function shortLabel(unit: Unit): string {
  return SHORT_LABELS[unit] ?? UNIT_LABELS[unit]?.plural ?? unit;
}

function thresholdLabel(
  value: number,
  dimension: MeasurementDimension,
): string {
  if (value >= 1000)
    return `${Number((value / 1000).toFixed(2))}${dimension === "weight" ? "kg" : "L"}`;
  return `${Number(value.toFixed(1))}${dimension === "weight" ? "g" : "ml"}`;
}

function thresholdStep(value: number): number {
  if (value < 50) return 1;
  if (value < 500) return 5;
  return 25;
}

function normalizeTiers(tiers: UnitTier[]): UnitTier[] {
  let previous = 0;
  return tiers.map((tier, index) => {
    if (index === tiers.length - 1) return { ...tier, upTo: Infinity };
    const requested = Number.isFinite(tier.upTo)
      ? tier.upTo
      : (DEFAULT_THRESHOLD[tier.unit] ?? previous + 1);
    const upTo = Math.max(previous + 1, requested);
    previous = upTo;
    return { ...tier, upTo };
  });
}

function ThresholdInput({
  id,
  label,
  value,
  min,
  max,
  suffix,
  onCommit,
}: Readonly<{
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onCommit: (value: number) => void;
}>) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(1))));

  useEffect(() => {
    setDraft(String(Number(value.toFixed(1))));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(Number(value.toFixed(1))));
      return;
    }
    onCommit(Math.min(max, Math.max(min, parsed)));
  };

  return (
    <div className="flex items-center rounded-lg border border-[var(--line-strong)] bg-[var(--paper-warm)] px-2">
      <input
        id={id}
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step="any"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="rt-mono min-w-0 flex-1 bg-transparent py-1.5 outline-none"
      />
      <span className="rt-mono text-[var(--ink-3)]">{suffix}</span>
    </div>
  );
}

function thresholdPosition(value: number): number {
  const lower = Math.log10(MIN_THRESHOLD);
  const upper = Math.log10(MAX_THRESHOLD);
  const clamped = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, value));
  return ((Math.log10(clamped) - lower) / (upper - lower)) * 100;
}

function tidyThreshold(value: number): number {
  if (value < 50) return Math.round(value);
  if (value < 500) return Math.round(value / 5) * 5;
  return Math.round(value / 25) * 25;
}

function dividerBounds(
  tiers: UnitTier[],
  index: number,
): { min: number; max: number } {
  const previous =
    index === 0
      ? MIN_THRESHOLD
      : Math.min(MAX_THRESHOLD - 1, (tiers[index - 1]?.upTo ?? 1) + 1);
  const next = tiers[index + 1];
  const max = Number.isFinite(next?.upTo)
    ? Math.max(previous, (next?.upTo ?? MAX_THRESHOLD) - 1)
    : MAX_THRESHOLD;
  return { min: previous, max };
}

function ThresholdRuler({
  dimension,
  tiers,
  onChange,
}: Readonly<{
  dimension: MeasurementDimension;
  tiers: UnitTier[];
  onChange: (index: number, value: number) => void;
}>) {
  const barRef = useRef<HTMLDivElement>(null);

  const updateFromPointer = (index: number, clientX: number) => {
    const bounds = barRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return;
    const ratio = Math.min(
      1,
      Math.max(0, (clientX - bounds.left) / bounds.width),
    );
    const lower = Math.log10(MIN_THRESHOLD);
    const upper = Math.log10(MAX_THRESHOLD);
    const raw = 10 ** (lower + ratio * (upper - lower));
    const { min, max } = dividerBounds(tiers, index);
    onChange(index, Math.min(max, Math.max(min, tidyThreshold(raw))));
  };

  return (
    <div>
      <div
        ref={barRef}
        data-threshold-ruler={dimension}
        className="relative h-14 touch-none select-none overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[var(--paper-warm)]"
      >
        {tiers.map((tier, index) => {
          const lower =
            index === 0 ? MIN_THRESHOLD : (tiers[index - 1]?.upTo ?? 1);
          const upper = Number.isFinite(tier.upTo) ? tier.upTo : MAX_THRESHOLD;
          const left = thresholdPosition(lower);
          const width = thresholdPosition(upper) - left;
          return (
            <div
              key={tier.unit}
              className="absolute inset-y-0 flex items-center justify-center"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: BAND_COLORS[index % BAND_COLORS.length],
                color: BAND_INK[index % BAND_INK.length],
              }}
            >
              <span className="rt-display truncate px-1 text-lg font-bold">
                {shortLabel(tier.unit)}
              </span>
            </div>
          );
        })}
        {tiers.slice(0, -1).map((tier, index) => {
          const next = tiers[index + 1];
          const { min, max } = dividerBounds(tiers, index);
          const label = `${shortLabel(tier.unit)} hands off to ${next ? shortLabel(next.unit) : "the next unit"}`;
          return (
            <button
              key={`${tier.unit}-divider`}
              type="button"
              role="slider"
              aria-label={label}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={tier.upTo}
              aria-valuetext={thresholdLabel(tier.upTo, dimension)}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  updateFromPointer(index, event.clientX);
                }
              }}
              // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
              onKeyDown={(event) => {
                const step = thresholdStep(tier.upTo);
                let nextValue: number | null = null;
                if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                  nextValue = tier.upTo - step;
                } else if (
                  event.key === "ArrowRight" ||
                  event.key === "ArrowUp"
                ) {
                  nextValue = tier.upTo + step;
                } else if (event.key === "Home") {
                  nextValue = min;
                } else if (event.key === "End") {
                  nextValue = max;
                }
                if (nextValue == null) return;
                event.preventDefault();
                onChange(index, Math.min(max, Math.max(min, nextValue)));
              }}
              className="absolute inset-y-0 z-10 w-5 -translate-x-1/2 cursor-ew-resize touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--terracotta)] focus-visible:ring-offset-2"
              style={{ left: `${thresholdPosition(tier.upTo)}%` }}
            >
              <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-[var(--ink)]" />
              <span className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--card)] bg-[var(--ink)]" />
            </button>
          );
        })}
      </div>
      <div className="rt-mono mt-2 flex items-start justify-between gap-3 text-[var(--ink-4)]">
        <span>{thresholdLabel(MIN_THRESHOLD, dimension)}</span>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-center text-[var(--terracotta)]">
          {tiers.slice(0, -1).map((tier, index) => (
            <span key={`${tier.unit}-label`}>
              {shortLabel(tier.unit)}→
              {shortLabel(tiers[index + 1]?.unit ?? tier.unit)} at{" "}
              {thresholdLabel(tier.upTo, dimension)}
            </span>
          ))}
        </div>
        <span>{thresholdLabel(MAX_THRESHOLD, dimension)}</span>
      </div>
    </div>
  );
}

function Ladder({
  dimension,
  preference,
  onChange,
}: Readonly<{
  dimension: MeasurementDimension;
  preference: UnitPreference;
  onChange: (preference: UnitPreference) => void;
}>) {
  const tiers = preference[dimension];
  const active = new Set(tiers.map((tier) => tier.unit));

  const setTiers = (next: UnitTier[]) =>
    onChange({
      ...preference,
      preset: "custom",
      [dimension]: normalizeTiers(next),
    });

  const toggle = (unit: Unit) => {
    if (active.has(unit)) {
      if (tiers.length === 1) return;
      setTiers(tiers.filter((tier) => tier.unit !== unit));
      return;
    }
    const optionOrder = UNIT_OPTIONS[dimension];
    const next = [
      ...tiers,
      { unit, upTo: DEFAULT_THRESHOLD[unit] ?? 1000 },
    ].sort((a, b) => optionOrder.indexOf(a.unit) - optionOrder.indexOf(b.unit));
    setTiers(next);
  };

  const setThreshold = (index: number, value: number) => {
    const next = tiers.map((tier, tierIndex) =>
      tierIndex === index ? { ...tier, upTo: value } : tier,
    );
    setTiers(next);
  };

  return (
    <section className="rounded-2xl border border-[var(--line-strong)] bg-[var(--card)] p-4 md:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h3 className="rt-display text-2xl capitalize">{dimension}</h3>
        <span className="rt-mono text-[var(--ink-3)]">
          {tiers.length} {tiers.length === 1 ? "unit" : "units"} in the ladder
        </span>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {UNIT_OPTIONS[dimension].map((unit) => {
          const on = active.has(unit);
          const isOnlyUnit = on && tiers.length === 1;
          return (
            <button
              key={unit}
              type="button"
              onClick={() => toggle(unit)}
              disabled={isOnlyUnit}
              aria-pressed={on}
              aria-label={`${on ? "Remove" : "Add"} ${shortLabel(unit)}`}
              title={
                isOnlyUnit ? "A ladder needs at least one unit" : undefined
              }
              className={cn(
                "rt-mono rounded-full border px-3 py-1.5 transition-colors",
                on
                  ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                  : "border-[var(--line-strong)] text-[var(--ink-3)] hover:border-[var(--ink)] hover:text-[var(--ink)]",
                isOnlyUnit && "cursor-not-allowed opacity-50",
              )}
            >
              {on ? <Check className="mr-1 inline size-3" /> : "+ "}
              {shortLabel(unit)}
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        <ThresholdRuler
          dimension={dimension}
          tiers={tiers}
          onChange={setThreshold}
        />
        {tiers.slice(0, -1).map((tier, index) => {
          const { min, max } = dividerBounds(tiers, index);
          const next = tiers[index + 1];
          return (
            <div
              key={tier.unit}
              className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <label
                  htmlFor={`${dimension}-${tier.unit}-threshold`}
                  className="rt-body text-[var(--ink-2)]"
                >
                  {shortLabel(tier.unit)} hands off to{" "}
                  {next ? shortLabel(next.unit) : "the next unit"}
                </label>
                <span className="rt-mono shrink-0 text-[var(--terracotta)]">
                  at {thresholdLabel(tier.upTo, dimension)}
                </span>
              </div>
              <ThresholdInput
                id={`${dimension}-${tier.unit}-threshold`}
                label={`${shortLabel(tier.unit)} upper threshold in ${dimension === "weight" ? "grams" : "millilitres"}`}
                value={tier.upTo}
                min={min}
                max={max}
                suffix={dimension === "weight" ? "g" : "ml"}
                onCommit={(value) => setThreshold(index, value)}
              />
            </div>
          );
        })}
        {tiers.length === 1 && (
          <p className="rt-body text-sm text-[var(--ink-3)]">
            Every {dimension} is displayed in{" "}
            {shortLabel(tiers[0]?.unit ?? "g")}.
          </p>
        )}
      </div>
    </section>
  );
}

function formatSample(
  amount: number,
  unit: Unit,
  preference: UnitPreference,
): string {
  const converted = convertToSystem(amount, unit, preference);
  if (!converted) return `${amount} ${shortLabel(unit)}`;
  const rounded =
    converted.amount >= 100
      ? Math.round(converted.amount)
      : Number(converted.amount.toFixed(2));
  return `${rounded} ${shortLabel(converted.unit)}`;
}

export function UnitsPanel() {
  const [preference, setPreference] = useUnitPreference();
  const [undoPreference, setUndoPreference] = useState<UnitPreference | null>(
    null,
  );

  const updatePreference = (next: UnitPreference) => {
    setUndoPreference(null);
    setPreference(next);
  };

  const applyPreset = (system: MeasurementSystem) => {
    setUndoPreference(preference.preset === "custom" ? preference : null);
    setPreference(preferenceForSystem(system));
  };

  const presetDescription =
    PRESETS.find((preset) => preset.id === preference.preset)?.description ??
    CUSTOM_DESCRIPTION;

  return (
    <div>
      <PanelHead
        kicker="Units & measurements"
        title="Cook in your units."
        sub="Pick a starting system, then build your ladder. Choose the units you actually use and decide where each one hands off to the next. Recipes are re-expressed on the fly; the original is always kept."
      />

      <div className="mb-6">
        <p className="rt-mono mb-2 text-[var(--ink-3)]">Start from</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRESETS.map((preset) => {
            const on = preference.preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                aria-pressed={on}
                aria-label={preset.label}
                className={cn(
                  "min-w-0 rounded-xl border p-3 text-left transition-colors",
                  on
                    ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                    : "border-[var(--line-strong)] bg-[var(--card)] hover:border-[var(--ink)]",
                )}
              >
                <span className="rt-display block text-2xl">
                  {preset.label}
                </span>
                <span
                  className={cn(
                    "rt-mono mt-1 block",
                    on ? "text-[var(--butter)]" : "text-[var(--ink-3)]",
                  )}
                >
                  {preset.sub}
                </span>
              </button>
            );
          })}
          <div
            className={cn(
              "min-w-0 rounded-xl border p-3",
              preference.preset === "custom"
                ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                : "border-[var(--line-strong)] bg-[var(--card)] text-[var(--ink-3)]",
            )}
          >
            <span className="rt-display block text-2xl">Custom</span>
            <span className="rt-mono mt-1 block">your own ladder</span>
          </div>
        </div>
        <p
          aria-live="polite"
          className="rt-body mt-2 text-sm text-[var(--ink-3)]"
        >
          {presetDescription}
        </p>
        {undoPreference && (
          <output className="rt-body mt-3 flex items-center gap-3 text-sm text-[var(--ink-2)]">
            <span>Custom ladder replaced.</span>
            <button
              type="button"
              onClick={() => {
                setPreference(undoPreference);
                setUndoPreference(null);
              }}
              className="font-semibold text-[var(--terracotta)] underline underline-offset-2"
            >
              Undo
            </button>
          </output>
        )}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-4">
          <Ladder
            dimension="weight"
            preference={preference}
            onChange={updatePreference}
          />
          <Ladder
            dimension="volume"
            preference={preference}
            onChange={updatePreference}
          />
          <button
            type="button"
            onClick={() => applyPreset("uk")}
            className="rt-body inline-flex items-center gap-2 text-sm text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
          >
            <RotateCcw className="size-4" /> Reset to UK defaults
          </button>
        </div>

        <aside className="overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--card)] xl:sticky xl:top-24">
          <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper-warm)] px-4 py-3">
            <span className="rt-mono text-[var(--terracotta)]">
              Live · your units
            </span>
            <span className="rt-mono text-[var(--ink-4)]">original kept</span>
          </div>
          <div className="px-4 py-2">
            {SAMPLE.map((row) => (
              <div
                key={row.name}
                className="flex items-baseline gap-2 border-b border-dashed border-[var(--line)] py-2 last:border-0"
              >
                <span className="rt-body flex-1 text-sm text-[var(--ink-2)]">
                  {row.name}
                </span>
                <strong className="rt-display text-xl">
                  {formatSample(row.amount, row.unit, preference)}
                </strong>
                <span className="rt-mono text-right text-[var(--ink-4)]">
                  was {row.amount}
                  {shortLabel(row.unit)}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <output className="rt-mono mt-5 block text-[var(--sage)]">
        ● Changes save automatically on this device
      </output>
    </div>
  );
}

import { Wrench } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { EquipmentMatch } from "@/lib/domain/equipment-readiness";
import { cn } from "@/lib/generic/styles";

export function EquipmentWarning({
  match,
  compact = false,
  className,
}: Readonly<{
  match: EquipmentMatch;
  compact?: boolean;
  className?: string;
}>) {
  if (match.matches) return null;
  const names = match.missingEquipment.map((item) => item.name).join(", ");
  return (
    <div
      className={cn(
        "rt-body flex items-start gap-1.5 text-[var(--ink-3)]",
        compact ? "text-xs" : "text-sm",
        className,
      )}
    >
      <Wrench className="mt-0.5 size-3.5 shrink-0" />
      <p>
        <span>Missing equipment: {names}.</span>{" "}
        <Link
          href="/recipes/settings?section=household"
          className="underline underline-offset-2 hover:text-[var(--ink-2)]"
        >
          Manage equipment
        </Link>
      </p>
    </div>
  );
}

export function EquipmentListNotice({
  hiddenCount,
  mode,
  showingHidden,
  onToggleHidden,
}: Readonly<{
  hiddenCount: number;
  mode: "hide" | "warn" | "disabled";
  showingHidden: boolean;
  onToggleHidden: () => void;
}>) {
  if (mode === "warn") {
    return (
      <div className="rt-body mb-4 flex items-center gap-1.5 text-xs text-[var(--ink-3)]">
        <Wrench className="size-3.5 shrink-0" />
        Recipes that need equipment your household has not listed show a
        warning.
      </div>
    );
  }
  if (mode === "disabled") return null;
  if (hiddenCount === 0) return null;
  return (
    <div className="rt-body mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--paper-warm)] px-4 py-3 text-sm text-[var(--ink-2)]">
      <span>
        {hiddenCount} {hiddenCount === 1 ? "recipe needs" : "recipes need"}{" "}
        equipment your household has not listed.
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onToggleHidden}
      >
        {showingHidden ? "Hide again" : "Show anyway"}
      </Button>
    </div>
  );
}

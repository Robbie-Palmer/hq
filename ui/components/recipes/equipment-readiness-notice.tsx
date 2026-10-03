import { CircleAlert, Wrench } from "lucide-react";
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
        "rounded-md border border-[var(--butter-deep)]/50 bg-[var(--butter)]/15 text-[var(--ink-2)]",
        compact ? "px-2.5 py-2 text-xs" : "px-4 py-3 text-sm",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--terracotta)]" />
        <div>
          <p className="rt-body">Missing equipment: {names}.</p>
          <Link
            href="/recipes/settings?section=household"
            className="rt-mono mt-1 inline-block text-[var(--terracotta-deep)] underline underline-offset-2"
          >
            Update household equipment
          </Link>
        </div>
      </div>
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
  mode: "hide" | "warn";
  showingHidden: boolean;
  onToggleHidden: () => void;
}>) {
  if (mode === "warn") {
    return (
      <div className="rt-body mb-5 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper-warm)] px-4 py-3 text-sm text-[var(--ink-2)]">
        <Wrench className="size-4 shrink-0 text-[var(--terracotta)]" />
        Recipes that need equipment your household has not listed show a
        warning.
      </div>
    );
  }
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

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  retryTermReprojection,
  reverseTermResolution,
  type TermResolutionAuditItem,
} from "@/lib/api/term-resolution";
import type { TermReviewMutation } from "./term-review-types";

function AuditActions({
  item,
  mutate,
  pending,
}: Readonly<{
  item: TermResolutionAuditItem;
  mutate: TermReviewMutation;
  pending: boolean;
}>) {
  return (
    <div className="flex gap-2">
      {item.reprojection?.status === "failed" && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void mutate(() => retryTermReprojection(item.id))}
        >
          Retry
        </Button>
      )}
      {item.action !== "reversal" && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            void mutate(() =>
              reverseTermResolution(
                item,
                "Reviewer reversed the prior decision.",
              ),
            )
          }
        >
          <RotateCcw aria-hidden="true" /> Reverse
        </Button>
      )}
    </div>
  );
}

function AuditRow({
  item,
  mutate,
  pending,
}: Readonly<{
  item: TermResolutionAuditItem;
  mutate: TermReviewMutation;
  pending: boolean;
}>) {
  return (
    <tr className="border-t border-[var(--line)] align-top">
      <th scope="row" className="p-3 rt-body font-medium">
        {item.normalizedText}
        <span className="block rt-mono text-xs text-[var(--ink-3)]">
          {item.kind} · {item.locale}
        </span>
      </th>
      <td className="p-3 rt-body">
        {item.action.replace("_", " ")}
        {item.targetSlug ? ` → ${item.targetSlug}` : ""}
        <span className="block text-xs text-[var(--ink-3)]">
          {item.rationale}
        </span>
      </td>
      <td className="p-3 rt-mono text-sm">v{item.registryVersion}</td>
      <td className="p-3 rt-mono text-sm">
        {item.reprojection?.status ?? "missing"}
      </td>
      <td className="p-3">
        <AuditActions item={item} mutate={mutate} pending={pending} />
      </td>
    </tr>
  );
}

function AuditTableHead() {
  return (
    <thead className="bg-[var(--paper-warm)] rt-mono text-xs">
      <tr>
        {["Term", "Decision", "Registry", "Projection", "Actions"].map(
          (heading) => (
            <th key={heading} scope="col" className="p-3">
              {heading}
            </th>
          ),
        )}
      </tr>
    </thead>
  );
}

export function TermResolutionAudit({
  items,
  mutate,
  pending,
}: Readonly<{
  items: TermResolutionAuditItem[];
  mutate: TermReviewMutation;
  pending: boolean;
}>) {
  return (
    <section aria-labelledby="term-audit-heading" className="mt-10">
      <h2 id="term-audit-heading" className="rt-display text-3xl">
        Audit log
      </h2>
      <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--line)]">
        <table className="w-full min-w-[48rem] text-left">
          <AuditTableHead />
          <tbody>
            {items.map((item) => (
              <AuditRow
                key={item.id}
                item={item}
                mutate={mutate}
                pending={pending}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

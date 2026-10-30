import posthog from "posthog-js";
import { toast } from "sonner";
import {
  filterAppliedAction,
  nextFilterState,
  type UseFilterParamsReturn,
} from "@/hooks/use-filter-params";

interface CycleFromCardArgs {
  filterParams: UseFilterParamsReturn;
  paramName: string;
  value: string;
  /** Human-readable label used in the toast. Defaults to the raw value. */
  label?: string;
  /** Current page path for analytics. */
  page: string;
}

/**
 * Advances a filter value through off, include, exclude, and back to off from
 * a card badge.
 */
export function cycleFilterFromCard({
  filterParams,
  paramName,
  value,
  label,
  page,
}: CycleFromCardArgs): void {
  const previous = filterParams.peekState(paramName, value);
  const next = nextFilterState(previous);

  posthog.capture("filter_applied", {
    page,
    filter_type: paramName,
    filter_value: value,
    action: filterAppliedAction(next),
  });

  filterParams.setState(paramName, value, next);

  if (next === "exclude") {
    // A stable id keeps one toast per value. The Undo restores the prior state
    // only while the value is still excluded because another control may have
    // changed it while the toast was visible.
    toast(`Excluded ${label ?? value}`, {
      id: `filter-exclude:${paramName}:${value}`,
      description: "Hidden from results.",
      action: {
        label: "Undo",
        onClick: () => {
          if (filterParams.peekState(paramName, value) === "exclude") {
            filterParams.setState(paramName, value, previous);
          }
        },
      },
    });
  }
}

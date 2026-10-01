import { ChevronRight } from "lucide-react";
import {
  type AccommodationSetup,
  weddingAccommodationSetup,
} from "@/lib/wedding-planner/setup";
import type { Allocation, PartyName } from "@/lib/wedding-planner/types";
import { ResultPayments } from "./result-payments";
import { ResultProperties } from "./result-properties";
import { ResultSummary } from "./result-summary";

export function ResultPlan({
  allocation,
  parties,
  report,
  setup = weddingAccommodationSetup,
}: {
  allocation: Allocation;
  parties: PartyName[];
  report: string;
  setup?: AccommodationSetup;
}) {
  const names = Object.fromEntries(
    parties.map((party) => [party.id, party.guests.join(" & ")]),
  );

  return (
    <div className="result-plan">
      <ResultSummary allocation={allocation} setup={setup} />
      <div className="result-columns">
        <ResultProperties allocation={allocation} names={names} setup={setup} />
        <ResultPayments
          allocation={allocation}
          parties={parties}
          names={names}
          setup={setup}
        />
      </div>
      <details className="relation full-report">
        <summary>
          <span>
            <strong>Full calculation details</strong>
            <small>Show the complete text report</small>
          </span>
          <ChevronRight size={17} />
        </summary>
        <pre>{report}</pre>
      </details>
    </div>
  );
}

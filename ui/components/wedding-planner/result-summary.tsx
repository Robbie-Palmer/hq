import { Card, CardContent } from "@/components/ui/card";
import { formatMinorCurrency } from "@/lib/generic/money";
import type { AccommodationSetup } from "@/lib/wedding-planner/setup";
import type { Allocation } from "@/lib/wedding-planner/types";
import { propertyName } from "./room-data";

function SummaryCard({
  label,
  value,
}: Readonly<{ label: string; value: number }>) {
  return (
    <Card>
      <CardContent>
        <small>{label}</small>
        <strong>{formatMinorCurrency(value)}</strong>
      </CardContent>
    </Card>
  );
}

export function ResultSummary({
  allocation,
  setup,
}: Readonly<{
  allocation: Allocation;
  setup: AccommodationSetup;
}>) {
  const flow = allocation.cash_flow;
  const netStillToCover =
    flow.still_to_pay_pence - flow.cottage_guest_reimbursements_pence;
  return (
    <>
      <div className="result-summary">
        <SummaryCard
          label="Our total cost beyond the wedding package"
          value={flow.our_final_cost_pence}
        />
        <SummaryCard
          label="Already paid by us to cottages"
          value={flow.already_paid_pence}
        />
        <SummaryCard
          label={
            netStillToCover >= 0
              ? "Net still to cover after guest reimbursements"
              : "Expected back after remaining bills"
          }
          value={Math.abs(netStillToCover)}
        />
        <SummaryCard
          label="Guests expected to pay"
          value={flow.guest_expected_total_pence}
        />
      </div>
      <div className="result-note">
        {allocation.status === "optimal" ? "Optimal plan" : "Provisional plan"}{" "}
        · {allocation.outside_parties.length} bed group
        {allocation.outside_parties.length === 1 ? "" : "s"} outside
      </div>
      {allocation.tentative_cottage_bookings.length > 0 && (
        <div className="editor-warning">
          Availability has not been checked for{" "}
          {allocation.tentative_cottage_bookings
            .map((id) => propertyName(id, setup))
            .join(" and ")}
          . Placements there are tentative.
        </div>
      )}
    </>
  );
}

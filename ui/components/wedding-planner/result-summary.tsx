import { Card, CardContent } from "@/components/ui/card";
import { formatMinorCurrency } from "@/lib/generic/money";
import type { AccommodationSetup } from "@/lib/wedding-planner/setup";
import type { Allocation } from "@/lib/wedding-planner/types";
import { propertyName } from "./room-data";

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
  const includedNames = setup.input.properties
    .filter((property) => property.kind === "venue")
    .map((property) => property.name ?? property.id)
    .join(" and ");

  return (
    <>
      <div className="result-summary">
        <Card>
          <CardContent>
            <small>Our total cost beyond the wedding package</small>
            <strong>{formatMinorCurrency(flow.our_final_cost_pence)}</strong>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <small>Already paid by us to cottages</small>
            <strong>{formatMinorCurrency(flow.already_paid_pence)}</strong>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <small>
              {netStillToCover >= 0
                ? "Net still to cover after guest reimbursements"
                : "Expected back after remaining bills"}
            </small>
            <strong>{formatMinorCurrency(Math.abs(netStillToCover))}</strong>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <small>Guests expected to pay</small>
            <strong>
              {formatMinorCurrency(flow.guest_expected_total_pence)}
            </strong>
          </CardContent>
        </Card>
      </div>
      <p className="result-finance-note">
        Nothing extra is due for {includedNames}. We still owe{" "}
        {formatMinorCurrency(flow.still_to_pay_pence)} for cottage bookings and
        any outside stays we cover. We expect{" "}
        {formatMinorCurrency(flow.cottage_guest_reimbursements_pence)} back from
        cottage guests. Our total cost is what we have paid plus bills still
        due, less those reimbursements.
      </p>
      <div className="result-note">
        {allocation.status === "optimal"
          ? "Best plan found for your current choices."
          : "A valid plan was found. The search has not proved this is the best one."}{" "}
        {allocation.outside_parties.length} bed group
        {allocation.outside_parties.length === 1 ? "" : "s"} need outside
        accommodation.
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

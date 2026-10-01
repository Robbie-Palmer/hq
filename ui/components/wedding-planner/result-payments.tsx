import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AccommodationSetup } from "@/lib/wedding-planner/setup";
import { pounds } from "@/lib/wedding-planner/state";
import type { Allocation, PartyName } from "@/lib/wedding-planner/types";
import { propertyName } from "./room-data";

function GuestPayments({
  allocation,
  parties,
}: {
  allocation: Allocation;
  parties: PartyName[];
}) {
  const payments = parties
    .flatMap((party) =>
      (allocation.billing.member_amounts_pence_by_party[party.id] ?? []).map(
        (amount, index) => ({
          id: `${party.id}:${index}`,
          name: party.guests[index] ?? party.id,
          amount,
        }),
      ),
    )
    .filter((payment) => payment.amount > 0);
  const freeGuests = parties.flatMap((party) =>
    party.free_guest_indexes.map((index) => party.guests[index] ?? party.id),
  );
  return (
    <Card className="result-property">
      <CardHeader>
        <CardTitle>Guest payments</CardTitle>
        <CardDescription>
          Amounts for on-site rooms and cottages. For cottages we book, guests
          pay us back. Outside estimates are included in the headline total.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {payments.map((payment) => (
          <div className="result-room" key={payment.id}>
            <span>{payment.name}</span>
            <strong>{pounds(payment.amount)}</strong>
          </div>
        ))}
        {!payments.length && (
          <p className="editor-hint">No contributions in this plan.</p>
        )}
        {freeGuests.length > 0 && (
          <p className="editor-hint result-free-note">
            Free accommodation: {freeGuests.join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function OutsideAccommodation({
  allocation,
  names,
}: {
  allocation: Allocation;
  names: Record<string, string>;
}) {
  return (
    <Card className="result-property">
      <CardHeader>
        <CardTitle>Outside accommodation</CardTitle>
        <CardDescription>These guests need to book elsewhere.</CardDescription>
      </CardHeader>
      <CardContent>
        {allocation.outside_parties.length ? (
          allocation.outside_parties.map((id) => {
            const estimate = allocation.cash_flow.outside_by_party[id];
            return (
              <div className="result-room" key={id}>
                <span>{names[id] ?? id}</span>
                <strong>
                  {estimate
                    ? `Guests ${pounds(estimate.guest_pence)} · We cover ${pounds(estimate.covered_pence)}`
                    : "Estimate needed"}
                </strong>
              </div>
            );
          })
        ) : (
          <p className="editor-hint">
            Everyone marked as staying has a room here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PaymentBreakdown({
  allocation,
  names,
  setup,
}: {
  allocation: Allocation;
  names: Record<string, string>;
  setup: AccommodationSetup;
}) {
  const flow = allocation.cash_flow;
  const included = setup.input.properties.filter(
    (property) => property.kind === "venue",
  );
  return (
    <Card className="result-property">
      <CardHeader>
        <CardTitle>How the payments add up</CardTitle>
        <CardDescription>
          Cottage reimbursements reduce your final cost. Included room values
          are package reference figures, not new bills.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {Object.entries(flow.by_property)
          .filter(([, amounts]) => amounts.still_to_pay_pence > 0)
          .map(([propertyId, amounts]) => (
            <div className="result-room" key={propertyId}>
              <span>{propertyName(propertyId, setup)} still due</span>
              <strong>{pounds(amounts.still_to_pay_pence)}</strong>
            </div>
          ))}
        {flow.outside_we_cover_pence > 0 && (
          <div className="result-room">
            <span>Outside stays we cover, estimated</span>
            <strong>{pounds(flow.outside_we_cover_pence)}</strong>
          </div>
        )}
        <div className="result-room">
          <span>Cottage reimbursements expected from guests</span>
          <strong>{pounds(flow.cottage_guest_reimbursements_pence)}</strong>
        </div>
        {flow.guest_direct_pence > 0 && (
          <div className="result-room">
            <span>Guests pay directly to cottage or outside providers</span>
            <strong>{pounds(flow.guest_direct_pence)}</strong>
          </div>
        )}
        {included.map((property) => (
          <div className="result-room" key={property.id}>
            <span>{property.name ?? property.id} rate total</span>
            <strong>
              {pounds(
                allocation.billing.by_property[property.id]?.quoted_pence ?? 0,
              )}
            </strong>
          </div>
        ))}
        {allocation.venue_suite_package_value_gbp && (
          <div className="result-room">
            <span>Reported room figure within package</span>
            <strong>{allocation.venue_suite_package_value_gbp}</strong>
          </div>
        )}
        <div className="result-room">
          <span>Included room value not charged to guests</span>
          <strong>{pounds(allocation.billing.venue_unrecovered_pence)}</strong>
        </div>
        {flow.venue_guest_contributions_pence > 0 && (
          <div className="result-room">
            <span>Guest contributions toward the room package</span>
            <strong>{pounds(flow.venue_guest_contributions_pence)}</strong>
          </div>
        )}
        {flow.paid_without_room_pence > 0 && (
          <p className="editor-hint">
            {pounds(flow.paid_without_room_pence)} has been paid toward cottages
            with no guests in this plan. The total assumes that payment is not
            refunded.
          </p>
        )}
        {allocation.unknown_costs.length > 0 && (
          <p className="editor-hint">
            Outside prices still needed for:{" "}
            {allocation.unknown_costs.map((id) => names[id] ?? id).join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ResultPayments({
  allocation,
  parties,
  names,
  setup,
}: {
  allocation: Allocation;
  parties: PartyName[];
  names: Record<string, string>;
  setup: AccommodationSetup;
}) {
  return (
    <div>
      <GuestPayments allocation={allocation} parties={parties} />
      <OutsideAccommodation allocation={allocation} names={names} />
      <PaymentBreakdown allocation={allocation} names={names} setup={setup} />
    </div>
  );
}

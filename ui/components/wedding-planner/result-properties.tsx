import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AccommodationSetup } from "@/lib/wedding-planner/setup";
import { pounds } from "@/lib/wedding-planner/state";
import type {
  Allocation,
  Property,
  PropertyPayment,
  Room,
} from "@/lib/wedding-planner/types";

function propertyDescription(
  property: Property,
  allocation: Allocation,
): string {
  if (property.kind === "venue") return "Included in the wedding package";
  const detail = allocation.cottage_details[property.id];
  if (property.already_booked)
    return detail?.cost_gbp
      ? `Already booked by us · ${detail.cost_gbp} after discount`
      : "Already booked by us";
  if (!allocation.new_cottage_bookings.includes(property.id))
    return "Not needed in this plan";
  const availability =
    detail?.availability === "unknown"
      ? "Availability unconfirmed"
      : "Available";
  const booking =
    detail?.booking_by === "couple" ? "We would book" : "Guests would book";
  return `${availability} · ${booking} for ${detail?.cost_gbp ?? "an unknown price"}`;
}

function roomOccupants(
  room: Room,
  allocation: Allocation,
  names: Record<string, string>,
  singleBeds: Set<string>,
): string {
  const occupants = allocation.rooms[room.id] ?? [];
  if (!occupants.length) return "Empty";
  return occupants
    .map((partyId) => {
      const name = names[partyId] ?? partyId;
      if (!room.single_beds) return name;
      const bed = singleBeds.has(`${room.id}:${partyId}`)
        ? "single bed"
        : "double bed";
      return `${name} (${bed})`;
    })
    .join(" · ");
}

function PropertyPaymentSummary({
  property,
  payment,
  bookingBy,
}: Readonly<{
  property: Property;
  payment?: PropertyPayment;
  bookingBy?: "guests" | "couple";
}>) {
  if (!payment || (property.kind !== "venue" && payment.quoted_pence === 0))
    return null;
  return (
    <div className="property-payment-summary">
      <div className="result-room">
        <span>
          {property.kind === "venue" ? "Room rate value" : "Cottage rent"}
        </span>
        <strong>{pounds(payment.quoted_pence)}</strong>
      </div>
      <div className="result-room">
        <span>
          {property.kind !== "venue" && bookingBy === "couple"
            ? "Guests reimburse us"
            : "Guests pay"}
        </span>
        <strong>{pounds(payment.guest_pence)}</strong>
      </div>
      <div className="result-room">
        <span>
          {property.kind === "venue" ? "Value not charged" : "We cover"}
        </span>
        <strong>{pounds(payment.covered_pence)}</strong>
      </div>
    </div>
  );
}

export function ResultProperties({
  allocation,
  names,
  setup,
}: Readonly<{
  allocation: Allocation;
  names: Record<string, string>;
  setup: AccommodationSetup;
}>) {
  const singleBeds = new Set(
    allocation.single_bed_assignments.map(
      (assignment) => `${assignment.room_id}:${assignment.party_id}`,
    ),
  );
  return (
    <div>
      {setup.input.properties.map((property) => (
        <Card key={property.id} className="result-property">
          <CardHeader>
            <CardTitle>{property.name ?? property.id}</CardTitle>
            <CardDescription>
              {propertyDescription(property, allocation)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {setup.input.rooms
              .filter((room) => room.property_id === property.id)
              .map((room) => (
                <div className="result-room" key={room.id}>
                  <span>{room.name ?? room.id}</span>
                  <strong>
                    {roomOccupants(room, allocation, names, singleBeds)}
                  </strong>
                </div>
              ))}
            <PropertyPaymentSummary
              property={property}
              payment={allocation.billing.by_property[property.id]}
              bookingBy={allocation.cottage_details[property.id]?.booking_by}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

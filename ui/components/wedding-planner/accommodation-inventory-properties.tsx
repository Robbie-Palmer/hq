"use client";

import { Download, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { accommodationProviderManifest } from "wedding-planner-domain/accommodation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { editorStateToPlan } from "@/lib/wedding-planner/editor-projection";
import type {
  AccommodationProperty,
  AccommodationRoom,
  Guest,
  WeddingPlanDraft,
} from "@/lib/wedding-planner/types";
import {
  type AccommodationUpdate,
  downloadJson,
  emptyInventory,
  inventoryOf,
  newAccommodationId,
  parseAttributeMap,
  parseStringList,
} from "./accommodation-inventory-shared";
import {
  EditorField as Field,
  EditorSelect as Select,
} from "./editor-controls";

function bookingPayerChoices(
  property: AccommodationProperty,
  guests: Guest[],
  households: { id: string; name: string }[],
) {
  if (property.booking.payer.kind === "guest") return guests;
  if (property.booking.payer.kind === "household") return households;
  return [];
}

function propertyBookingFields({
  property,
  guests,
  households,
  change,
}: Readonly<{
  property: AccommodationProperty;
  guests: Guest[];
  households: { id: string; name: string }[];
  change: (change: (property: AccommodationProperty) => void) => void;
}>) {
  const payerChoices = bookingPayerChoices(property, guests, households);
  return (
    <details className="relation inventory-booking">
      <summary>Booking, payment and cancellation</summary>
      <div className="relation-body inventory-fields">
        <Field label="Booking state">
          <Select
            label={`${property.name} booking state`}
            value={property.booking.status}
            onChange={(status) =>
              change((item) => {
                item.booking.status = status as typeof item.booking.status;
              })
            }
          >
            <option value="researching">Researching</option>
            <option value="held">Held</option>
            <option value="booked">Booked</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Booking deadline">
          <Input
            aria-label={`${property.name} booking deadline`}
            type="date"
            value={property.booking_deadline ?? ""}
            onChange={(event) =>
              change((item) => {
                item.booking_deadline = event.target.value || null;
              })
            }
          />
        </Field>
        <Field label="Confirmation reference">
          <Input
            aria-label={`${property.name} confirmation reference`}
            value={property.booking.confirmation_reference}
            onChange={(event) =>
              change((item) => {
                item.booking.confirmation_reference = event.target.value;
              })
            }
          />
        </Field>
        <Field label="Confirmation details">
          <Input
            aria-label={`${property.name} confirmation details`}
            value={property.booking.confirmation_details}
            onChange={(event) =>
              change((item) => {
                item.booking.confirmation_details = event.target.value;
              })
            }
          />
        </Field>
        <Field label="Who pays?">
          <Select
            label={`${property.name} payer`}
            value={property.booking.payer.kind}
            onChange={(kind) =>
              change((item) => {
                item.booking.payer = {
                  kind: kind as typeof item.booking.payer.kind,
                  id: null,
                };
              })
            }
          >
            <option value="couple">The couple</option>
            <option value="guest_direct">Guests pay provider directly</option>
            <option value="guest">One guest</option>
            <option value="household">One household</option>
          </Select>
        </Field>
        {payerChoices.length > 0 && (
          <Field label="Payer">
            <Select
              label={`${property.name} payer record`}
              value={property.booking.payer.id ?? ""}
              onChange={(id) =>
                change((item) => {
                  item.booking.payer.id = id || null;
                })
              }
            >
              <option value="">Choose payer</option>
              {payerChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Cancellation">
          <Select
            label={`${property.name} cancellation state`}
            value={property.booking.cancellation_state}
            onChange={(value) =>
              change((item) => {
                item.booking.cancellation_state =
                  value as typeof item.booking.cancellation_state;
              })
            }
          >
            <option value="not_cancelled">Not cancelled</option>
            <option value="requested">Requested</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Refund">
          <Select
            label={`${property.name} refund state`}
            value={property.booking.refund_state}
            onChange={(value) =>
              change((item) => {
                item.booking.refund_state =
                  value as typeof item.booking.refund_state;
              })
            }
          >
            <option value="not_applicable">Not applicable</option>
            <option value="pending">Pending</option>
            <option value="partial">Partial</option>
            <option value="refunded">Refunded</option>
            <option value="lost">Not refundable</option>
          </Select>
        </Field>
      </div>
    </details>
  );
}

function roomCard({
  room,
  update,
  remove,
}: Readonly<{
  room: AccommodationRoom;
  update: (change: (room: AccommodationRoom) => void) => void;
  remove: () => void;
}>) {
  return (
    <div className="inventory-room" key={room.id}>
      <div className="inventory-room-heading">
        <strong>{room.name}</strong>
        <Button
          size="sm"
          variant="ghost"
          onClick={remove}
          aria-label={`Remove ${room.name}`}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <div className="inventory-fields">
        <Field label="Room name">
          <Input
            aria-label={`${room.id} room name`}
            value={room.name}
            onChange={(event) =>
              update((item) => {
                item.name = event.target.value;
              })
            }
          />
        </Field>
        <Field label="Capacity">
          <Input
            aria-label={`${room.name} capacity`}
            type="number"
            min="1"
            value={room.capacity}
            onChange={(event) =>
              update((item) => {
                item.capacity = Math.max(1, Number(event.target.value));
              })
            }
          />
        </Field>
        <Field label="Accessibility" hint="Comma-separated facilities">
          <Input
            aria-label={`${room.name} accessibility`}
            value={room.accessibility.join(", ")}
            onChange={(event) =>
              update((item) => {
                item.accessibility = parseStringList(event.target.value);
              })
            }
          />
        </Field>
      </div>
      <div className="inventory-beds">
        {room.beds.map((bed) => (
          <div key={bed.id} className="inventory-bed">
            <Input
              aria-label={`${room.name} bed name`}
              value={bed.name}
              onChange={(event) =>
                update((item) => {
                  item.beds.find((candidate) => candidate.id === bed.id)!.name =
                    event.target.value;
                })
              }
            />
            <Select
              label={`${bed.name} kind`}
              value={bed.kind}
              onChange={(kind) =>
                update((item) => {
                  item.beds.find((candidate) => candidate.id === bed.id)!.kind =
                    kind as typeof bed.kind;
                })
              }
            >
              <option value="single">Single</option>
              <option value="double">Double</option>
              <option value="sofa_bed">Sofa bed</option>
              <option value="cot">Cot</option>
              <option value="other">Other</option>
            </Select>
            <Input
              aria-label={`${bed.name} capacity`}
              type="number"
              min="1"
              value={bed.capacity}
              onChange={(event) =>
                update((item) => {
                  item.beds.find(
                    (candidate) => candidate.id === bed.id,
                  )!.capacity = Math.max(1, Number(event.target.value));
                })
              }
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${bed.name}`}
              onClick={() =>
                update((item) => {
                  item.beds = item.beds.filter(
                    (candidate) => candidate.id !== bed.id,
                  );
                })
              }
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            update((item) => {
              item.beds.push({
                id: newAccommodationId("bed"),
                name: `Bed ${item.beds.length + 1}`,
                kind: "double",
                capacity: 2,
              });
            })
          }
        >
          <Plus size={14} /> Add bed
        </Button>
      </div>
    </div>
  );
}

function propertyCard({
  property,
  state,
  update,
}: Readonly<{
  property: AccommodationProperty;
  state: WeddingPlanDraft;
  update: AccommodationUpdate;
}>) {
  const inventory = state.inventory ?? emptyInventory();
  const rooms = inventory.rooms.filter(
    (room) => room.property_id === property.id,
  );
  const change = (mutate: (item: AccommodationProperty) => void) =>
    update((draft) => {
      const item = inventoryOf(draft).properties.find(
        (candidate) => candidate.id === property.id,
      );
      if (item) mutate(item);
    });
  const changeRoom = (
    roomId: string,
    mutate: (room: AccommodationRoom) => void,
  ) =>
    update((draft) => {
      const room = inventoryOf(draft).rooms.find((item) => item.id === roomId);
      if (room) mutate(room);
    });
  return (
    <Card className="inventory-property" key={property.id}>
      <CardHeader>
        <div className="inventory-property-heading">
          <div>
            <CardTitle>{property.name}</CardTitle>
            <Badge variant="outline">
              {property.kind.replaceAll("_", " ")}
            </Badge>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              try {
                downloadJson(
                  `${property.id}-provider-manifest.json`,
                  accommodationProviderManifest(
                    editorStateToPlan(state),
                    property.id,
                  ),
                );
              } catch {
                // The validation report below identifies incomplete fields.
              }
            }}
          >
            <Download size={14} /> Provider export
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="inventory-fields">
          <Field label="Property name">
            <Input
              aria-label={`${property.id} property name`}
              value={property.name}
              onChange={(event) =>
                change((item) => {
                  item.name = event.target.value;
                })
              }
            />
          </Field>
          <Field label="Kind">
            <Select
              label={`${property.name} kind`}
              value={property.kind}
              onChange={(kind) =>
                change((item) => {
                  item.kind = kind as typeof item.kind;
                })
              }
            >
              <option value="hotel">Hotel</option>
              <option value="room_block">Hotel room block</option>
              <option value="private_house">Private house</option>
              <option value="venue">Venue rooms</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Check-in">
            <Input
              aria-label={`${property.name} check-in`}
              type="date"
              value={property.check_in_on}
              onChange={(event) =>
                change((item) => {
                  item.check_in_on = event.target.value;
                })
              }
            />
          </Field>
          <Field label="Check-out">
            <Input
              aria-label={`${property.name} check-out`}
              type="date"
              value={property.check_out_on}
              onChange={(event) =>
                change((item) => {
                  item.check_out_on = event.target.value;
                })
              }
            />
          </Field>
          <Field label="Address">
            <Input
              aria-label={`${property.name} address`}
              value={property.address}
              onChange={(event) =>
                change((item) => {
                  item.address = event.target.value;
                })
              }
            />
          </Field>
          <Field label="Provider name">
            <Input
              aria-label={`${property.name} provider name`}
              value={property.provider_name}
              onChange={(event) =>
                change((item) => {
                  item.provider_name = event.target.value;
                })
              }
            />
          </Field>
          <Field label="Provider contact">
            <Input
              aria-label={`${property.name} provider contact`}
              value={property.provider_contact}
              onChange={(event) =>
                change((item) => {
                  item.provider_contact = event.target.value;
                })
              }
            />
          </Field>
          <Field label="Accessibility" hint="Comma-separated facilities">
            <Input
              aria-label={`${property.name} accessibility`}
              value={property.accessibility.join(", ")}
              onChange={(event) =>
                change((item) => {
                  item.accessibility = parseStringList(event.target.value);
                })
              }
            />
          </Field>
          <Field
            label="Custom attributes"
            hint="Comma-separated key=value pairs, such as parking=on site"
          >
            <Input
              aria-label={`${property.name} custom attributes`}
              value={Object.entries(property.custom_attributes)
                .map(([key, value]) => `${key}=${value}`)
                .join(", ")}
              onChange={(event) =>
                change((item) => {
                  item.custom_attributes = parseAttributeMap(
                    event.target.value,
                  );
                })
              }
            />
          </Field>
          <Field label="Price basis">
            <Select
              label={`${property.name} price basis`}
              value={property.cost?.basis ?? "none"}
              onChange={(basis) =>
                change((item) => {
                  item.cost =
                    basis === "none"
                      ? null
                      : {
                          basis: basis as "nightly" | "fixed",
                          amount_gbp: item.cost?.amount_gbp || "0",
                        };
                })
              }
            >
              <option value="none">No charge or unknown</option>
              <option value="nightly">Per night</option>
              <option value="fixed">Fixed stay price</option>
            </Select>
          </Field>
          {property.cost && (
            <Field label="Quoted price">
              <Input
                aria-label={`${property.name} quoted price`}
                type="number"
                min="0"
                inputMode="decimal"
                value={property.cost.amount_gbp}
                onChange={(event) =>
                  change((item) => {
                    if (item.cost) item.cost.amount_gbp = event.target.value;
                  })
                }
              />
            </Field>
          )}
        </div>
        {propertyBookingFields({
          property,
          guests: state.guests,
          households: state.guest_directory?.households ?? [],
          change,
        })}
        <div className="inventory-rooms">
          <div className="inventory-section-heading">
            <h3>Rooms and beds</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                update((draft) => {
                  inventoryOf(draft).rooms.push({
                    id: newAccommodationId("room"),
                    property_id: property.id,
                    name: `Room ${rooms.length + 1}`,
                    capacity: 2,
                    accessibility: [],
                    custom_attributes: {},
                    beds: [],
                  });
                })
              }
            >
              <Plus size={14} /> Add room
            </Button>
          </div>
          {rooms.map((room) =>
            roomCard({
              room,
              update: (mutate) => changeRoom(room.id, mutate),
              remove: () =>
                update((draft) => {
                  const data = inventoryOf(draft);
                  data.assignments = data.assignments.filter(
                    (assignment) => assignment.room_id !== room.id,
                  );
                  data.rooms = data.rooms.filter((item) => item.id !== room.id);
                }),
            }),
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            update((draft) => {
              const data = inventoryOf(draft);
              const roomIds = new Set(
                data.rooms
                  .filter((room) => room.property_id === property.id)
                  .map((room) => room.id),
              );
              data.assignments = data.assignments.filter(
                (assignment) => !roomIds.has(assignment.room_id),
              );
              data.rooms = data.rooms.filter(
                (room) => room.property_id !== property.id,
              );
              data.properties = data.properties.filter(
                (item) => item.id !== property.id,
              );
            })
          }
        >
          <Trash2 size={14} /> Remove property
        </Button>
      </CardContent>
    </Card>
  );
}

function AddProperty({ update }: Readonly<{ update: AccommodationUpdate }>) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccommodationProperty["kind"]>("hotel");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  return addPropertyForm({
    update,
    name,
    setName,
    kind,
    setKind,
    checkIn,
    setCheckIn,
    checkOut,
    setCheckOut,
  });
}

function addPropertyForm({
  update,
  name,
  setName,
  kind,
  setKind,
  checkIn,
  setCheckIn,
  checkOut,
  setCheckOut,
}: Readonly<{
  update: AccommodationUpdate;
  name: string;
  setName: (value: string) => void;
  kind: AccommodationProperty["kind"];
  setKind: (value: AccommodationProperty["kind"]) => void;
  checkIn: string;
  setCheckIn: (value: string) => void;
  checkOut: string;
  setCheckOut: (value: string) => void;
}>) {
  const disabled = !name.trim() || !checkIn || !checkOut || checkIn >= checkOut;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add accommodation</CardTitle>
      </CardHeader>
      <CardContent className="inventory-fields">
        <Field label="Name">
          <Input
            aria-label="New accommodation name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Kind">
          <Select
            label="New accommodation kind"
            value={kind}
            onChange={(value) => setKind(value as typeof kind)}
          >
            <option value="hotel">Hotel</option>
            <option value="room_block">Hotel room block</option>
            <option value="private_house">Private house</option>
            <option value="venue">Venue rooms</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Check-in">
          <Input
            aria-label="New accommodation check-in"
            type="date"
            value={checkIn}
            onChange={(event) => setCheckIn(event.target.value)}
          />
        </Field>
        <Field label="Check-out">
          <Input
            aria-label="New accommodation check-out"
            type="date"
            value={checkOut}
            onChange={(event) => setCheckOut(event.target.value)}
          />
        </Field>
        <Button
          disabled={disabled}
          onClick={() => {
            update((draft) => {
              inventoryOf(draft).properties.push({
                id: newAccommodationId("property"),
                name: name.trim(),
                kind,
                address: "",
                provider_name: "",
                provider_contact: "",
                check_in_on: checkIn,
                check_out_on: checkOut,
                booking_deadline: null,
                accessibility: [],
                custom_attributes: {},
                cost: null,
                booking: {
                  status: "researching",
                  confirmation_reference: "",
                  confirmation_details: "",
                  payer: { kind: "couple", id: null },
                  commitment_id: null,
                  payment_ids: [],
                  cancellation_state: "not_cancelled",
                  refund_state: "not_applicable",
                },
              });
            });
            setName("");
          }}
        >
          <Plus size={15} /> Add accommodation
        </Button>
      </CardContent>
    </Card>
  );
}

export function AccommodationPropertiesEditor({
  state,
  update,
}: Readonly<{
  state: WeddingPlanDraft;
  update: AccommodationUpdate;
}>) {
  const inventory = state.inventory ?? emptyInventory();
  return (
    <>
      {inventory.properties.map((property) =>
        propertyCard({ property, state, update }),
      )}
      <AddProperty update={update} />
    </>
  );
}

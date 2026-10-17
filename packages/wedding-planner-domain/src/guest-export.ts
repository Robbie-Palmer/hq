import type { WeddingGuest } from "./core/guests";
import {
  canViewGuestField,
  type GuestDirectory,
  type GuestActor,
} from "./guest-directory";

export const guestExportPresets = {
  joy: [
    "title",
    "first_name",
    "last_name",
    "suffix",
    "email",
    "phone",
    "name_on_envelope",
    "invitation_party",
    "address_line_1",
    "address_line_2",
    "city",
    "region",
    "postal_code",
    "country",
    "tags",
    "plus_one_allowance",
  ],
  caterer: ["name", "attendance", "dietary_needs", "allergies"],
  venue: [
    "name",
    "attendance",
    "accessibility_needs",
    "transport",
    "accommodation_details",
  ],
} as const;

export type GuestExportPreset = keyof typeof guestExportPresets;

export type GuestExportOptions = {
  preset?: GuestExportPreset;
  fields?: string[];
  guest_ids?: string[];
  event_id?: string;
  actor?: GuestActor;
};

const labels: Record<string, string> = {
  id: "Guest ID",
  name: "Name",
  title: "Title (Optional)",
  first_name: "First Name",
  last_name: "Last Name",
  suffix: "Suffix (Optional)",
  email: "Email (Optional)",
  phone: "Phone Number (Optional)",
  name_on_envelope: "Name on Envelope (Optional)",
  household: "Household",
  invitation_party: "Party (Optional)",
  address_line_1: "Address Line 1 (Optional)",
  address_line_2: "Address Line 2 (Optional)",
  city: "City (Optional)",
  region: "State/Region (Optional)",
  postal_code: "Postal Code (Optional)",
  country: "Country (Optional)",
  plus_one_allowance: "Plus Ones",
  attendance: "Attendance",
  tags: "Tags (Optional)",
  wedding_roles: "Wedding Roles",
  dietary_needs: "Dietary Needs",
  allergies: "Allergies",
  accessibility_needs: "Accessibility Needs",
  transport: "Transport",
  accommodation_details: "Accommodation",
  event_response: "Event Response",
};

export function exportGuestCsv(
  directory: GuestDirectory,
  options: GuestExportOptions,
): string {
  const fields =
    options.fields ??
    (options.preset ? [...guestExportPresets[options.preset]] : ["name"]);
  if (fields.length === 0) throw new Error("Select at least one export field");
  if (new Set(fields).size !== fields.length)
    throw new Error("Export fields must be unique");
  const actor = options.actor ?? { role: "export_recipient" as const };
  const guests = options.guest_ids
    ? options.guest_ids.map((id) => {
        const guest = directory.guests.find((item) => item.id === id);
        if (!guest) throw new Error(`Guest ${id} does not exist`);
        return guest;
      })
    : directory.guests;

  for (const field of fields) {
    const accessField = accessFieldFor(field);
    if (
      guests.some(
        (guest) => !canViewGuestField(directory, guest.id, accessField, actor),
      )
    )
      throw new Error(`${actor.role} cannot export ${field}`);
  }

  const header = fields.map((field) => csvValue(fieldLabel(directory, field)));
  const rows = guests.map((guest) =>
    fields.map((field) =>
      csvValue(exportValue(directory, guest, field, options)),
    ),
  );
  return [header, ...rows].map((row) => row.join(",")).join("\r\n");
}

function accessFieldFor(field: string): string {
  if (
    [
      "household",
      "address_line_1",
      "address_line_2",
      "city",
      "region",
      "postal_code",
      "country",
    ].includes(field)
  )
    return "household_id";
  if (field === "invitation_party" || field === "name_on_envelope")
    return "invitation_party_id";
  if (field === "event_response") return "event_responses";
  return field;
}

function fieldLabel(directory: GuestDirectory, field: string): string {
  if (field.startsWith("custom_fields.")) {
    const id = field.slice("custom_fields.".length);
    return (
      directory.guest_directory.custom_fields.find((item) => item.id === id)
        ?.label ?? id
    );
  }
  return labels[field] ?? field;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Each branch projects one supported virtual export field.
function exportValue(
  directory: GuestDirectory,
  guest: WeddingGuest,
  field: string,
  options: GuestExportOptions,
): string {
  if (field.startsWith("custom_fields."))
    return printable(guest.custom_fields[field.slice("custom_fields.".length)]);
  if (field === "first_name")
    return guest.first_name || guest.name.trim().split(/\s+/)[0] || "";
  if (field === "last_name")
    return guest.last_name || guest.name.trim().split(/\s+/).slice(1).join(" ");
  if (field === "household")
    return (
      directory.guest_directory.households.find(
        (household) => household.id === guest.household_id,
      )?.name ?? ""
    );
  if (field === "invitation_party")
    return (
      directory.guest_directory.invitation_parties.find(
        (party) => party.id === guest.invitation_party_id,
      )?.name ?? ""
    );
  if (field === "name_on_envelope")
    return (
      directory.guest_directory.invitation_parties.find(
        (party) => party.id === guest.invitation_party_id,
      )?.addressee ?? ""
    );
  if (
    [
      "address_line_1",
      "address_line_2",
      "city",
      "region",
      "postal_code",
      "country",
    ].includes(field)
  ) {
    const household = directory.guest_directory.households.find(
      (item) => item.id === guest.household_id,
    );
    if (!household) return "";
    if (field === "address_line_1") return household.address_lines[0] ?? "";
    if (field === "address_line_2") return household.address_lines[1] ?? "";
    return household[field as "city" | "region" | "postal_code" | "country"];
  }
  if (field === "event_response") {
    if (!options.event_id)
      throw new Error("event_id is required when exporting event_response");
    return guest.event_responses[options.event_id]?.response ?? "unknown";
  }
  if (!(field in guest))
    throw new Error(`Unknown guest export field: ${field}`);
  return printable(guest[field as keyof WeddingGuest]);
}

function printable(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object")
    return Object.entries(value)
      .filter(([, item]) => item !== "" && item !== null && item !== false)
      .map(([key, item]) => `${key}: ${printable(item)}`)
      .join("; ");
  return String(value);
}

function csvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

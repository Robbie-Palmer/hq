import type { WeddingRole } from "../../core/guests";
import type { GuestDirectory } from "../../guest-directory";

export type JoyExportMapping = {
  relationship_groups: Record<string, string | null>;
  wedding_roles: Partial<Record<WeddingRole, string | null>>;
};

export type JoyExportOptions = {
  guest_ids?: string[];
  mapping: JoyExportMapping;
};

const headers = [
  "Title (Optional)",
  "First Name",
  "Last Name",
  "Suffix (Optional)",
  "Email (Optional)",
  "Phone Number (Optional)",
  "Name on Envelope (Optional)",
  "Party (Optional)",
  "Address Line 1 (Optional)",
  "Address Line 2 (Optional)",
  "City (Optional)",
  "State/Region (Optional)",
  "Postal Code (Optional)",
  "Country (Optional)",
  "Tags (Optional)",
  "Plus Ones",
];

export function exportJoyCsv(
  directory: GuestDirectory,
  options: JoyExportOptions,
): string {
  const guests = options.guest_ids
    ? options.guest_ids.map((id) => {
        const guest = directory.guests.find((item) => item.id === id);
        if (!guest) throw new Error(`Guest ${id} does not exist`);
        return guest;
      })
    : directory.guests;

  const rows = guests.map((guest) => {
    const party = directory.guest_directory.invitation_parties.find(
      (item) => item.id === guest.invitation_party_id,
    );
    const household = directory.guest_directory.households.find(
      (item) => item.id === guest.household_id,
    );
    const tags = joyTagsForGuest(
      guest.relationship_groups,
      guest.wedding_roles,
      options.mapping,
    );
    return [
      guest.title,
      guest.first_name || guest.name.trim().split(/\s+/)[0] || "",
      guest.last_name || guest.name.trim().split(/\s+/).slice(1).join(" "),
      guest.suffix,
      guest.email,
      guest.phone,
      party?.addressee ?? "",
      party?.name ?? "",
      household?.address_lines[0] ?? "",
      household?.address_lines[1] ?? "",
      household?.city ?? "",
      household?.region ?? "",
      household?.postal_code ?? "",
      household?.country ?? "",
      tags.join("; "),
      String(guest.plus_one_allowance),
    ];
  });

  return [headers, ...rows]
    .map((row) => row.map(csvValue).join(","))
    .join("\r\n");
}

function joyTagsForGuest(
  relationshipGroups: readonly string[],
  weddingRoles: readonly WeddingRole[],
  mapping: JoyExportMapping,
): string[] {
  const tags = new Set<string>();
  for (const group of relationshipGroups)
    addMappedTag(
      tags,
      mapping.relationship_groups,
      group,
      "relationship group",
    );
  for (const role of weddingRoles)
    addMappedTag(tags, mapping.wedding_roles, role, "wedding role");
  return [...tags];
}

function addMappedTag(
  tags: Set<string>,
  mapping: Record<string, string | null | undefined>,
  value: string,
  concept: string,
) {
  if (!(value in mapping))
    throw new Error(
      `Joy export needs a tag mapping or ignore decision for ${concept}: ${value}`,
    );
  const tag = mapping[value];
  if (tag) tags.add(tag);
}

function csvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

import {
  type WeddingGuest,
  type WeddingRole,
  weddingGuestSchema,
} from "../../core/guests";
import {
  historyId,
  type GuestDirectory,
  validateGuestDirectory,
} from "../../guest-directory";

const noJoyImportMapping: JoyImportMapping = { tags: {} };

type ImportableGuestField =
  | "name"
  | "title"
  | "first_name"
  | "last_name"
  | "suffix"
  | "email"
  | "phone"
  | "plus_one_allowance"
  | "attendance"
  | "is_child"
  | "relationship_groups"
  | "wedding_roles"
  | "dietary_needs"
  | "allergies"
  | "accessibility_needs";

type IncomingGuest = Partial<Pick<WeddingGuest, ImportableGuestField>> & {
  name: string;
  external_id: string | null;
  invitation_party_name: string;
  name_on_envelope: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  joy_tags: string[];
};

export type JoyTagMapping =
  | { kind: "relationship_group"; relationship_group: string }
  | { kind: "wedding_role"; wedding_role: WeddingRole }
  | { kind: "ignore" };

export type JoyImportMapping = {
  tags: Record<string, JoyTagMapping>;
};

export type JoyImportSource = {
  id: string;
  source_name: string;
  imported_at: string;
};

export type JoyDuplicateCandidate = {
  guest_id: string;
  reasons: string[];
};

export type JoyImportRow = {
  row_number: number;
  incoming: IncomingGuest;
  unmapped_tags: string[];
  issues: string[];
  duplicate_candidates: JoyDuplicateCandidate[];
  differing_fields: Record<string, { existing: unknown; incoming: unknown }>;
};

export type JoyImportPreview = {
  source: JoyImportSource;
  fingerprint: string;
  headers: string[];
  ignored_headers: string[];
  errors: string[];
  rows: JoyImportRow[];
};

export type JoyImportDecision =
  | { row_number: number; action: "skip" }
  | { row_number: number; action: "create"; guest_id?: string }
  | {
      row_number: number;
      action: "merge";
      guest_id: string;
      fields: Record<string, "keep_existing" | "use_import">;
    };

const headerAliases: Record<string, keyof IncomingGuest> = {
  "guest id": "external_id",
  "joy id": "external_id",
  id: "external_id",
  name: "name",
  "full name": "name",
  title: "title",
  "first name": "first_name",
  "last name": "last_name",
  suffix: "suffix",
  email: "email",
  "email address": "email",
  phone: "phone",
  "phone number": "phone",
  party: "invitation_party_name",
  "party name": "invitation_party_name",
  "invitation party": "invitation_party_name",
  "name on envelope": "name_on_envelope",
  "address line 1": "address_line_1",
  "address line 2": "address_line_2",
  city: "city",
  "state region": "region",
  state: "region",
  region: "region",
  "postal code": "postal_code",
  postcode: "postal_code",
  country: "country",
  tags: "joy_tags",
  "plus ones": "plus_one_allowance",
  rsvp: "attendance",
  attendance: "attendance",
  child: "is_child",
  "is child": "is_child",
  "dietary restrictions": "dietary_needs",
  "dietary needs": "dietary_needs",
  allergies: "allergies",
  "accessibility needs": "accessibility_needs",
};

export function previewJoyCsv(
  directory: GuestDirectory,
  csv: string,
  source: JoyImportSource,
  mapping: JoyImportMapping = noJoyImportMapping,
): JoyImportPreview {
  const records = parseCsv(csv);
  const headers = records[0]?.map((header) => header.trim()) ?? [];
  const normalizedHeaders = headers.map(normalizeHeader);
  const mappedHeaders = normalizedHeaders.map(
    (header) => headerAliases[header],
  );
  const ignoredHeaders = headers.filter((_, index) => !mappedHeaders[index]);
  const errors: string[] = [];
  if (headers.length === 0) errors.push("The CSV file has no header row");
  if (!mappedHeaders.includes("name") && !mappedHeaders.includes("first_name"))
    errors.push("The CSV file needs a Name, Full Name, or First Name column");

  const rows = records.slice(1).flatMap((values, index) => {
    if (values.every((value) => value.trim() === "")) return [];
    const incoming = toIncomingGuest(values, mappedHeaders, mapping);
    const unmappedTags = incoming.joy_tags.filter(
      (tag) => mapping.tags[tag] === undefined,
    );
    const issues = validateIncomingGuest(incoming, unmappedTags);
    const duplicateCandidates = findDuplicateCandidates(directory, incoming);
    const oneCandidate =
      duplicateCandidates.length === 1
        ? directory.guests.find(
            (guest) => guest.id === duplicateCandidates[0]?.guest_id,
          )
        : undefined;
    return [
      {
        row_number: index + 2,
        incoming,
        unmapped_tags: unmappedTags,
        issues,
        duplicate_candidates: duplicateCandidates,
        differing_fields: oneCandidate
          ? differingFields(directory, oneCandidate, incoming)
          : {},
      },
    ];
  });

  return {
    source,
    fingerprint: fingerprint(csv),
    headers,
    ignored_headers: ignoredHeaders,
    errors,
    rows,
  };
}

export function applyJoyImport(
  directory: GuestDirectory,
  preview: JoyImportPreview,
  decisions: readonly JoyImportDecision[],
): void {
  if (preview.errors.length > 0)
    throw new Error(`The Joy import is invalid: ${preview.errors.join("; ")}`);
  const decisionsByRow = new Map(
    decisions.map((decision) => [decision.row_number, decision]),
  );
  if (decisionsByRow.size !== decisions.length)
    throw new Error("Each Joy row can have only one import decision");
  const missing = preview.rows.filter(
    (row) => !decisionsByRow.has(row.row_number),
  );
  if (missing.length > 0)
    throw new Error(
      `Every Joy row needs an explicit decision: ${missing.map((row) => row.row_number).join(", ")}`,
    );
  const previewRows = new Set(preview.rows.map((row) => row.row_number));
  const extra = decisions.filter(
    (decision) => !previewRows.has(decision.row_number),
  );
  if (extra.length > 0)
    throw new Error(
      `Import decisions refer to unknown Joy rows: ${extra.map((decision) => decision.row_number).join(", ")}`,
    );

  const draft = structuredClone(directory);
  let created = 0;
  let merged = 0;
  let skipped = 0;
  for (const row of preview.rows) {
    const decision = decisionsByRow.get(row.row_number);
    if (!decision) throw new Error(`Joy row ${row.row_number} has no decision`);
    if (decision.action === "skip") {
      skipped += 1;
      continue;
    }
    if (row.issues.length > 0)
      throw new Error(
        `Joy row ${row.row_number} must be skipped until its validation errors are fixed`,
      );
    if (decision.action === "create") {
      createGuest(draft, preview, row, decision.guest_id);
      created += 1;
      continue;
    }
    mergeGuest(draft, preview, row, decision);
    merged += 1;
  }

  draft.guest_directory.imports.push({
    id: preview.source.id,
    system: "joy",
    source_name: preview.source.source_name,
    fingerprint: preview.fingerprint,
    imported_at: preview.source.imported_at,
    created,
    merged,
    skipped,
  });
  validateGuestDirectory(draft);
  directory.guests = draft.guests;
  directory.guest_directory = draft.guest_directory;
}

function createGuest(
  directory: GuestDirectory,
  preview: JoyImportPreview,
  row: JoyImportRow,
  requestedId?: string,
) {
  const guestId = requestedId ?? availableGuestId(directory, row);
  if (directory.guests.some((guest) => guest.id === guestId))
    throw new Error(`Guest ${guestId} already exists`);
  const partyId = invitationPartyId(
    directory,
    row.incoming.invitation_party_name,
    row.incoming.name_on_envelope,
  );
  const householdId = householdIdForImport(directory, row.incoming);
  const sourceRecord = sourceRecordFor(preview, row);
  const {
    external_id: _externalId,
    invitation_party_name: _party,
    name_on_envelope: _addressee,
    address_line_1: _address1,
    address_line_2: _address2,
    city: _city,
    region: _region,
    postal_code: _postalCode,
    country: _country,
    joy_tags: _joyTags,
    ...fields
  } = row.incoming;
  const guest = weddingGuestSchema.parse({
    id: guestId,
    source_party: row.incoming.invitation_party_name,
    invitation_party_id: partyId,
    household_id: householdId,
    ...fields,
    source_records: [sourceRecord],
    field_provenance: Object.fromEntries(
      Object.keys(fields).map((field) => [field, [sourceRecord]]),
    ),
  });
  directory.guests.push(guest);
  directory.guest_directory.history.push({
    id: historyId(
      guestId,
      preview.source.imported_at,
      directory.guest_directory.history.length,
    ),
    guest_id: guestId,
    changed_at: preview.source.imported_at,
    actor_type: "integration",
    actor_id: "joy-csv",
    kind: "create",
    changes: Object.entries(fields).map(([field, after]) => ({
      field,
      after,
      provenance: `joy:${preview.source.id}:${row.row_number}`,
    })),
  });
}

function mergeGuest(
  directory: GuestDirectory,
  preview: JoyImportPreview,
  row: JoyImportRow,
  decision: Extract<JoyImportDecision, { action: "merge" }>,
) {
  const index = directory.guests.findIndex(
    (guest) => guest.id === decision.guest_id,
  );
  const current = directory.guests[index];
  if (!current) throw new Error(`Guest ${decision.guest_id} does not exist`);
  const differences = differingFields(directory, current, row.incoming);
  const unresolved = Object.keys(differences).filter(
    (field) => !decision.fields[field],
  );
  if (unresolved.length > 0)
    throw new Error(
      `Joy row ${row.row_number} needs merge decisions for: ${unresolved.join(", ")}`,
    );

  const sourceRecord = sourceRecordFor(preview, row);
  const updated = structuredClone(current);
  const changes: {
    field: string;
    before?: unknown;
    after?: unknown;
    provenance: string;
  }[] = [];
  for (const [field, values] of Object.entries(differences)) {
    if (decision.fields[field] !== "use_import") continue;
    const after = applyImportedField(
      directory,
      updated,
      field,
      values.incoming,
    );
    changes.push({
      field,
      before: structuredClone(values.existing),
      after: structuredClone(after),
      provenance: `joy:${preview.source.id}:${row.row_number}`,
    });
    updated.field_provenance[field] = [
      ...(updated.field_provenance[field] ?? []),
      sourceRecord,
    ];
  }
  updated.source_records.push(sourceRecord);
  directory.guests[index] = updated;
  if (changes.length > 0)
    directory.guest_directory.history.push({
      id: historyId(
        updated.id,
        preview.source.imported_at,
        directory.guest_directory.history.length,
      ),
      guest_id: updated.id,
      changed_at: preview.source.imported_at,
      actor_type: "integration",
      actor_id: "joy-csv",
      kind: "import",
      changes,
    });
}

function differingFields(
  directory: GuestDirectory,
  guest: WeddingGuest,
  incoming: IncomingGuest,
) {
  const differences: Record<string, { existing: unknown; incoming: unknown }> =
    {};
  for (const [field, value] of Object.entries(incoming)) {
    if (
      field === "external_id" ||
      field === "joy_tags" ||
      value === undefined ||
      value === ""
    )
      continue;
    const targetField = importTargetField(field);
    const current = currentImportedValue(directory, guest, targetField);
    if (JSON.stringify(current) !== JSON.stringify(value))
      differences[targetField] = { existing: current, incoming: value };
  }
  return differences;
}

function importTargetField(field: string): string {
  if (field === "invitation_party_name") return "invitation_party_id";
  if (field === "name_on_envelope") return "invitation_addressee";
  if (
    [
      "address_line_1",
      "address_line_2",
      "city",
      "region",
      "postal_code",
      "country",
    ].includes(field)
  )
    return `household.${field}`;
  return field;
}

function currentImportedValue(
  directory: GuestDirectory,
  guest: WeddingGuest,
  field: string,
): unknown {
  if (field === "invitation_party_id")
    return (
      directory.guest_directory.invitation_parties.find(
        (party) => party.id === guest.invitation_party_id,
      )?.name ?? ""
    );
  if (field === "invitation_addressee")
    return (
      directory.guest_directory.invitation_parties.find(
        (party) => party.id === guest.invitation_party_id,
      )?.addressee ?? ""
    );
  if (field.startsWith("household.")) {
    const household = directory.guest_directory.households.find(
      (item) => item.id === guest.household_id,
    );
    return householdValue(household, field.slice("household.".length));
  }
  return guest[field as keyof WeddingGuest];
}

function applyImportedField(
  directory: GuestDirectory,
  guest: WeddingGuest,
  field: string,
  value: unknown,
): unknown {
  if (field === "invitation_party_id") {
    const id = invitationPartyId(directory, String(value));
    guest.invitation_party_id = id;
    guest.source_party = String(value);
    return id;
  }
  if (field === "invitation_addressee") {
    const partyId =
      guest.invitation_party_id ??
      invitationPartyId(
        directory,
        guest.source_party || guest.name,
        String(value),
      );
    const party = directory.guest_directory.invitation_parties.find(
      (item) => item.id === partyId,
    );
    if (party) party.addressee = String(value);
    guest.invitation_party_id = partyId;
    return value;
  }
  if (field.startsWith("household.")) {
    const household = ensureHousehold(directory, guest);
    setHouseholdValue(
      household,
      field.slice("household.".length),
      String(value),
    );
    guest.household_id = household.id;
    return value;
  }
  (guest as Record<string, unknown>)[field] = structuredClone(value);
  return value;
}

function findDuplicateCandidates(
  directory: GuestDirectory,
  incoming: IncomingGuest,
): JoyDuplicateCandidate[] {
  const normalizedEmail = incoming.email?.trim().toLowerCase();
  const normalizedPhone = normalizePhone(incoming.phone ?? "");
  const normalizedName = normalizeName(incoming.name);
  return directory.guests.flatMap((guest) => {
    const reasons: string[] = [];
    if (
      incoming.external_id &&
      guest.source_records.some(
        (source) =>
          source.system === "joy" &&
          source.external_id === incoming.external_id,
      )
    )
      reasons.push("same Joy guest ID");
    if (normalizedEmail && guest.email.toLowerCase() === normalizedEmail)
      reasons.push("same email address");
    if (normalizedPhone && normalizePhone(guest.phone) === normalizedPhone)
      reasons.push("same phone number");
    if (
      normalizeName(guest.name) === normalizedName &&
      guest.source_party.trim().toLowerCase() ===
        incoming.invitation_party_name.trim().toLowerCase()
    )
      reasons.push("same name and invitation party");
    return reasons.length > 0 ? [{ guest_id: guest.id, reasons }] : [];
  });
}

function toIncomingGuest(
  values: string[],
  fields: (keyof IncomingGuest | undefined)[],
  mapping: JoyImportMapping,
): IncomingGuest {
  const raw = Object.fromEntries(
    fields.flatMap((field, index) =>
      field ? [[field, values[index]?.trim() ?? ""]] : [],
    ),
  ) as Record<keyof IncomingGuest, string>;
  const name =
    raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(" ");
  const joyTags = raw.joy_tags ? listValue(raw.joy_tags) : [];
  const translatedTags = translateJoyTags(joyTags, mapping);
  const incoming: IncomingGuest = {
    name,
    external_id: raw.external_id || null,
    invitation_party_name: raw.invitation_party_name ?? "",
    name_on_envelope: raw.name_on_envelope ?? "",
    address_line_1: raw.address_line_1 ?? "",
    address_line_2: raw.address_line_2 ?? "",
    city: raw.city ?? "",
    region: raw.region ?? "",
    postal_code: raw.postal_code ?? "",
    country: raw.country ?? "",
    joy_tags: joyTags,
  };
  if (translatedTags.relationshipGroups.length > 0)
    incoming.relationship_groups = translatedTags.relationshipGroups;
  if (translatedTags.weddingRoles.length > 0)
    incoming.wedding_roles = translatedTags.weddingRoles;
  Object.assign(
    incoming,
    nonEmptyStrings(raw, [
      "title",
      "first_name",
      "last_name",
      "suffix",
      "email",
      "phone",
    ]),
  );
  assignConvertedFields(incoming, raw);
  return incoming;
}

function nonEmptyStrings(
  raw: Record<keyof IncomingGuest, string>,
  fields: readonly (keyof IncomingGuest)[],
): Record<string, string> {
  return Object.fromEntries(
    fields.flatMap((field) => (raw[field] ? [[field, raw[field]]] : [])),
  );
}

function assignConvertedFields(
  incoming: IncomingGuest,
  raw: Record<keyof IncomingGuest, string>,
) {
  const converters: Partial<
    Record<keyof IncomingGuest, (value: string) => unknown>
  > = {
    plus_one_allowance: integerValue,
    attendance: attendanceValue,
    is_child: booleanValue,
    dietary_needs: listValue,
    allergies: listValue,
    accessibility_needs: listValue,
  };
  for (const [field, convert] of Object.entries(converters)) {
    const value = raw[field as keyof IncomingGuest];
    if (value && convert) Object.assign(incoming, { [field]: convert(value) });
  }
}

function validateIncomingGuest(
  incoming: IncomingGuest,
  unmappedTags: readonly string[],
): string[] {
  const issues: string[] = [];
  if (!incoming.name) issues.push("Name is required");
  if (incoming.email && !isEmailAddress(incoming.email))
    issues.push("Email address is invalid");
  if (unmappedTags.length > 0)
    issues.push(
      `Joy tags need an explicit mapping or ignore decision: ${unmappedTags.join(", ")}`,
    );
  return issues;
}

function translateJoyTags(tags: readonly string[], mapping: JoyImportMapping) {
  const relationshipGroups = new Set<string>();
  const weddingRoles = new Set<WeddingRole>();
  for (const tag of tags) {
    const target = mapping.tags[tag];
    if (target?.kind === "relationship_group")
      relationshipGroups.add(target.relationship_group);
    if (target?.kind === "wedding_role") weddingRoles.add(target.wedding_role);
  }
  return {
    relationshipGroups: [...relationshipGroups],
    weddingRoles: [...weddingRoles],
  };
}

function isEmailAddress(value: string): boolean {
  const at = value.indexOf("@");
  const dot = value.indexOf(".", at + 2);
  return (
    at > 0 &&
    at === value.lastIndexOf("@") &&
    dot > at + 1 &&
    dot < value.length - 1 &&
    !/\s/u.test(value)
  );
}

function invitationPartyId(
  directory: GuestDirectory,
  partyName: string,
  addressee = "",
): string | null {
  const resolvedName = partyName || addressee;
  if (!resolvedName) return null;
  const existing = directory.guest_directory.invitation_parties.find(
    (party) =>
      party.name.trim().toLowerCase() === resolvedName.trim().toLowerCase(),
  );
  if (existing) {
    if (addressee && !existing.addressee) existing.addressee = addressee;
    return existing.id;
  }
  const base = `party-${slug(resolvedName) || "imported"}`;
  const id = availableId(
    base,
    new Set(
      directory.guest_directory.invitation_parties.map((party) => party.id),
    ),
  );
  directory.guest_directory.invitation_parties.push({
    id,
    name: resolvedName,
    addressee,
    greeting: "",
    private_notes: [],
  });
  return id;
}

function householdIdForImport(
  directory: GuestDirectory,
  incoming: IncomingGuest,
): string | null {
  const address = [
    incoming.address_line_1,
    incoming.address_line_2,
    incoming.city,
    incoming.region,
    incoming.postal_code,
    incoming.country,
  ];
  if (address.every((value) => !value)) return null;
  const name = incoming.invitation_party_name || `${incoming.name} household`;
  let household = directory.guest_directory.households.find(
    (item) => item.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (!household) {
    const id = availableId(
      `household-${slug(name) || "imported"}`,
      new Set(directory.guest_directory.households.map((item) => item.id)),
    );
    household = {
      id,
      name,
      address_lines: [],
      city: "",
      region: "",
      postal_code: "",
      country: "",
      private_notes: [],
    };
    directory.guest_directory.households.push(household);
  }
  if (household.address_lines.length === 0)
    household.address_lines = [
      incoming.address_line_1,
      incoming.address_line_2,
    ].filter(Boolean);
  if (!household.city) household.city = incoming.city;
  if (!household.region) household.region = incoming.region;
  if (!household.postal_code) household.postal_code = incoming.postal_code;
  if (!household.country) household.country = incoming.country;
  return household.id;
}

function ensureHousehold(directory: GuestDirectory, guest: WeddingGuest) {
  const existing = directory.guest_directory.households.find(
    (item) => item.id === guest.household_id,
  );
  if (existing) return existing;
  const name = guest.source_party || `${guest.name} household`;
  const id = availableId(
    `household-${slug(name) || "imported"}`,
    new Set(directory.guest_directory.households.map((item) => item.id)),
  );
  const household = {
    id,
    name,
    address_lines: [] as string[],
    city: "",
    region: "",
    postal_code: "",
    country: "",
    private_notes: [] as string[],
  };
  directory.guest_directory.households.push(household);
  return household;
}

function householdValue(
  household:
    | GuestDirectory["guest_directory"]["households"][number]
    | undefined,
  field: string,
): string {
  if (!household) return "";
  if (field === "address_line_1") return household.address_lines[0] ?? "";
  if (field === "address_line_2") return household.address_lines[1] ?? "";
  if (field === "city") return household.city;
  if (field === "region") return household.region;
  if (field === "postal_code") return household.postal_code;
  if (field === "country") return household.country;
  return "";
}

function setHouseholdValue(
  household: GuestDirectory["guest_directory"]["households"][number],
  field: string,
  value: string,
) {
  if (field === "address_line_1") household.address_lines[0] = value;
  else if (field === "address_line_2") household.address_lines[1] = value;
  else if (field === "city") household.city = value;
  else if (field === "region") household.region = value;
  else if (field === "postal_code") household.postal_code = value;
  else if (field === "country") household.country = value;
}

function availableGuestId(
  directory: GuestDirectory,
  row: JoyImportRow,
): string {
  const base = `guest-${slug(row.incoming.external_id || row.incoming.name) || row.row_number}`;
  return availableId(base, new Set(directory.guests.map((guest) => guest.id)));
}

function availableId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function sourceRecordFor(preview: JoyImportPreview, row: JoyImportRow) {
  return {
    system: "joy",
    external_id: row.incoming.external_id,
    import_id: preview.source.id,
    row_number: row.row_number,
    imported_at: preview.source.imported_at,
    source_name: preview.source.source_name,
  };
}

function normalizeHeader(header: string): string {
  let normalized = header.trim().toLowerCase();
  if (normalized.endsWith("(optional)"))
    normalized = normalized.slice(0, -"(optional)".length).trimEnd();
  return normalized.replace(/[/_-]+/g, " ").replace(/\s+/g, " ");
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function attendanceValue(value: string): WeddingGuest["attendance"] {
  const normalized = value.trim().toLowerCase();
  if (["yes", "attending", "accepted", "accept"].includes(normalized))
    return "yes";
  if (["no", "declined", "decline"].includes(normalized)) return "no";
  return "unknown";
}

function booleanValue(value: string): boolean {
  return ["yes", "true", "1", "child"].includes(value.trim().toLowerCase());
}

function integerValue(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function listValue(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[;,|]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index] ?? "";
    if (character === '"') {
      const quote = readQuote(csv, index, quoted);
      value += quote.value;
      index += quote.advance;
      quoted = quote.quoted;
      continue;
    }
    if (quoted) {
      value += character;
      continue;
    }
    if (character === ",") {
      row.push(value);
      value = "";
      continue;
    }
    const lineBreakLength = lineBreakLengthAt(csv, index);
    if (lineBreakLength > 0) {
      index += lineBreakLength - 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += character;
  }
  if (quoted) throw new Error("The CSV file has an unterminated quoted value");
  if (value || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function readQuote(csv: string, index: number, quoted: boolean) {
  if (quoted && csv[index + 1] === '"')
    return { advance: 1, quoted, value: '"' };
  return { advance: 0, quoted: !quoted, value: "" };
}

function lineBreakLengthAt(csv: string, index: number): number {
  const character = csv[index];
  if (character === "\n") return 1;
  if (character !== "\r") return 0;
  return csv[index + 1] === "\n" ? 2 : 1;
}

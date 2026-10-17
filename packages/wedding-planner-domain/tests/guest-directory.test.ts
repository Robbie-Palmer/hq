import { describe, expect, it } from "vitest";
import {
  canEditGuestField,
  exportGuestCsv,
  parseWeddingPlan,
  updateGuest,
  updateGuestCustomField,
  visibleGuest,
  type WeddingPlan,
} from "../src";
import {
  applyJoyImport,
  exportJoyCsv,
  parseCsv,
  previewJoyCsv,
  type JoyImportDecision,
  type JoyImportMapping,
} from "../src/integrations/joy";

const timestamp = "2026-10-17T10:00:00.000Z";

function plan(): WeddingPlan {
  return parseWeddingPlan({
    version: 2,
    guests: [
      {
        id: "alex",
        name: "Alex Smith",
        email: "alex@example.com",
        source_party: "Smith household",
        relationship_groups: ["Family"],
        household_id: "smith-home",
        invitation_party_id: "smith-party",
        dietary_needs: ["Vegetarian"],
        private_notes: ["Ask about speech"],
        custom_fields: { meal: "Vegetarian" },
        event_responses: {
          ceremony: { invitation: "invited", response: "attending" },
        },
      },
      {
        id: "sam",
        name: "Sam Smith",
        household_id: "smith-home",
        invitation_party_id: "smith-party",
        plus_one_of_guest_id: "alex",
        is_child: true,
      },
    ],
    guest_directory: {
      households: [{ id: "smith-home", name: "Smith household" }],
      invitation_parties: [{ id: "smith-party", name: "Smith household" }],
      events: [{ id: "ceremony", name: "Ceremony" }],
      custom_fields: [
        {
          id: "meal",
          label: "Meal",
          type: "choice",
          choices: ["Vegetarian", "Chicken"],
          access: {
            view: ["couple", "guest", "export_recipient"],
            edit: ["couple", "guest"],
          },
        },
      ],
    },
    hosts: ["Robin", "Taylor"],
    accommodation: {},
    seating: { top_table_capacity: 2, table_capacities: [8] },
  });
}

describe("guest directory model", () => {
  it("keeps individual details while grouping guests into households and invitations", () => {
    const wedding = plan();
    expect(wedding.guests[0]).toMatchObject({
      relationship_groups: ["Family"],
      household_id: "smith-home",
      invitation_party_id: "smith-party",
      dietary_needs: ["Vegetarian"],
    });
    expect(wedding.guests[0]?.event_responses.ceremony).toMatchObject({
      invitation: "invited",
      response: "attending",
    });
    expect(() =>
      parseWeddingPlan({
        ...wedding,
        guests: [
          { ...wedding.guests[0], household_id: "missing" },
          wedding.guests[1],
        ],
      }),
    ).toThrow("household does not exist");
  });

  it("migrates legacy tags into relationship groups without retaining tags", () => {
    const wedding = parseWeddingPlan({
      ...plan(),
      guests: [{ id: "legacy", name: "Legacy Guest", tags: "Family; Work" }],
    });
    expect(wedding.guests[0]?.relationship_groups).toEqual(["Family", "Work"]);
    expect(wedding.guests[0]).not.toHaveProperty("tags");
  });

  it("validates typed custom fields and relationship references", () => {
    const wedding = plan();
    expect(() =>
      parseWeddingPlan({
        ...wedding,
        guests: [
          { ...wedding.guests[0], custom_fields: { meal: true } },
          wedding.guests[1],
        ],
      }),
    ).toThrow("wrong value type");
    expect(() =>
      parseWeddingPlan({
        ...wedding,
        guests: [
          wedding.guests[0],
          { ...wedding.guests[1], plus_one_of_guest_id: "missing" },
        ],
      }),
    ).toThrow("plus-one host is invalid");
  });

  it("enforces actor permissions and records manual changes", () => {
    const wedding = plan();
    expect(
      canEditGuestField(wedding, "alex", "dietary_needs", {
        role: "guest",
        guest_id: "alex",
      }),
    ).toBe(true);
    expect(
      canEditGuestField(wedding, "alex", "private_notes", {
        role: "guest",
        guest_id: "alex",
      }),
    ).toBe(false);
    expect(() =>
      updateGuest(
        wedding,
        "alex",
        { private_notes: ["Changed by guest"] },
        { role: "guest", guest_id: "alex" },
        timestamp,
      ),
    ).toThrow("cannot edit private_notes");

    updateGuest(
      wedding,
      "alex",
      { dietary_needs: ["Vegan"] },
      { role: "guest", guest_id: "alex", id: "alex-account" },
      timestamp,
    );
    expect(wedding.guest_directory.history).toEqual([
      expect.objectContaining({
        guest_id: "alex",
        actor_type: "guest",
        actor_id: "alex-account",
        changes: [
          expect.objectContaining({
            field: "dietary_needs",
            before: ["Vegetarian"],
            after: ["Vegan"],
          }),
        ],
      }),
    ]);
    expect(
      visibleGuest(wedding, "alex", {
        role: "guest",
        guest_id: "alex",
      }),
    ).not.toHaveProperty("private_notes");

    updateGuestCustomField(
      wedding,
      "alex",
      "meal",
      "Chicken",
      { role: "guest", guest_id: "alex" },
      "2026-10-17T11:00:00.000Z",
    );
    expect(wedding.guests[0]?.custom_fields.meal).toBe("Chicken");
    expect(wedding.guest_directory.history.at(-1)?.changes[0]?.field).toBe(
      "custom_fields.meal",
    );
  });

  it("does not leave partial changes when validation fails", () => {
    const wedding = plan();
    const before = structuredClone(wedding);
    expect(() =>
      updateGuest(
        wedding,
        "alex",
        { household_id: "missing" },
        { role: "couple" },
        timestamp,
      ),
    ).toThrow("household does not exist");
    expect(wedding).toEqual(before);
  });
});

describe("Joy CSV imports", () => {
  const mapping = {
    tags: {
      Family: { kind: "relationship_group", relationship_group: "Family" },
      Friends: { kind: "relationship_group", relationship_group: "Friends" },
      friends: { kind: "relationship_group", relationship_group: "Friends" },
      college: {
        kind: "relationship_group",
        relationship_group: "College friends",
      },
    },
  } satisfies JoyImportMapping;

  it("previews duplicates and requires a decision for every row", () => {
    const wedding = plan();
    const preview = previewJoyCsv(
      wedding,
      [
        "Joy ID,Full Name,Email,Party,Dietary Restrictions,Tags",
        'joy-1,Alex Smith,new@example.com,Smith household,"Vegan, Nut free",Family',
        "joy-2,Jamie Doe,jamie@example.com,Doe household,,Friends",
      ].join("\n"),
      { id: "import-1", source_name: "joy.csv", imported_at: timestamp },
      mapping,
    );
    expect(preview.rows[0]?.duplicate_candidates).toEqual([
      expect.objectContaining({ guest_id: "alex" }),
    ]);
    expect(preview.rows[0]?.differing_fields).toMatchObject({
      email: { existing: "alex@example.com", incoming: "new@example.com" },
      dietary_needs: {
        existing: ["Vegetarian"],
        incoming: ["Vegan", "Nut free"],
      },
    });
    expect(() => applyJoyImport(wedding, preview, [])).toThrow(
      "Every Joy row needs an explicit decision",
    );
  });

  it("merges only approved fields and keeps provenance for later imports", () => {
    const wedding = plan();
    const csv = [
      "Joy ID,Full Name,Email,Party,Dietary Restrictions,Tags",
      'joy-1,Alex Smith,new@example.com,Smith household,"Vegan, Nut free",Family',
      "joy-2,Jamie Doe,jamie@example.com,Doe household,,Friends",
    ].join("\n");
    const preview = previewJoyCsv(
      wedding,
      csv,
      {
        id: "import-1",
        source_name: "joy.csv",
        imported_at: timestamp,
      },
      mapping,
    );
    const decisions: JoyImportDecision[] = [
      {
        row_number: 2,
        action: "merge",
        guest_id: "alex",
        fields: {
          email: "keep_existing",
          dietary_needs: "use_import",
        },
      },
      { row_number: 3, action: "create", guest_id: "jamie" },
    ];
    applyJoyImport(wedding, preview, decisions);

    expect(wedding.guests[0]).toMatchObject({
      email: "alex@example.com",
      dietary_needs: ["Vegan", "Nut free"],
      source_records: [
        expect.objectContaining({ system: "joy", external_id: "joy-1" }),
      ],
    });
    expect(wedding.guests[1]?.private_notes).toEqual([]);
    expect(wedding.guests[2]).toMatchObject({
      id: "jamie",
      name: "Jamie Doe",
      invitation_party_id: "party-doe-household",
    });
    expect(wedding.guest_directory.imports[0]).toMatchObject({
      created: 1,
      merged: 1,
      skipped: 0,
    });

    const repeat = previewJoyCsv(
      wedding,
      csv,
      {
        id: "import-2",
        source_name: "joy.csv",
        imported_at: "2026-10-18T10:00:00.000Z",
      },
      mapping,
    );
    expect(repeat.rows[0]?.duplicate_candidates[0]).toMatchObject({
      guest_id: "alex",
      reasons: expect.arrayContaining(["same Joy guest ID"]),
    });
  });

  it("parses quoted commas, escaped quotes, and embedded newlines", () => {
    expect(
      parseCsv('Name,Notes\r\n"Smith, Alex","Said ""yes""\nTwice"'),
    ).toEqual([
      ["Name", "Notes"],
      ["Smith, Alex", 'Said "yes"\nTwice'],
    ]);
  });

  it("accepts Joy's template headers and imports invitation and address data", () => {
    const wedding = plan();
    const csv = [
      [
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
      ].join(","),
      "Dr,Jamie,Doe,,jamie@example.com,+353123,The Doe Family,Doe household,1 Main Street,,Dublin,Leinster,D01,Ireland,friends|college,1",
    ].join("\n");
    const preview = previewJoyCsv(
      wedding,
      csv,
      {
        id: "joy-template",
        source_name: "joy-template.csv",
        imported_at: timestamp,
      },
      mapping,
    );
    expect(preview.errors).toEqual([]);
    expect(preview.ignored_headers).toEqual([]);
    expect(preview.rows[0]?.incoming).toMatchObject({
      name: "Jamie Doe",
      title: "Dr",
      first_name: "Jamie",
      last_name: "Doe",
      plus_one_allowance: 1,
      joy_tags: ["friends", "college"],
      relationship_groups: ["Friends", "College friends"],
    });
    applyJoyImport(wedding, preview, [
      { row_number: 2, action: "create", guest_id: "jamie-template" },
    ]);
    expect(wedding.guests.at(-1)).toMatchObject({
      id: "jamie-template",
      household_id: "household-doe-household",
      invitation_party_id: "party-doe-household",
    });
    expect(wedding.guest_directory.households.at(-1)).toMatchObject({
      address_lines: ["1 Main Street"],
      city: "Dublin",
      region: "Leinster",
      postal_code: "D01",
      country: "Ireland",
    });
    expect(wedding.guest_directory.invitation_parties.at(-1)?.addressee).toBe(
      "The Doe Family",
    );
  });

  it("translates Joy fields while merging into domain concepts", () => {
    const wedding = plan();
    const preview = previewJoyCsv(
      wedding,
      [
        "Full Name,Email,Phone,Party,Name on Envelope,Address Line 1,Address Line 2,City,State/Region,Postal Code,Country,Tags,Plus Ones,RSVP,Child,Allergies,Accessibility Needs",
        "Alex Smith,alex@example.com,+353123,Alex household,Alex and guest,1 Main Street,Apt 2,Dublin,Leinster,D01,Ireland,VIP,2,accepted,true,Nuts,Step-free access",
      ].join("\n"),
      { id: "rich-merge", source_name: "joy.csv", imported_at: timestamp },
      {
        tags: {
          VIP: { kind: "wedding_role", wedding_role: "wedding_party" },
        },
      },
    );
    expect(preview.rows[0]?.issues).toEqual([]);
    const fields = Object.fromEntries(
      Object.keys(preview.rows[0]?.differing_fields ?? {}).map((field) => [
        field,
        "use_import" as const,
      ]),
    );
    applyJoyImport(wedding, preview, [
      { row_number: 2, action: "merge", guest_id: "alex", fields },
    ]);

    expect(wedding.guests[0]).toMatchObject({
      phone: "+353123",
      source_party: "Alex household",
      attendance: "yes",
      is_child: true,
      plus_one_allowance: 2,
      wedding_roles: ["wedding_party"],
      allergies: ["Nuts"],
      accessibility_needs: ["Step-free access"],
    });
    expect(wedding.guest_directory.invitation_parties.at(-1)).toMatchObject({
      name: "Alex household",
      addressee: "Alex and guest",
    });
    expect(wedding.guest_directory.households[0]).toMatchObject({
      address_lines: ["1 Main Street", "Apt 2"],
      city: "Dublin",
      region: "Leinster",
      postal_code: "D01",
      country: "Ireland",
    });
  });

  it("requires an adapter decision for every Joy tag", () => {
    const wedding = plan();
    const source = {
      id: "unmapped-tag",
      source_name: "joy.csv",
      imported_at: timestamp,
    };
    const unmapped = previewJoyCsv(
      wedding,
      "Full Name,Tags\nJamie Doe,neighbour",
      source,
    );
    expect(unmapped.rows[0]).toMatchObject({
      unmapped_tags: ["neighbour"],
      issues: [expect.stringContaining("explicit mapping or ignore decision")],
    });
    expect(() =>
      applyJoyImport(wedding, unmapped, [
        { row_number: 2, action: "create", guest_id: "jamie" },
      ]),
    ).toThrow("must be skipped");

    const ignored = previewJoyCsv(
      wedding,
      unmapped.headers.join(",") + "\nJamie Doe,neighbour",
      source,
      {
        tags: { neighbour: { kind: "ignore" } },
      },
    );
    expect(ignored.rows[0]?.issues).toEqual([]);
    expect(ignored.rows[0]?.incoming).not.toHaveProperty("relationship_groups");
  });
});

describe("privacy-safe guest exports", () => {
  it("exports recipient presets and selected custom fields", () => {
    const wedding = plan();
    const caterer = exportGuestCsv(wedding, {
      preset: "caterer",
      guest_ids: ["alex"],
    });
    expect(caterer).toContain("Name,Attendance,Dietary Needs,Allergies");
    expect(caterer).toContain("Alex Smith,unknown,Vegetarian");
    expect(caterer).not.toContain("Ask about speech");
    expect(
      exportGuestCsv(wedding, {
        fields: ["name", "custom_fields.meal"],
        guest_ids: ["alex"],
      }),
    ).toContain("Name,Meal\r\nAlex Smith,Vegetarian");
  });

  it("exports through the Joy adapter without private data", () => {
    const wedding = plan();
    const csv = exportJoyCsv(wedding, {
      guest_ids: ["alex"],
      mapping: {
        relationship_groups: {
          Family: "family",
        },
        wedding_roles: {},
      },
    });
    expect(csv.split("\r\n")[0]).toContain(
      "Title (Optional),First Name,Last Name,Suffix (Optional),Email (Optional)",
    );
    expect(csv).toContain("Alex,Smith");
    expect(csv).not.toContain("Ask about speech");
  });

  it("exports explicit domain fields without vendor terminology", () => {
    const wedding = plan();
    Object.assign(wedding.guest_directory.households[0] ?? {}, {
      name: "Smith, household",
      address_lines: ["1 Main Street", "Apt 2"],
      city: "Dublin",
      region: "Leinster",
      postal_code: "D01",
      country: "Ireland",
    });
    Object.assign(wedding.guest_directory.invitation_parties[0] ?? {}, {
      addressee: "Alex and Sam Smith",
    });
    const csv = exportGuestCsv(wedding, {
      actor: { role: "couple" },
      guest_ids: ["alex"],
      event_id: "ceremony",
      fields: [
        "first_name",
        "last_name",
        "household",
        "invitation_party",
        "invitation_addressee",
        "address_line_1",
        "address_line_2",
        "city",
        "region",
        "postal_code",
        "country",
        "event_response",
        "transport",
      ],
    });
    expect(csv).toContain(
      "First Name,Last Name,Household,Invitation Party,Invitation Addressee",
    );
    expect(csv).toContain(
      'Alex,Smith,"Smith, household",Smith household,Alex and Sam Smith,1 Main Street,Apt 2,Dublin,Leinster,D01,Ireland,attending',
    );
    expect(csv).not.toContain("Name on Envelope");
  });

  it("rejects incomplete and ambiguous domain export requests", () => {
    const wedding = plan();
    expect(() => exportGuestCsv(wedding, { fields: [] })).toThrow(
      "Select at least one export field",
    );
    expect(() => exportGuestCsv(wedding, { fields: ["name", "name"] })).toThrow(
      "Export fields must be unique",
    );
    expect(() =>
      exportGuestCsv(wedding, { fields: ["name"], guest_ids: ["missing"] }),
    ).toThrow("Guest missing does not exist");
    expect(() =>
      exportGuestCsv(wedding, {
        actor: { role: "couple" },
        fields: ["event_response"],
        guest_ids: ["alex"],
      }),
    ).toThrow("event_id is required");
  });

  it("does not guess how domain concepts map to Joy tags", () => {
    expect(() =>
      exportJoyCsv(plan(), {
        guest_ids: ["alex"],
        mapping: { relationship_groups: {}, wedding_roles: {} },
      }),
    ).toThrow("mapping or ignore decision for relationship group: Family");
  });

  it("rejects private fields even when a recipient selects them", () => {
    const wedding = plan();
    expect(() =>
      exportGuestCsv(wedding, {
        fields: ["name", "private_notes"],
        guest_ids: ["alex"],
      }),
    ).toThrow("export_recipient cannot export private_notes");
  });
});

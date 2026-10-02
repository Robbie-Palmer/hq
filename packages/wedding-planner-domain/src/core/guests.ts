import { z } from "zod";

export const AttendanceSchema = z.enum(["unknown", "yes", "no"]);
export type Attendance = z.infer<typeof AttendanceSchema>;

export const WeddingRoleSchema = z.enum([
  "wedding_party",
  "bridesmaid",
  "groomsman",
  "maid_of_honour",
  "best_man",
  "parent_of_bride",
  "parent_of_groom",
  "flower_girl",
  "page_boy",
]);
export type WeddingRole = z.infer<typeof WeddingRoleSchema>;
export const weddingRolesSchema = z
  .array(WeddingRoleSchema)
  .refine(
    (roles) => new Set(roles).size === roles.length,
    "Wedding roles must be unique",
  );
export const weddingRoleLabels: Record<WeddingRole, string> = {
  wedding_party: "Other wedding party member",
  bridesmaid: "Bridesmaid",
  groomsman: "Groomsman",
  maid_of_honour: "Maid of honour",
  best_man: "Best man",
  parent_of_bride: "Parent of the bride",
  parent_of_groom: "Parent of the groom",
  flower_girl: "Flower girl",
  page_boy: "Page boy",
};
export function isWeddingPartyMember(guest: {
  wedding_roles: readonly WeddingRole[];
}): boolean {
  return guest.wedding_roles.some((role) =>
    [
      "wedding_party",
      "bridesmaid",
      "groomsman",
      "maid_of_honour",
      "best_man",
      "flower_girl",
      "page_boy",
    ].includes(role),
  );
}
export function weddingRolesLabel(roles: readonly WeddingRole[]): string {
  return roles.map((role) => weddingRoleLabels[role]).join(" · ");
}

export const weddingGuestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source_party: z.string().default(""),
  tags: z.string().default(""),
  attendance: AttendanceSchema.default("unknown"),
  wedding_roles: weddingRolesSchema.default([]),
});

export type WeddingGuest = z.infer<typeof weddingGuestSchema>;

export const coupleSchema = z.object({
  id: z.string().min(1),
  guest_ids: z.tuple([z.string().min(1), z.string().min(1)]),
});
export type Couple = z.infer<typeof coupleSchema>;

export function partnerId(
  couples: readonly Couple[],
  guestId: string,
): string | undefined {
  return couples
    .find((couple) => couple.guest_ids.includes(guestId))
    ?.guest_ids.find((id) => id !== guestId);
}

export function validateCouples(
  couples: readonly Couple[],
  guestIds: Set<string>,
): void {
  const ids = new Set<string>();
  const pairedGuests = new Set<string>();
  for (const couple of couples) {
    if (ids.has(couple.id)) throw new Error("Couple IDs must be unique");
    ids.add(couple.id);
    for (const id of couple.guest_ids) {
      if (!guestIds.has(id))
        throw new Error("A couple refers to an unknown guest");
      if (pairedGuests.has(id))
        throw new Error(
          "A guest cannot belong to more than one couple or be their own partner",
        );
      pairedGuests.add(id);
    }
  }
}

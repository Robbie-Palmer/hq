import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
import {
  type AuthoredTermCandidate,
  type AuthoredTermKind,
  type AuthoredTermProvenance,
  type AuthoredTermSourceContext,
  normalizeAuthoredTerm,
} from "recipe-domain/authored-term";
import { normalizeSlug } from "recipe-domain/slugs";
import { canonicalEquipment } from "recipe-parsing/canonical-equipment-data";
import { canonicalizeEquipmentName } from "recipe-parsing/equipment-canonicalization";
import {
  buildOntology,
  buildOntologyIndex,
} from "recipe-parsing/slug-matching";
import type { DbTransaction } from "./db/types";

export type AuthoredTermOwner =
  | { type: "user"; userId: string }
  | { type: "household"; organizationId: string };

type TermDb = Db | DbTransaction;
type TermReader = Pick<Db, "select">;

const equipmentOntology = buildOntology(
  canonicalEquipment.equipment,
  "equipment",
);
const equipmentOntologyIndex = buildOntologyIndex(equipmentOntology);

export type AuthoredTermObservation = {
  kind: AuthoredTermKind;
  rawText: string;
  locale?: string;
  sourceContext: AuthoredTermSourceContext;
  provenance: AuthoredTermProvenance;
  candidateMatches?: AuthoredTermCandidate[];
  canonicalSlugs?: ReadonlySet<string>;
  canonicalSlug?: string | null;
};

export type UnresolvedTermSummary = {
  id: string;
  kind: AuthoredTermKind;
  rawText: string;
  normalizedText: string;
  locale: string;
  sourceContext: AuthoredTermSourceContext;
  provenance: AuthoredTermProvenance;
  candidateMatches: AuthoredTermCandidate[];
  frequency: number;
  resolutionStatus: "unresolved";
};

export function canonicalEquipmentTerm(rawText: string): {
  candidateMatches: AuthoredTermCandidate[];
  canonicalSlug: string | null;
} {
  const decision = canonicalizeEquipmentName({
    rawName: rawText,
    ontology: equipmentOntology,
    ontologyIndex: equipmentOntologyIndex,
  });
  return {
    candidateMatches: decision.candidates,
    canonicalSlug:
      decision.method === "none" ? null : decision.canonicalSlug,
  };
}

function ownerValues(owner: AuthoredTermOwner) {
  return owner.type === "user"
    ? { userId: owner.userId, organizationId: null }
    : { userId: null, organizationId: owner.organizationId };
}

function ownerFilter(owner: AuthoredTermOwner) {
  return owner.type === "user"
    ? and(
        eq(schema.authoredTerm.userId, owner.userId),
        isNull(schema.authoredTerm.organizationId),
      )
    : and(
        eq(schema.authoredTerm.organizationId, owner.organizationId),
        isNull(schema.authoredTerm.userId),
      );
}

function canonicalSlugForObservation(
  observation: AuthoredTermObservation,
): string | null {
  if (observation.canonicalSlug !== undefined) {
    return observation.canonicalSlug;
  }
  const slug = normalizeSlug(observation.rawText);
  return slug && observation.canonicalSlugs?.has(slug) ? slug : null;
}

export async function observeAuthoredTerm(
  db: TermDb,
  owner: AuthoredTermOwner,
  observation: AuthoredTermObservation,
): Promise<{ canonicalSlug: string | null; normalizedText: string; key: string }> {
  const rawText = observation.rawText.normalize("NFKC").trim();
  const locale = observation.locale?.trim() || "und";
  const normalizedText = normalizeAuthoredTerm(rawText, locale);
  if (!normalizedText) throw new Error("Authored term cannot be empty");
  const canonicalSlug = canonicalSlugForObservation(observation);
  const now = new Date();
  const values = {
    ...ownerValues(owner),
    kind: observation.kind,
    rawText,
    normalizedText,
    locale,
    sourceContext: observation.sourceContext,
    provenance: observation.provenance,
    candidateMatches: observation.candidateMatches ?? [],
    canonicalSlug,
    resolutionStatus: canonicalSlug ? ("resolved" as const) : ("unresolved" as const),
    lastSeenAt: now,
    updatedAt: now,
  };
  const inserted = await db
    .insert(schema.authoredTerm)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: schema.authoredTerm.id });

  if (inserted.length === 0) {
    await db
      .update(schema.authoredTerm)
      .set({
        rawText,
        locale,
        sourceContext: observation.sourceContext,
        provenance: observation.provenance,
        candidateMatches: observation.candidateMatches ?? [],
        canonicalSlug,
        resolutionStatus: canonicalSlug ? "resolved" : "unresolved",
        frequency: sql`${schema.authoredTerm.frequency} + 1`,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(
        and(
          ownerFilter(owner),
          eq(schema.authoredTerm.kind, observation.kind),
          eq(schema.authoredTerm.normalizedText, normalizedText),
        ),
      );
  }

  return {
    canonicalSlug,
    normalizedText,
    key: canonicalSlug ?? normalizedText,
  };
}

export async function listUnresolvedTerms(
  db: TermReader,
  owner: AuthoredTermOwner,
  kind?: AuthoredTermKind,
): Promise<UnresolvedTermSummary[]> {
  const rows = await db
    .select({
      id: schema.authoredTerm.id,
      kind: schema.authoredTerm.kind,
      rawText: schema.authoredTerm.rawText,
      normalizedText: schema.authoredTerm.normalizedText,
      locale: schema.authoredTerm.locale,
      sourceContext: schema.authoredTerm.sourceContext,
      provenance: schema.authoredTerm.provenance,
      candidateMatches: schema.authoredTerm.candidateMatches,
      frequency: schema.authoredTerm.frequency,
    })
    .from(schema.authoredTerm)
    .where(
      and(
        ownerFilter(owner),
        isNull(schema.authoredTerm.canonicalSlug),
        kind ? eq(schema.authoredTerm.kind, kind) : undefined,
      ),
    )
    .orderBy(desc(schema.authoredTerm.lastSeenAt));
  return rows.map((row) => ({
    ...row,
    resolutionStatus: "unresolved" as const,
  }));
}

export function requestLocale(acceptLanguage: string | undefined): string {
  const locale = acceptLanguage?.split(",", 1)[0]?.split(";", 1)[0]?.trim();
  return locale && locale.length <= 35 ? locale : "und";
}

export async function observeRecipeTerms(
  db: TermDb,
  input: {
    userId: string;
    recipeId: string;
    ingredientTerms: string[];
    equipmentTerms: string[];
    locale?: string;
    importJobId?: string;
  },
): Promise<void> {
  const ingredientCandidates = Array.from(
    new Set(input.ingredientTerms.map(normalizeSlug).filter(Boolean)),
  );
  const knownIngredients =
    ingredientCandidates.length === 0
      ? []
      : await db
          .select({ slug: schema.ingredient.slug })
          .from(schema.ingredient)
          .where(inArray(schema.ingredient.slug, ingredientCandidates));
  const ingredientSlugs = new Set(knownIngredients.map(({ slug }) => slug));
  const provenance: AuthoredTermProvenance = input.importJobId
    ? {
        kind: "import",
        actorUserId: input.userId,
        importJobId: input.importJobId,
      }
    : { kind: "user", actorUserId: input.userId };
  const owner: AuthoredTermOwner = { type: "user", userId: input.userId };

  for (const rawText of input.ingredientTerms) {
    const slug = normalizeSlug(rawText);
    await observeAuthoredTerm(db, owner, {
      kind: "ingredient",
      rawText,
      locale: input.locale,
      sourceContext: {
        flow: "recipe",
        resourceId: input.recipeId,
        field: "ingredients",
      },
      provenance,
      candidateMatches:
        slug && ingredientSlugs.has(slug) ? [{ slug, score: 1 }] : [],
      canonicalSlugs: ingredientSlugs,
    });
  }
  for (const rawText of input.equipmentTerms) {
    const equipment = canonicalEquipmentTerm(rawText);
    await observeAuthoredTerm(db, owner, {
      kind: "equipment",
      rawText,
      locale: input.locale,
      sourceContext: {
        flow: "recipe",
        resourceId: input.recipeId,
        field: "cookware",
      },
      provenance,
      candidateMatches: equipment.candidateMatches,
      canonicalSlug: equipment.canonicalSlug,
    });
  }
}

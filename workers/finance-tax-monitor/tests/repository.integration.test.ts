import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  createRuleUpdateProposal,
  snapshotGovUkContent,
  type GovUkContentSnapshot,
  type GovUkSourceSpec,
  type RuleUpdateProposal,
} from "finance-tax-rules/gov-uk-monitor";
import type { Db } from "../src/db";
import {
  latestRevision,
  persistSuccessfulCheck,
  StaleRevisionBaseError,
  syncSourceAndReadState,
} from "../src/repository";
import {
  taxGuidanceRevision,
  taxGuidanceSource,
  taxRuleUpdateReview,
} from "../src/schema";
import type { StoredSourceArtifacts } from "../src/artifacts";
import * as schema from "../src/schema";

const client = new PGlite();
const db = drizzle(client, {
  schema,
  casing: "snake_case",
}) as unknown as Db;

const source: GovUkSourceSpec = {
  id: "income-tax",
  title: "Income Tax rates",
  pageUrl: "https://www.gov.uk/income-tax-rates",
  contentApiUrl: "https://www.gov.uk/api/content/income-tax-rates",
  ruleIds: ["income-tax-2026-27"],
  effectivePeriods: [{ from: "2026-04-06", to: "2027-04-05" }],
  defaultCheckIntervalHours: 168,
};

function snapshot(body: string): GovUkContentSnapshot {
  return snapshotGovUkContent({
    base_path: "/income-tax-rates",
    content_id: "content-id",
    description: "Official rates",
    details: { body },
    document_type: "guidance",
    first_published_at: "2025-11-01T09:00:00Z",
    links: {},
    public_updated_at: "2026-04-06T00:00:00Z",
    schema_name: "detailed_guide",
    title: "Income Tax rates",
    updated_at: "2026-04-06T00:01:00Z",
    withdrawn_notice: {},
  });
}

function artifacts(
  candidate: GovUkContentSnapshot,
  rawCharacter: string,
  retrievedAt: string,
): StoredSourceArtifacts {
  const rawChecksum = rawCharacter.repeat(64);
  return {
    sourceId: source.id,
    retrievedAt,
    rawChecksum,
    normalizedFingerprint: candidate.fingerprint,
    rawObjectKey: `govuk-tax-guidance/${source.id}/raw/${rawChecksum}.json.gz`,
    normalizedObjectKey: `govuk-tax-guidance/${source.id}/normalized/${candidate.fingerprint}.json.gz`,
    rawByteLength: 500,
    publicationAt: candidate.metadata.publicUpdatedAt,
    responseEtag: '"revision"',
    responseLastModified: null,
  };
}

async function persist(
  candidate: GovUkContentSnapshot,
  rawCharacter: string,
  retrievedAt: string,
  baseId: string | null,
  proposal: RuleUpdateProposal | null,
) {
  return persistSuccessfulCheck(db, {
    source,
    artifacts: artifacts(candidate, rawCharacter, retrievedAt),
    expectedBaseRevisionId: baseId,
    proposal,
  });
}

beforeAll(async () => {
  await client.exec(
    readFileSync(resolve("drizzle/0000_medical_bastion.sql"), "utf8"),
  );
});

beforeEach(async () => {
  await client.exec(
    "TRUNCATE tax_rule_update_review, tax_guidance_revision, tax_guidance_source CASCADE",
  );
});

afterAll(async () => client.close());

describe("finance tax monitor repository", () => {
  it("records a baseline review and makes Workflow replay idempotent", async () => {
    const candidate = snapshot("<p>20%</p>");
    const proposal = createRuleUpdateProposal(
      source,
      null,
      candidate,
      "2026-10-03T10:00:00Z",
    );
    expect(await syncSourceAndReadState(db, source)).toEqual({
      lastSuccessfulCheckAt: null,
    });

    const first = await persist(
      candidate,
      "a",
      "2026-10-03T10:00:00Z",
      null,
      proposal,
    );
    const replay = await persist(
      candidate,
      "a",
      "2026-10-03T10:00:00Z",
      null,
      proposal,
    );

    expect(first).toMatchObject({ repeated: false, reviewId: proposal?.id });
    expect(replay).toMatchObject({
      repeated: true,
      revisionId: first.revisionId,
      reviewId: proposal?.id,
    });
    expect(await db.select().from(taxGuidanceRevision)).toHaveLength(1);
    expect(await db.select().from(taxRuleUpdateReview)).toHaveLength(1);
    expect(await db.select().from(taxGuidanceSource)).toEqual([
      expect.objectContaining({
        id: source.id,
        lastSuccessfulCheckAt: new Date("2026-10-03T10:00:00Z"),
      }),
    ]);
  });

  it("keeps unchanged raw revisions and rejects a stale diff base", async () => {
    const original = snapshot("<p>20%</p>");
    await syncSourceAndReadState(db, source);
    const first = await persist(
      original,
      "a",
      "2026-10-03T10:00:00Z",
      null,
      createRuleUpdateProposal(
        source,
        null,
        original,
        "2026-10-03T10:00:00Z",
      ),
    );
    const unchanged = await persist(
      original,
      "b",
      "2026-10-10T10:00:00Z",
      first.revisionId,
      null,
    );
    expect(await db.select().from(taxGuidanceRevision)).toHaveLength(2);
    expect(await db.select().from(taxRuleUpdateReview)).toHaveLength(1);
    expect((await latestRevision(db, source.id))?.id).toBe(
      unchanged.revisionId,
    );

    const changed = snapshot("<p>21%</p>");
    await expect(
      persist(
        changed,
        "c",
        "2026-10-17T10:00:00Z",
        first.revisionId,
        createRuleUpdateProposal(
          source,
          original,
          changed,
          "2026-10-17T10:00:00Z",
        ),
      ),
    ).rejects.toBeInstanceOf(StaleRevisionBaseError);
  });
});

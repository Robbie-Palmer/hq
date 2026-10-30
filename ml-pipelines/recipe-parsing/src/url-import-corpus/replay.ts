import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseSchemaOrgRecipeHtml } from "recipe-parsing/schema-org";
import {
  loadPartitionManifest,
  sha256,
} from "./corpus.js";
import type {
  CorpusFixture,
  CorpusPartition,
  ExpectedRecipe,
  ReplayPurpose,
} from "./schema.js";

export type ReplayOptions = {
  partitions?: CorpusPartition[];
  purpose?: ReplayPurpose;
};

export type ReplayRecord = {
  fixtureId: string;
  partition: CorpusPartition;
  inputSha256: string;
  sourceUrl: string;
  expectedStatus: "success" | "no-recipe";
  actual: ExpectedRecipe | null;
  passed: boolean;
};

export type ReplayReport = {
  schemaVersion: 1;
  recordType: "recipe-url-import-replay";
  purpose: ReplayPurpose;
  partitions: CorpusPartition[];
  summary: {
    fixtures: number;
    passed: number;
    failed: number;
  };
  records: ReplayRecord[];
};

export function replayPartitions(options: ReplayOptions): CorpusPartition[] {
  const partitions = options.partitions ?? ["train", "development"];
  const unique = [...new Set(partitions)];
  if (unique.length === 0) throw new Error("Select at least one partition");
  if (
    unique.includes("holdout") &&
    options.purpose !== "final-evaluation"
  ) {
    throw new Error(
      "Holdout replay requires purpose final-evaluation; routine replay leaves it untouched",
    );
  }
  return unique;
}

function passed(
  fixture: CorpusFixture,
  actual: ExpectedRecipe | null,
): boolean {
  if (fixture.expected.status === "no-recipe") return actual === null;
  const withoutUndefined = actual
    ? (JSON.parse(JSON.stringify(actual)) as ExpectedRecipe)
    : null;
  return isDeepStrictEqual(withoutUndefined, fixture.expected.recipe);
}

export async function replayCorpus(
  corpusRoot: string,
  options: ReplayOptions = {},
  parser: typeof parseSchemaOrgRecipeHtml = parseSchemaOrgRecipeHtml,
): Promise<ReplayReport> {
  const partitions = replayPartitions(options);
  const records: ReplayRecord[] = [];

  for (const partition of partitions) {
    const manifest = loadPartitionManifest(corpusRoot, partition);
    for (const fixture of manifest.fixtures) {
      const html = fs.readFileSync(
        path.join(corpusRoot, fixture.artifact.path),
        "utf8",
      );
      const inputSha256 = sha256(html);
      if (inputSha256 !== fixture.artifact.sha256) {
        throw new Error(`${fixture.id} changed since the manifest was reviewed`);
      }
      const actual = await parser(html, fixture.retrieval.sourceUrl);
      records.push({
        fixtureId: fixture.id,
        partition,
        inputSha256,
        sourceUrl: fixture.retrieval.sourceUrl,
        expectedStatus: fixture.expected.status,
        actual,
        passed: passed(fixture, actual),
      });
    }
  }

  const passCount = records.filter((record) => record.passed).length;
  return {
    schemaVersion: 1,
    recordType: "recipe-url-import-replay",
    purpose: options.purpose ?? "development",
    partitions,
    summary: {
      fixtures: records.length,
      passed: passCount,
      failed: records.length - passCount,
    },
    records,
  };
}

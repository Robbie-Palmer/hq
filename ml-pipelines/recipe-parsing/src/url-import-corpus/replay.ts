import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseSchemaOrgRecipeHtml } from "recipe-parsing/schema-org";
import {
  loadPartitionManifest,
  sha256,
} from "./corpus.js";
import {
  SYNTHETIC_CORPUS_KIND,
  SYNTHETIC_EVALUATION_SCOPE,
  type CorpusFixture,
  type CorpusPartition,
  type ExpectedRecipe,
} from "./schema.js";

export type ReplayOptions = {
  partitions?: CorpusPartition[];
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
  corpusKind: typeof SYNTHETIC_CORPUS_KIND;
  evaluationScope: typeof SYNTHETIC_EVALUATION_SCOPE;
  includesKnownFailures: boolean;
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
  return unique;
}

function passed(
  fixture: CorpusFixture,
  actual: ExpectedRecipe | null,
): boolean {
  if (fixture.expected.status === "no-recipe") return actual === null;
  const withoutUndefined = actual
    ? (Object.fromEntries(
        Object.entries(actual).filter(([, value]) => value !== undefined),
      ) as ExpectedRecipe)
    : null;
  return isDeepStrictEqual(withoutUndefined, fixture.expected.recipe);
}

export async function replayCorpus(
  corpusRoot: string,
  options: ReplayOptions = {},
  parser: typeof parseSchemaOrgRecipeHtml = parseSchemaOrgRecipeHtml,
): Promise<ReplayReport> {
  const partitions = replayPartitions(options);
  const inputs: Array<{
    fixture: CorpusFixture;
    html: string;
    inputSha256: string;
    partition: CorpusPartition;
  }> = [];

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
      inputs.push({ fixture, html, inputSha256, partition });
    }
  }

  const records = await Promise.all(
    inputs.map(async ({ fixture, html, inputSha256, partition }) => {
      const actual = await parser(html, fixture.retrieval.sourceUrl);
      return {
        fixtureId: fixture.id,
        partition,
        inputSha256,
        sourceUrl: fixture.retrieval.sourceUrl,
        expectedStatus: fixture.expected.status,
        actual,
        passed: passed(fixture, actual),
      } satisfies ReplayRecord;
    }),
  );

  const passCount = records.filter((record) => record.passed).length;
  return {
    schemaVersion: 1,
    recordType: "recipe-url-import-replay",
    corpusKind: SYNTHETIC_CORPUS_KIND,
    evaluationScope: SYNTHETIC_EVALUATION_SCOPE,
    includesKnownFailures: partitions.includes("regression"),
    partitions,
    summary: {
      fixtures: records.length,
      passed: passCount,
      failed: records.length - passCount,
    },
    records,
  };
}

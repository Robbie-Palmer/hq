import path from "node:path";
import { writeJson } from "../url-import-corpus/corpus.js";
import { replayCorpus } from "../url-import-corpus/replay.js";
import {
  CorpusPartitionSchema,
  ReplayPurposeSchema,
} from "../url-import-corpus/schema.js";

function valuesAfter(flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index++) {
    const value = process.argv[index + 1];
    if (process.argv[index] === flag && value) {
      values.push(value);
    }
  }
  return values;
}

function valueAfter(flag: string): string | undefined {
  return valuesAfter(flag)[0];
}

const corpusRoot = path.resolve(
  valueAfter("--corpus") ?? "data/url-import-corpus/v1",
);
const output = path.resolve(
  valueAfter("--output") ?? "outputs/url-import-corpus-replay.json",
);
const partitions = valuesAfter("--partition").map((partition) =>
  CorpusPartitionSchema.parse(partition),
);
const purposeValue = valueAfter("--purpose");
const purpose = purposeValue
  ? ReplayPurposeSchema.parse(purposeValue)
  : undefined;

const report = await replayCorpus(corpusRoot, {
  ...(partitions.length > 0 ? { partitions } : {}),
  ...(purpose ? { purpose } : {}),
});
writeJson(output, report);

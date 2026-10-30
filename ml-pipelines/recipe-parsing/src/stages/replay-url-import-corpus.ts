import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeJson } from "../url-import-corpus/corpus.js";
import { replayCorpus } from "../url-import-corpus/replay.js";
import {
  CorpusPartitionSchema,
  ReplayPurposeSchema,
} from "../url-import-corpus/schema.js";

function valuesAfter(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index + 1];
    if (argv[index] === flag && value) {
      values.push(value);
    }
  }
  return values;
}

function valueAfter(argv: string[], flag: string): string | undefined {
  return valuesAfter(argv, flag)[0];
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const corpusRoot = path.resolve(
    valueAfter(argv, "--corpus") ?? "data/url-import-corpus/v1",
  );
  const output = path.resolve(
    valueAfter(argv, "--output") ?? "outputs/url-import-corpus-replay.json",
  );
  const partitions = valuesAfter(argv, "--partition").map((partition) =>
    CorpusPartitionSchema.parse(partition),
  );
  const purposeValue = valueAfter(argv, "--purpose");
  const purpose = purposeValue
    ? ReplayPurposeSchema.parse(purposeValue)
    : undefined;

  const report = await replayCorpus(corpusRoot, {
    ...(partitions.length > 0 ? { partitions } : {}),
    ...(purpose ? { purpose } : {}),
  });
  writeJson(output, report);
}

const invokedFile = process.argv[1];
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  await main();
}

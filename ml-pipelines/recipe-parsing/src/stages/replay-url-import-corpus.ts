import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeJson } from "../url-import-corpus/corpus.js";
import { replayCorpus } from "../url-import-corpus/replay.js";
import {
  CorpusPartitionSchema,
  ReplayPurposeSchema,
} from "../url-import-corpus/schema.js";
import { valueAfter, valuesAfter } from "./cli-arguments.js";

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
  if (report.summary.failed > 0) {
    throw new Error(
      `URL-import replay failed: ${report.summary.failed} fixture(s)`,
    );
  }
}

const invokedFile = process.argv[1];
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  await main();
}

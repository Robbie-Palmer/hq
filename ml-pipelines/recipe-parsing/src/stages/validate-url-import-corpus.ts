import path from "node:path";
import { validateCorpus, writeJson } from "../url-import-corpus/corpus.js";

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const corpusRoot = path.resolve(
  valueAfter("--corpus") ?? "data/url-import-corpus/v1",
);
const output = path.resolve(
  valueAfter("--output") ?? "outputs/url-import-corpus-validation.json",
);

writeJson(output, validateCorpus(corpusRoot));

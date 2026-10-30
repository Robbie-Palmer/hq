import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateCorpus, writeJson } from "../url-import-corpus/corpus.js";
import { valueAfter } from "./cli-arguments.js";

export function main(argv: string[] = process.argv): void {
  const corpusRoot = path.resolve(
    valueAfter(argv, "--corpus") ?? "data/url-import-corpus/synthetic/v1",
  );
  const output = path.resolve(
    valueAfter(argv, "--output") ??
      "outputs/url-import-synthetic-corpus-validation.json",
  );

  writeJson(output, validateCorpus(corpusRoot));
}

const invokedFile = process.argv[1];
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  main();
}

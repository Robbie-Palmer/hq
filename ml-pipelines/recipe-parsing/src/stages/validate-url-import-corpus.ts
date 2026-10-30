import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateCorpus, writeJson } from "../url-import-corpus/corpus.js";

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function main(argv: string[] = process.argv): void {
  const corpusRoot = path.resolve(
    valueAfter(argv, "--corpus") ?? "data/url-import-corpus/v1",
  );
  const output = path.resolve(
    valueAfter(argv, "--output") ??
      "outputs/url-import-corpus-validation.json",
  );

  writeJson(output, validateCorpus(corpusRoot));
}

const invokedFile = process.argv[1];
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  main();
}

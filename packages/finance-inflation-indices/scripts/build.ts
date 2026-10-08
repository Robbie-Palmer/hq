import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildArtifacts } from "../src/build";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const artifacts = buildArtifacts(packageRoot);
const stale: string[] = [];

for (const [relativePath, expected] of artifacts) {
  const outputPath = resolve(packageRoot, relativePath);
  if (check) {
    let actual: string | undefined;
    try {
      actual = readFileSync(outputPath, "utf8");
    } catch {
      actual = undefined;
    }
    if (actual !== expected) stale.push(relativePath);
    continue;
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, expected);
}

if (stale.length > 0) {
  throw new Error(`Generated artifacts are stale: ${stale.join(", ")}`);
}

console.log(
  check
    ? `Checked ${artifacts.size} generated artifacts`
    : `Built ${artifacts.size} generated artifacts`,
);

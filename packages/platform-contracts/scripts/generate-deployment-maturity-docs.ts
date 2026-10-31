import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  parseDeploymentMaturityContract,
  parsePromotionEvidence,
  renderDeploymentMaturityDocumentation,
} from "../src/deployment-maturity";

const contractPath = fileURLToPath(
  new URL(
    "../../../ui/content/projects/personal-engineering-platform/deployment-maturity.yaml",
    import.meta.url,
  ),
);
const examplePath = fileURLToPath(
  new URL(
    "../tests/fixtures/deployment-maturity/representative-promotion-v1.yaml",
    import.meta.url,
  ),
);
const outputPath = fileURLToPath(
  new URL("../../../docs/contracts/deployment-maturity.md", import.meta.url),
);

const contract = parseDeploymentMaturityContract(
  parse(await readFile(contractPath, "utf8")),
);
const example = parsePromotionEvidence(
  parse(await readFile(examplePath, "utf8")),
  contract,
);
const generated = renderDeploymentMaturityDocumentation(contract, example);

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8");
  if (current !== generated) {
    throw new Error(
      "Generated deployment maturity documentation is stale. Run mise //packages/platform-contracts:docs:generate.",
    );
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated);
}

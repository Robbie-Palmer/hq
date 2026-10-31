import { readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";
import { parseDeploymentMaturityContract } from "../src/deployment-maturity";
import {
  parseWorkloadDefinition,
  renderWorkloadDocumentation,
} from "../src/workload";

const maturityUrl = new URL(
  "../../../ui/content/projects/personal-engineering-platform/deployment-maturity.yaml",
  import.meta.url,
);
const fixtureUrls = [
  new URL(
    "../tests/fixtures/workload/portable-workload-v1.yaml",
    import.meta.url,
  ),
  new URL(
    "../tests/fixtures/workload/cloudflare-worker-v1.yaml",
    import.meta.url,
  ),
];
const outputUrl = new URL(
  "../../../docs/contracts/workload-definition.md",
  import.meta.url,
);

const maturity = parseDeploymentMaturityContract(
  parse(await readFile(maturityUrl, "utf8")),
);
const examples = await Promise.all(
  fixtureUrls.map(async (url) =>
    parseWorkloadDefinition(parse(await readFile(url, "utf8")), maturity),
  ),
);
const generated = renderWorkloadDocumentation(examples);

if (process.argv.includes("--check")) {
  const current = await readFile(outputUrl, "utf8");
  if (current !== generated) {
    throw new Error(
      "Generated workload documentation is stale. Run mise //packages/platform-contracts:docs:generate.",
    );
  }
} else {
  await writeFile(outputUrl, generated, "utf8");
}

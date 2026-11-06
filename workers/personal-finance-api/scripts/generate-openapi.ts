import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { app } from "../src/index";

const outputPath = fileURLToPath(new URL("../openapi.json", import.meta.url));
const document = app.getOpenAPIDocument({
  openapi: "3.1.0",
  info: {
    title: "Personal Finance App API",
    version: "1.0.0",
  },
  tags: [{ name: "health", description: "Worker process health." }],
});
const generated = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const committed = await readFile(outputPath, "utf8").catch(() => "");
  if (committed !== generated) {
    console.error(
      "workers/personal-finance-api/openapi.json is stale. Run mise //workers/personal-finance-api:openapi:generate.",
    );
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, generated);
}

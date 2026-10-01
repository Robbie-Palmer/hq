import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { app } from "../src/index";

const outputPath = fileURLToPath(
  new URL("../openapi.json", import.meta.url).href,
);

function publicApiPath(path: string): string {
  if (
    path === "/health" ||
    path.startsWith("/.well-known/") ||
    path.startsWith("/api/")
  ) {
    return path;
  }
  return `/api${path}`;
}

const document = app.getOpenAPIDocument({
  openapi: "3.1.0",
  info: {
    title: "Recipe API",
    version: "1.0.0",
    description:
      "The HTTP contract used by the recipe site UI and its Cloudflare Pages proxies.",
    contact: { name: "Robbie Palmer", url: "https://robbiepalmer.me" },
  },
  servers: [{ url: "https://robbiepalmer.me", "x-internal": false }],
  tags: [
    "agent-auth",
    "auth",
    "households",
    "notifications",
    "pantry",
    "profile",
    "recipe-drafts",
    "recipe-imports",
    "recipe-import-batches",
    "recipes",
    "health",
  ].map((name) => ({
    name,
    description:
      name === "agent-auth"
        ? "Delegated agent discovery, registration, approval, and capability execution."
        : `${name} operations`,
  })),
});

document.paths = Object.fromEntries(
  Object.entries(document.paths)
    .map(([path, item]) => [publicApiPath(path), item] as const)
    .sort(([first], [second]) => first.localeCompare(second)),
);

const generated = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const committed = await readFile(outputPath, "utf8").catch(() => "");
  if (committed !== generated) {
    console.error(
      "workers/recipe-api/openapi.json is stale. Run mise run //workers/recipe-api:openapi:generate.",
    );
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, generated);
  console.log("Generated workers/recipe-api/openapi.json");
}

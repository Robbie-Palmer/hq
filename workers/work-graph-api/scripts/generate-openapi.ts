import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createWorkGraphApp, type WorkGraphApiRepository } from "../src/index";

const outputPath = fileURLToPath(
  new URL("../openapi.json", import.meta.url).href,
);
const unavailable = async (): Promise<never> => {
  throw new Error("The OpenAPI generator cannot execute repository operations.");
};
const repository: WorkGraphApiRepository = {
  listKnowledgeScopes: unavailable,
  getKnowledgeScope: unavailable,
  putKnowledgeScope: unavailable,
  moveKnowledgeScopePriority: unavailable,
  listKnowledgeScopeRelationships: unavailable,
  addKnowledgeScopeRelationship: unavailable,
  removeKnowledgeScopeRelationship: unavailable,
  listWorkItems: unavailable,
  getWorkItem: unavailable,
  resolveWorkItemContext: unavailable,
  listNotes: unavailable,
  listEvents: unavailable,
  listDependencies: unavailable,
  listLeases: unavailable,
  listAttentionRequests: unavailable,
  createWorkItem: unavailable,
  putWorkItemContext: unavailable,
  putWorkItemArchitectureDecision: unavailable,
  putWorkItemReference: unavailable,
  refreshPullRequest: unavailable,
  putWorkItemPullRequest: unavailable,
  moveWorkItemPriority: unavailable,
  reparentWorkItem: unavailable,
  setWorkItemSchedulingScope: unavailable,
  expediteWorkItem: unavailable,
  unexpediteWorkItem: unavailable,
  addDependency: unavailable,
  removeDependency: unavailable,
  createNote: unavailable,
  createPostReleaseNote: unavailable,
  createAttentionRequest: unavailable,
  resolveAttentionRequest: unavailable,
  claimWorkItem: unavailable,
  renewLease: unavailable,
  terminateClaimedWorkItem: unavailable,
  decomposeClaimedWorkItem: unavailable,
};
const app = createWorkGraphApp(repository);

const document = app.getOpenAPI31Document({
  openapi: "3.1.0",
  info: {
    title: "Work Graph API",
    version: "0.1.0",
    description:
      "The pre-stable canonical REST contract for Work Graph coordination.",
    contact: { name: "Robbie Palmer", url: "https://robbiepalmer.me" },
  },
  servers: [
    {
      url: "/",
      description: "Local or production Work Graph service origin",
      "x-internal": true,
    },
  ],
  tags: [
    {
      name: "knowledge-scopes",
      description:
        "Initiative and project mirrors used for scheduling and context.",
    },
    {
      name: "work-items",
      description:
        "Work-item creation, listing, readiness, and terminal transitions.",
    },
    {
      name: "dependencies",
      description: "Serialized work-item dependency changes.",
    },
    {
      name: "pull-requests",
      description: "Typed work-item links and refreshable PR snapshots.",
    },
    {
      name: "notes",
      description:
        "Lease-fenced work notes and append-only discussion on released work.",
    },
    {
      name: "attention",
      description: "Requests for human decisions or review.",
    },
    { name: "leases", description: "Fenced work-item lease coordination." },
  ],
});

document.paths = Object.fromEntries(
  Object.entries(document.paths ?? {}).sort(([first], [second]) =>
    first.localeCompare(second),
  ),
);
const generated = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const committed = await readFile(outputPath, "utf8").catch(() => "");
  if (committed !== generated) {
    console.error(
      "workers/work-graph-api/openapi.json is stale. Run mise run //workers/work-graph-api:openapi:generate.",
    );
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, generated);
  console.log("Generated workers/work-graph-api/openapi.json");
}

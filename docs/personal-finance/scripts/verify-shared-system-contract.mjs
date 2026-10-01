import { readFileSync } from "node:fs";
import process from "node:process";
import { parse } from "yaml";

const contractDirectory = new URL("../", import.meta.url);
const openapi = parse(
  readFileSync(new URL("shared-system-openapi.yaml", contractDirectory), "utf8"),
);
const sql = readFileSync(
  new URL("shared-system-schema.sql", contractDirectory),
  "utf8",
);
const browserApi = readFileSync(
  new URL("../../ui/lib/api/assettracker.ts", contractDirectory),
  "utf8",
);

const failures = [];
const fail = (message) => failures.push(message);

const operations = [];
for (const [path, pathItem] of Object.entries(openapi.paths ?? {})) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const operation = pathItem[method];
    if (operation == null) continue;
    operations.push({ path, method, pathItem, operation });
  }
}

const commandMatches = browserApi.matchAll(/^ {2}(\w+)\([^;]*\): Promise</gm);
const browserCommands = new Set(
  [...commandMatches].map((match) => match[1]).filter((name) => name !== "reset"),
);
const mappedCommands = new Set(
  operations.flatMap(({ operation }) => operation["x-browser-commands"] ?? []),
);

for (const command of browserCommands) {
  if (!mappedCommands.has(command)) {
    fail(`Browser command ${command} has no x-browser-commands mapping`);
  }
}
for (const command of mappedCommands) {
  if (!browserCommands.has(command)) {
    fail(`OpenAPI maps unknown browser command ${command}`);
  }
}

const requiredWorkspaceFields = [
  "accounts",
  "accountDetails",
  "netWorthData",
  "contributionData",
  "assetAllocation",
  "assetAllocationHistory",
  "transfers",
  "recurringFlows",
  "plannedExpenditures",
  "incomeHistory",
  "flowSankeyData",
  "financialIndependence",
  "portfolioReturn",
  "inflation",
  "netWorthTarget",
  "netWorthTargetIsReal",
  "withdrawalRate",
  "baseCurrency",
  "valuationDate",
  "valuationIssues",
];
const workspaceProperties = openapi.components?.schemas?.HouseholdWorkspace?.properties ?? {};
for (const field of requiredWorkspaceFields) {
  if (workspaceProperties[field] == null) {
    fail(`HouseholdWorkspace is missing browser read model ${field}`);
  }
}

const parameterName = (parameter) => {
  if (parameter.$ref != null) return parameter.$ref.split("/").at(-1);
  return parameter.name;
};

for (const { path, method, pathItem, operation } of operations) {
  if (!["post", "put", "patch", "delete"].includes(method)) continue;
  if (!path.includes("/{householdId}/")) continue;
  const names = new Set(
    [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map(
      parameterName,
    ),
  );
  if (!names.has("IdempotencyKey")) {
    fail(`${method.toUpperCase()} ${path} does not require Idempotency-Key`);
  }
  if (!names.has("IfMatch")) {
    fail(`${method.toUpperCase()} ${path} does not require If-Match`);
  }
  for (const status of ["409", "412", "428"]) {
    if (operation.responses?.[status] == null) {
      fail(`${method.toUpperCase()} ${path} does not document ${status}`);
    }
  }
}

const schemas = openapi.components?.schemas ?? {};
const visit = (value, location) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visit(item, `${location}[${index}]`);
    });
    return;
  }
  if (value == null || typeof value !== "object") return;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/components/schemas/")) {
    const name = value.$ref.split("/").at(-1);
    if (schemas[name] == null) fail(`${location} references missing schema ${name}`);
  }
  for (const [key, child] of Object.entries(value)) {
    visit(child, `${location}.${key}`);
  }
};
visit(openapi, "openapi");

const requiredTables = [
  "app_user",
  "household",
  "household_membership",
  "financial_entity",
  "financial_account",
  "account_ownership",
  "fact_source",
  "financial_record",
  "plan_record",
  "calculation_run",
  "calculation_input",
  "idempotency_record",
  "local_json_import",
];
for (const table of requiredTables) {
  if (!sql.includes(`CREATE TABLE ${table} (`)) {
    fail(`PostgreSQL contract is missing table ${table}`);
  }
}
for (const phrase of [
  "corrects_record_id",
  "supersedes_plan_id",
  "household_state",
  "request_sha256",
  "expires_at >= created_at + interval '7 days'",
  "reject_immutable_change",
]) {
  if (!sql.includes(phrase)) fail(`PostgreSQL contract is missing ${phrase}`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Verified ${operations.length} operations, ${browserCommands.size} browser commands, and ${requiredTables.length} required tables.\n`,
  );
}

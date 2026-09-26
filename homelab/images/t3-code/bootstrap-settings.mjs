import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const homePath = process.env.HOME ?? "/data/home";
const codexHomePath = join(homePath, ".codex");
const settingsPath = join(
  process.env.T3CODE_HOME ?? join(homePath, ".t3"),
  "userdata/settings.json",
);
const codexConfigPath = join(codexHomePath, "config.toml");
const codexModelsCachePath = join(codexHomePath, "models_cache.json");
const codexModelCatalogPath = join(codexHomePath, "model-catalog.json");
const preferredModel = "gpt-5.6-sol";
const preferredReasoningEffort = "high";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOrEmpty(value) {
  return isRecord(value) ? value : {};
}

function atomicWrite(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, contents, { mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  chmodSync(path, 0o600);
}

function configureCodexDefaults(includeModelCatalog) {
  const existingConfig = existsSync(codexConfigPath)
    ? readFileSync(codexConfigPath, "utf8")
    : "";
  const lines = existingConfig.replace(/\n$/, "").split("\n");
  const firstTableIndex = lines.findIndex((line) => /^\s*\[/.test(line));
  const rootEnd = firstTableIndex === -1 ? lines.length : firstTableIndex;
  const managedKeys = new Set([
    "model",
    "model_reasoning_effort",
    "model_catalog_json",
  ]);
  const unmanagedRootLines = lines
    .slice(0, rootEnd)
    .filter((line) => {
      const match =
        /^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*=/.exec(line);
      const key = match?.slice(1).find((value) => value !== undefined);
      return key === undefined || !managedKeys.has(key);
    });
  while (unmanagedRootLines[0] === "") {
    unmanagedRootLines.shift();
  }
  const managedLines = [
    `model = ${JSON.stringify(preferredModel)}`,
    `model_reasoning_effort = ${JSON.stringify(preferredReasoningEffort)}`,
  ];
  if (includeModelCatalog) {
    managedLines.push(
      `model_catalog_json = ${JSON.stringify(codexModelCatalogPath)}`,
    );
  }

  const remainingLines = lines.slice(rootEnd);
  const newLines = [...managedLines];
  if (unmanagedRootLines.some((line) => line !== "") || remainingLines.length > 0) {
    newLines.push("");
  }
  newLines.push(...unmanagedRootLines, ...remainingLines);
  while (newLines.at(-1) === "") {
    newLines.pop();
  }
  atomicWrite(codexConfigPath, `${newLines.join("\n")}\n`);
}

function refreshModelCatalog() {
  if (!existsSync(codexModelsCachePath)) {
    return existsSync(codexModelCatalogPath);
  }

  let catalog;
  try {
    catalog = JSON.parse(readFileSync(codexModelsCachePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Could not read ${codexModelsCachePath}: ${message}`);
    return existsSync(codexModelCatalogPath);
  }
  if (!isRecord(catalog) || !Array.isArray(catalog.models)) {
    console.warn(`${codexModelsCachePath} does not contain a models array`);
    return existsSync(codexModelCatalogPath);
  }

  let foundPreferredModel = false;
  const models = catalog.models.map((value) => {
    if (!isRecord(value)) {
      return value;
    }
    if (value.slug === preferredModel) {
      foundPreferredModel = true;
      return {
        ...value,
        default_reasoning_level: preferredReasoningEffort,
        priority: 0,
      };
    }
    return value.priority === 0 ? { ...value, priority: 1 } : value;
  });

  if (!foundPreferredModel) {
    console.warn(`${codexModelsCachePath} does not contain ${preferredModel}`);
    return existsSync(codexModelCatalogPath);
  }

  atomicWrite(
    codexModelCatalogPath,
    `${JSON.stringify({ ...catalog, models }, null, 2)}\n`,
  );
  return true;
}

mkdirSync(dirname(settingsPath), { recursive: true });

let settings = {};
if (existsSync(settingsPath)) {
  const parsedSettings = JSON.parse(readFileSync(settingsPath, "utf8"));
  if (!isRecord(parsedSettings)) {
    throw new Error(`${settingsPath} must contain a JSON object`);
  }
  settings = parsedSettings;
}

const providers = recordOrEmpty(settings.providers);
const providerInstances = recordOrEmpty(settings.providerInstances);
const legacyCodex2 = recordOrEmpty(providerInstances["codex-personal"]);
const configuredCodex2 = recordOrEmpty(providerInstances.codex2);
const codex2 = { ...legacyCodex2, ...configuredCodex2 };
const codex2Config = {
  ...recordOrEmpty(legacyCodex2.config),
  ...recordOrEmpty(configuredCodex2.config),
};
const migratedProviderInstances = { ...providerInstances };
delete migratedProviderInstances["codex-personal"];

settings.providers = {
  ...providers,
  grok: {
    ...recordOrEmpty(providers.grok),
    enabled: true,
  },
  opencode: {
    ...recordOrEmpty(providers.opencode),
    enabled: true,
  },
};

settings.providerInstances = {
  ...migratedProviderInstances,
  codex2: {
    ...codex2,
    driver: "codex",
    displayName: "codex2",
    accentColor: codex2.accentColor ?? "#30eb25",
    enabled: codex2.enabled ?? true,
    config: {
      ...codex2Config,
      binaryPath: "codex",
      homePath: codexHomePath,
      shadowHomePath: join(homePath, ".codex-personal"),
    },
  },
};

settings.defaultModelSelection = {
  instanceId: "codex",
  model: preferredModel,
  options: [
    { id: "reasoningEffort", value: preferredReasoningEffort },
    { id: "serviceTier", value: "default" },
  ],
};

atomicWrite(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
configureCodexDefaults(refreshModelCatalog());

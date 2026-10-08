#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const PRIVATE_ENTRIES = new Set(["auth.json", "models_cache.json", "log", "tmp"]);
const PALETTE = [
  "#f97316",
  "#8b5cf6",
  "#14b8a6",
  "#f43f5e",
  "#eab308",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

function printUsage(stream) {
  stream.write(`Usage: codex-add-provider NAME [options]

Register a new Codex provider instance for t3-code and start its login.

NAME is the provider instance id stored in t3-code settings; for example
codex-4. It must differ from every existing Codex instance in that settings
file.

Options:
  --slug SLUG     Shadow home directory name (default: NAME)
  --accent COLOR  Accent colour for the provider (default: next palette entry)
  --device-auth   Force device-code login (default: auto-detected)
  --browser-auth  Force browser login
  --no-login      Register the instance only, skip login
  -h, --help      Show this help
`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const options = {
  name: undefined,
  slug: undefined,
  accent: undefined,
  loginMode: "auto",
  runLogin: true,
};

const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  switch (arg) {
    case "--slug":
      options.slug = args[++index];
      if (!options.slug) fail("--slug requires a value");
      break;
    case "--accent":
      options.accent = args[++index];
      if (!options.accent) fail("--accent requires a value");
      break;
    case "--device-auth":
      options.loginMode = "device";
      break;
    case "--browser-auth":
      options.loginMode = "browser";
      break;
    case "--no-login":
      options.runLogin = false;
      break;
    case "-h":
    case "--help":
      printUsage(process.stdout);
      process.exit(0);
      break;
    default:
      if (arg.startsWith("-")) {
        fail(`unknown option: ${arg}`);
      } else if (options.name === undefined) {
        options.name = arg;
      } else {
        fail(`unexpected argument: ${arg}`);
      }
      break;
  }
}

if (options.name === undefined) {
  fail("error: NAME is required");
  printUsage(process.stderr);
  process.exit(2);
}

const isRemote = existsSync("/data/home/.t3") && process.env.HOME === "/data/home";

const base = isRemote
  ? {
      primaryHome: "/data/home/.codex",
      shadowRoot: "/data/home",
      settingsPath:
        `${process.env.T3CODE_HOME ?? "/data/home/.t3"}/userdata/settings.json`,
    }
  : {
      primaryHome: `${process.env.HOME}/.codex`,
      shadowRoot: `${process.env.HOME}/.codex-t3`,
      settingsPath: `${process.env.HOME}/.t3/userdata/settings.json`,
    };

options.slug = options.slug ?? options.name;

const shadowHome = join(base.shadowRoot, options.slug);

if (options.loginMode === "auto") {
  options.loginMode = isRemote ? "device" : "browser";
}

mkdirSync(dirname(shadowHome), { recursive: true });
mkdirSync(shadowHome, { recursive: true, mode: 0o700 });
mkdirSync(join(shadowHome, "log"), { recursive: true, mode: 0o700 });
mkdirSync(join(shadowHome, "tmp"), { recursive: true, mode: 0o700 });

if (existsSync(base.primaryHome)) {
  for (const entryName of readdirSync(base.primaryHome)) {
    if (PRIVATE_ENTRIES.has(entryName)) {
      continue;
    }
    const link = join(shadowHome, entryName);
    if (existsSync(link)) {
      continue;
    }
    try {
      lstatSync(link);
      continue;
    } catch {
      symlinkSync(join(base.primaryHome, entryName), link);
    }
  }
}

if (existsSync(join(shadowHome, "auth.json"))) {
  console.error(
    `note: ${shadowHome}/auth.json exists; login will replace its credentials`,
  );
}

if (!existsSync(base.settingsPath)) {
  fail(`error: no t3-code settings at ${base.settingsPath}`);
}

const settings = JSON.parse(readFileSync(base.settingsPath, "utf8"));
if (!isRecord(settings)) {
  fail(`${base.settingsPath} must contain a JSON object`);
}

if (!isRecord(settings.providerInstances)) {
  settings.providerInstances = {};
}
const instances = settings.providerInstances;
const existing = isRecord(instances[options.name]) ? instances[options.name] : {};

const usedAccents = new Set(
  Object.values(instances)
    .filter((instance) => isRecord(instance) && typeof instance.accentColor === "string")
    .map((instance) => instance.accentColor),
);
const nextAccent = options.accent
  ?? PALETTE.find((colour) => !usedAccents.has(colour))
  ?? PALETTE[0];

const config = isRecord(existing.config) ? existing.config : {};
config.binaryPath = "codex";
config.homePath = base.primaryHome;
config.shadowHomePath = shadowHome;
config.customModels ??= [];

instances[options.name] = {
  ...existing,
  driver: "codex",
  displayName: existing.displayName ?? options.name,
  accentColor: existing.accentColor ?? nextAccent,
  enabled: existing.enabled ?? true,
  config,
};

writeFileSync(base.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
chmodSync(base.settingsPath, 0o600);

if (options.runLogin) {
  const loginArgs = ["login"];
  if (options.loginMode === "device") {
    loginArgs.push("--device-auth");
  }
  console.log(`Signed-in credentials will be stored in ${shadowHome}/auth.json`);
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = shadowHome;
  try {
    execFileSync("codex", loginArgs, { stdio: "inherit" }); // NOSONAR javascript:S4036 - runs the user-installed codex CLI from PATH by design
  } catch (error) {
    if (error.code === "ENOENT") {
      fail("error: codex is not on PATH");
    }
    process.exitCode = 1;
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  }
} else {
  const deviceFlag = options.loginMode === "device" ? " --device-auth" : "";
  console.log(`Skipped login. Authenticate later with:`);
  console.log(`  CODEX_HOME="${shadowHome}" codex login${deviceFlag}`);
}

const where = isRemote ? "remote t3-code settings" : "t3-code settings";
console.log(`Registered ${options.name} in the ${where} at ${base.settingsPath}`);
console.log(
  isRemote
    ? "Restart the t3-code pod so the client picks up the new provider."
    : "Restart the t3-code desktop client so it picks up the new provider.",
);
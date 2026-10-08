import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const minimumUnoFreeBytes = 768;
const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

const firmwareTargets = {
  esp32: {
    profile: "esp32",
    sketch: "firmware/esp32_espnow",
  },
  uno: {
    profile: "uno",
    sketch: "firmware/uno_ir",
  },
} as const;

type FirmwareTarget = keyof typeof firmwareTargets;
type JsonRecord = Record<string, unknown>;

export interface ArduinoCompileReport {
  compilerError: string;
  compilerOutput: string;
  executableSections: readonly ExecutableSection[];
  success: boolean;
}

export interface ExecutableSection {
  maximumSize: number;
  name: string;
  size: number;
}

class ConfigurationError extends Error {}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseExecutableSection(value: unknown): ExecutableSection | undefined {
  if (!isJsonRecord(value)) {
    return undefined;
  }

  const name = value.name;
  const size = value.size;
  const maximumSize = value.max_size;
  if (
    typeof name !== "string" ||
    !Number.isSafeInteger(size) ||
    !Number.isSafeInteger(maximumSize)
  ) {
    return undefined;
  }

  return { maximumSize: Number(maximumSize), name, size: Number(size) };
}

export function parseCompileReport(source: string): ArduinoCompileReport {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse the Arduino CLI JSON report: ${detail}`);
  }

  if (!isJsonRecord(value) || typeof value.success !== "boolean") {
    throw new Error("Arduino CLI returned an invalid compile report.");
  }

  const builderResult = value.builder_result;
  const rawSections = isJsonRecord(builderResult)
    ? builderResult.executable_sections_size
    : undefined;
  const executableSections = Array.isArray(rawSections)
    ? rawSections
        .map(parseExecutableSection)
        .filter((section): section is ExecutableSection => section !== undefined)
    : [];

  return {
    compilerError: optionalString(value.compiler_err),
    compilerOutput: optionalString(value.compiler_out),
    executableSections,
    success: value.success,
  };
}

export function unoFreeBytes(report: ArduinoCompileReport): number {
  const dataSection = report.executableSections.find(
    (section) => section.name === "data",
  );
  if (!report.success || dataSection === undefined) {
    throw new Error(
      "Arduino CLI did not report a successful Uno SRAM measurement.",
    );
  }

  return dataSection.maximumSize - dataSection.size;
}

export function enforceUnoSramBudget(
  report: ArduinoCompileReport,
  minimumFreeBytes = minimumUnoFreeBytes,
): number {
  const freeBytes = unoFreeBytes(report);
  if (freeBytes < minimumFreeBytes) {
    throw new Error("Uno firmware exceeds the static SRAM budget.");
  }

  return freeBytes;
}

export function boundedInteger(
  name: string,
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = value ?? String(defaultValue);
  if (!/^\d+$/.test(candidate)) {
    throw new ConfigurationError(
      `${name} must be an integer from ${minimum} to ${maximum}`,
    );
  }

  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(
      `${name} must be an integer from ${minimum} to ${maximum}`,
    );
  }

  return parsed;
}

export function validatedArduinoCliPath(value: string | undefined): string {
  if (
    value === undefined ||
    !isAbsolute(value) ||
    basename(value) !== "arduino-cli"
  ) {
    throw new ConfigurationError(
      "Mise must provide the absolute path to its pinned arduino-cli executable",
    );
  }

  return value;
}

function compileArguments(
  target: FirmwareTarget,
  environment: NodeJS.ProcessEnv,
): string[] {
  const nodeId = boundedInteger(
    "SATELLITE_SWARM_NODE_ID",
    environment.SATELLITE_SWARM_NODE_ID,
    0,
    0,
    15,
  );
  const bootEpoch = boundedInteger(
    "SATELLITE_SWARM_BOOT_EPOCH",
    environment.SATELLITE_SWARM_BOOT_EPOCH,
    1,
    1,
    4_294_967_295,
  );
  const definition = firmwareTargets[target];
  const arguments_ = ["compile"];
  if (target === "uno") {
    arguments_.push("--json");
  }
  arguments_.push(
    "--profile",
    definition.profile,
    "--build-property",
    `build.extra_flags=-DSATELLITE_SWARM_NODE_ID=${nodeId} -DSATELLITE_SWARM_BOOT_EPOCH=${bootEpoch}`,
    definition.sketch,
  );
  return arguments_;
}

function isFirmwareTarget(value: string | undefined): value is FirmwareTarget {
  return value !== undefined && Object.hasOwn(firmwareTargets, value);
}

export function run(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): number {
  const target = arguments_[0];
  if (!isFirmwareTarget(target) || arguments_.length !== 2) {
    throw new ConfigurationError(
      "Usage: compile-firmware.ts <uno|esp32> <absolute-arduino-cli-path>",
    );
  }
  const arduinoCliPath = validatedArduinoCliPath(arguments_[1]);

  const compileResult = spawnSync(
    arduinoCliPath,
    compileArguments(target, environment),
    {
      cwd: projectDirectory,
      encoding: "utf8",
      stdio: target === "uno" ? "pipe" : "inherit",
    },
  );
  if (compileResult.error !== undefined) {
    throw compileResult.error;
  }

  if (target === "esp32") {
    return compileResult.status ?? 1;
  }

  process.stderr.write(compileResult.stderr);
  const report = parseCompileReport(compileResult.stdout);
  process.stdout.write(report.compilerOutput);
  process.stderr.write(report.compilerError);

  const freeBytes = enforceUnoSramBudget(report);
  console.log(
    `Uno SRAM budget: ${freeBytes} bytes free; minimum ${minimumUnoFreeBytes} bytes.`,
  );

  return compileResult.status ?? 1;
}

function main(): number {
  try {
    return run(process.argv.slice(2), process.env);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(detail);
    return error instanceof ConfigurationError ? 2 : 1;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}

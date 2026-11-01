const DEFAULT_PROPERTY_SEED = 20261029;
const DEFAULT_PROPERTY_RUNS = 100;

function environmentValue(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env?.[name];
}

function replaySeed(): number {
  const configured = environmentValue("FC_SEED");
  if (configured === undefined) return DEFAULT_PROPERTY_SEED;

  const seed = Number(configured);
  if (!Number.isSafeInteger(seed)) {
    throw new TypeError(`FC_SEED must be a safe integer, received ${configured}`);
  }
  return seed;
}

export function propertyParameters(numRuns = DEFAULT_PROPERTY_RUNS) {
  const path = environmentValue("FC_PATH");
  return {
    numRuns,
    seed: replaySeed(),
    ...(path ? { path } : {}),
  };
}

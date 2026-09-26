import { z } from "zod";
import {
  parseSatelliteSwarmSimulation,
  type SatelliteSwarmSimulation,
} from "@/lib/api/satellite-swarm-simulation";

export const SATELLITE_SWARM_WORKER_PROTOCOL_VERSION = 5 as const;

const WORKER_URL =
  "/simulations/autonomic-satellite-swarm/satellite-swarm.worker.mjs";
const WORKER_TIMEOUT_MS = 15_000;

const resultMessageSchema = z.object({
  protocolVersion: z.literal(SATELLITE_SWARM_WORKER_PROTOCOL_VERSION),
  requestId: z.string(),
  result: z.unknown(),
  sourceRevision: z.string().regex(/^[0-9a-f]{40}$/),
  type: z.literal("result"),
});

const errorMessageSchema = z.object({
  error: z.string().min(1),
  protocolVersion: z.literal(SATELLITE_SWARM_WORKER_PROTOCOL_VERSION),
  requestId: z.string(),
  type: z.literal("error"),
});

const responseMessageSchema = z.discriminatedUnion("type", [
  resultMessageSchema,
  errorMessageSchema,
]);

export interface SatelliteSwarmObjective {
  latitudeDegrees: number;
  longitudeDegrees: number;
}

export type SatelliteSwarmScenario =
  | "lost-assignment"
  | "nominal"
  | "safe-state-success";

export interface SatelliteSwarmRunOptions {
  scenario?: SatelliteSwarmScenario;
  signal?: AbortSignal;
  timeoutMs?: number;
}

let requestSequence = 0;

function validateObjective(objective: SatelliteSwarmObjective) {
  if (
    !Number.isFinite(objective.longitudeDegrees) ||
    objective.longitudeDegrees < -180 ||
    objective.longitudeDegrees > 180
  ) {
    throw new RangeError("Longitude must be between -180 and 180 degrees.");
  }
  if (
    !Number.isFinite(objective.latitudeDegrees) ||
    objective.latitudeDegrees < -90 ||
    objective.latitudeDegrees > 90
  ) {
    throw new RangeError("Latitude must be between -90 and 90 degrees.");
  }
}

function abortError(): DOMException {
  return new DOMException(
    "The simulation request was cancelled.",
    "AbortError",
  );
}

export function runSatelliteSwarmSimulation(
  objective: SatelliteSwarmObjective,
  options: SatelliteSwarmRunOptions = {},
): Promise<SatelliteSwarmSimulation> {
  validateObjective(objective);
  if (options.signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker === "undefined") {
    return Promise.reject(
      new Error("This browser does not support module Web Workers."),
    );
  }

  requestSequence += 1;
  const requestId = `satellite-swarm-${requestSequence}`;
  const worker = new Worker(WORKER_URL, {
    name: "satellite-swarm-simulation",
    type: "module",
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout = 0;

    function cleanUp() {
      window.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", handleAbort);
      worker.removeEventListener("error", handleError);
      worker.removeEventListener("message", handleMessage);
      worker.terminate();
    }

    function finish(value: SatelliteSwarmSimulation) {
      if (settled) return;
      settled = true;
      cleanUp();
      resolve(value);
    }

    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      cleanUp();
      reject(
        error instanceof Error || error instanceof DOMException
          ? error
          : new Error(String(error)),
      );
    }

    function handleAbort() {
      fail(abortError());
    }

    function handleError(event: ErrorEvent) {
      fail(
        new Error(event.message || "The simulation worker could not start."),
      );
    }

    function handleMessage(event: MessageEvent<unknown>) {
      const parsed = responseMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.requestId !== requestId) return;
      if (parsed.data.type === "error") {
        fail(new Error(parsed.data.error));
        return;
      }
      try {
        finish(
          parseSatelliteSwarmSimulation({
            ...(typeof parsed.data.result === "object" &&
            parsed.data.result !== null
              ? parsed.data.result
              : {}),
            sourceRevision: parsed.data.sourceRevision,
          }),
        );
      } catch (error) {
        fail(error);
      }
    }

    timeout = window.setTimeout(
      () =>
        fail(new Error("The WebAssembly simulation did not respond in time.")),
      options.timeoutMs ?? WORKER_TIMEOUT_MS,
    );

    options.signal?.addEventListener("abort", handleAbort, { once: true });
    worker.addEventListener("error", handleError);
    worker.addEventListener("message", handleMessage);

    try {
      worker.postMessage({
        objective,
        protocolVersion: SATELLITE_SWARM_WORKER_PROTOCOL_VERSION,
        requestId,
        scenario: options.scenario ?? "nominal",
        type: "run",
      });
    } catch (error) {
      fail(error);
    }
  });
}

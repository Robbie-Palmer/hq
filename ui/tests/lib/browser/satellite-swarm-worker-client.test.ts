import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runSatelliteSwarmSimulation,
  SATELLITE_SWARM_WORKER_PROTOCOL_VERSION,
} from "@/lib/browser/satellite-swarm-worker-client";

const sourceRevision = "0123456789abcdef0123456789abcdef01234567";

const validResult = {
  events: [],
  frames: [
    {
      nodes: [
        {
          assignedNode: null,
          bootEpoch: 1,
          candidacyScore: 0,
          telemetryDrops: 0,
          id: 0,
          missionKey: { bootEpoch: 1, originNode: 0, sequence: 1 },
          orbitalRadiusMetres: 6_750_000,
          position: { latitudeDegrees: 0, longitudeDegrees: 0 },
          state: "leading",
        },
      ],
      timeMs: 0,
    },
  ],
  objective: { latitudeDegrees: -90, longitudeDegrees: 0 },
  positionModel: "scripted simulation data; not orbit propagation",
  scenario: "three-node-objective-pass",
  schemaVersion: 6,
  source: "portable C++ SimulationTrace",
  traceVersion: 5,
};

type WorkerListener = (event: MessageEvent<unknown> | ErrorEvent) => void;

class MockWorker {
  static latest: MockWorker | null = null;

  readonly listeners = new Map<string, WorkerListener[]>();
  readonly options: WorkerOptions | undefined;
  readonly url: string | URL;
  posted: unknown = null;
  terminated = false;

  constructor(url: string | URL, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    MockWorker.latest = this;
  }

  addEventListener(type: string, listener: WorkerListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: WorkerListener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(
        (candidate) => candidate !== listener,
      ),
    );
  }

  postMessage(value: unknown) {
    this.posted = value;
  }

  terminate() {
    this.terminated = true;
  }

  emitMessage(value: unknown) {
    for (const listener of this.listeners.get("message") ?? []) {
      listener(new MessageEvent("message", { data: value }));
    }
  }

  emitError(message: string) {
    for (const listener of this.listeners.get("error") ?? []) {
      listener(new ErrorEvent("error", { message }));
    }
  }
}

describe("satellite swarm worker client", () => {
  beforeEach(() => {
    MockWorker.latest = null;
    vi.stubGlobal("Worker", MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a versioned request and validates the result", async () => {
    const resultPromise = runSatelliteSwarmSimulation({
      latitudeDegrees: -90,
      longitudeDegrees: 0,
    });
    const worker = MockWorker.latest;
    if (!worker) throw new Error("Expected a worker instance");
    const request = worker.posted as { requestId: string };

    expect(worker.url).toBe(
      "/simulations/autonomic-satellite-swarm/satellite-swarm.worker.mjs",
    );
    expect(worker.options).toEqual({
      name: "satellite-swarm-simulation",
      type: "module",
    });
    expect(worker.posted).toMatchObject({
      objective: { latitudeDegrees: -90, longitudeDegrees: 0 },
      protocolVersion: SATELLITE_SWARM_WORKER_PROTOCOL_VERSION,
      scenario: "nominal",
      type: "run",
    });

    worker.emitMessage({
      protocolVersion: SATELLITE_SWARM_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      result: validResult,
      sourceRevision,
      type: "result",
    });

    await expect(resultPromise).resolves.toMatchObject({
      objective: { latitudeDegrees: -90, longitudeDegrees: 0 },
      sourceRevision,
    });
    expect(worker.terminated).toBe(true);
    expect(worker.listeners.get("message")).toEqual([]);
    expect(worker.listeners.get("error")).toEqual([]);
  });

  it("sends a selected fault scenario to the worker", async () => {
    const resultPromise = runSatelliteSwarmSimulation(
      { latitudeDegrees: -90, longitudeDegrees: 0 },
      { scenario: "lost-assignment" },
    );
    const worker = MockWorker.latest;
    if (!worker) throw new Error("Expected a worker instance");
    const request = worker.posted as { requestId: string };

    expect(worker.posted).toMatchObject({
      scenario: "lost-assignment",
    });
    worker.emitMessage({
      protocolVersion: SATELLITE_SWARM_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      result: validResult,
      sourceRevision,
      type: "result",
    });
    await resultPromise;
  });

  it("sends the safe-state completion scenario to the worker", async () => {
    const resultPromise = runSatelliteSwarmSimulation(
      { latitudeDegrees: -90, longitudeDegrees: 0 },
      { scenario: "safe-state-success" },
    );
    const worker = MockWorker.latest;
    if (!worker) throw new Error("Expected a worker instance");
    const request = worker.posted as { requestId: string };

    expect(worker.posted).toMatchObject({
      scenario: "safe-state-success",
    });
    worker.emitMessage({
      protocolVersion: SATELLITE_SWARM_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      result: validResult,
      sourceRevision,
      type: "result",
    });
    await resultPromise;
  });

  it("surfaces a worker error response", async () => {
    const resultPromise = runSatelliteSwarmSimulation({
      latitudeDegrees: 10,
      longitudeDegrees: 20,
    });
    const worker = MockWorker.latest;
    if (!worker) throw new Error("Expected a worker instance");
    const request = worker.posted as { requestId: string };

    worker.emitMessage({
      error: "C++ rejected the mission",
      protocolVersion: SATELLITE_SWARM_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      type: "error",
    });

    await expect(resultPromise).rejects.toThrow("C++ rejected the mission");
    expect(worker.terminated).toBe(true);
    expect(worker.listeners.get("message")).toEqual([]);
    expect(worker.listeners.get("error")).toEqual([]);
  });

  it("terminates the worker when the caller aborts", async () => {
    const controller = new AbortController();
    const resultPromise = runSatelliteSwarmSimulation(
      { latitudeDegrees: 10, longitudeDegrees: 20 },
      { signal: controller.signal },
    );
    const worker = MockWorker.latest;
    if (!worker) throw new Error("Expected a worker instance");

    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
    expect(worker.listeners.get("message")).toEqual([]);
    expect(worker.listeners.get("error")).toEqual([]);
  });

  it("rejects invalid coordinates before creating a worker", () => {
    expect(() =>
      runSatelliteSwarmSimulation({
        latitudeDegrees: 91,
        longitudeDegrees: 0,
      }),
    ).toThrow("Latitude must be between -90 and 90 degrees.");
    expect(MockWorker.latest).toBeNull();
  });

  it("reports worker startup failures", async () => {
    const resultPromise = runSatelliteSwarmSimulation({
      latitudeDegrees: 10,
      longitudeDegrees: 20,
    });
    const worker = MockWorker.latest;
    if (!worker) throw new Error("Expected a worker instance");

    worker.emitError("Unable to load module script");

    await expect(resultPromise).rejects.toThrow("Unable to load module script");
  });
});

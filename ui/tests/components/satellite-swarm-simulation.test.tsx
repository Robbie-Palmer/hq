import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DeferredSatelliteSwarmSimulation } from "@/components/projects/satellite-swarm/deferred-satellite-swarm-simulation";
import { SatelliteSwarmSimulation } from "@/components/projects/satellite-swarm/satellite-swarm-simulation";
import { parseSatelliteSwarmSimulation } from "@/lib/api/satellite-swarm-simulation";

const globeState = vi.hoisted(() => ({
  onFailure: null as ((error: unknown) => void) | null,
}));
const workerClient = vi.hoisted(() => ({
  run: vi.fn(),
}));
let intersectionCallback: IntersectionObserverCallback;

function enterSimulationViewport() {
  act(() => {
    intersectionCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeAll(() => {
  for (const method of [
    "setPointerCapture",
    "releasePointerCapture",
    "hasPointerCapture",
  ]) {
    Object.defineProperty(HTMLElement.prototype, method, {
      configurable: true,
      value: vi.fn(),
    });
  }
  Element.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  for (const method of [
    "setPointerCapture",
    "releasePointerCapture",
    "hasPointerCapture",
  ]) {
    Reflect.deleteProperty(HTMLElement.prototype, method);
  }
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

vi.mock(
  "@/components/projects/satellite-swarm/lazy-satellite-swarm-globe",
  () => ({
    LazySatelliteSwarmGlobe: ({
      onFailure,
    }: {
      onFailure: (error: unknown) => void;
    }) => {
      globeState.onFailure = onFailure;
      return <div>Cesium globe</div>;
    },
  }),
);

vi.mock("@/lib/browser/satellite-swarm-worker-client", () => ({
  runSatelliteSwarmSimulation: workerClient.run,
}));

const data = parseSatelliteSwarmSimulation({
  schemaVersion: 7,
  traceVersion: 5,
  scenario: "test",
  source: "portable C++ SimulationTrace",
  sourceRevision: "0123456789abcdef0123456789abcdef01234567",
  positionModel: "scripted simulation data; not orbit propagation",
  propagationFrame: "TEME",
  renderingFrame: "test Earth-fixed frame",
  scenarioEpochUnixMilliseconds: 962650219734,
  objective: { longitudeDegrees: 0, latitudeDegrees: -90 },
  frames: [
    {
      playbackMultiplier: 0.1,
      timeMs: 0,
      nodes: [
        {
          id: 0,
          bootEpoch: 1,
          state: "leading",
          position: { longitudeDegrees: 0, latitudeDegrees: 10 },
          orbitalRadiusMetres: 6_750_000,
          candidacyScore: 60,
          earthFixedPositionMetres: { x: 6_750_000, y: 0, z: 0 },
          earthFixedVelocityMillimetresPerSecond: { x: 0, y: 7_500_000, z: 0 },
          epochUnixMilliseconds: 962650219734,
          telemetryDrops: 0,
          missionKey: { bootEpoch: 1, originNode: 0, sequence: 1 },
          assignedNode: null,
        },
        {
          id: 1,
          bootEpoch: 1,
          state: "awaiting assignment",
          position: { longitudeDegrees: 1, latitudeDegrees: 0 },
          orbitalRadiusMetres: 6_750_000,
          candidacyScore: 81,
          earthFixedPositionMetres: { x: 6_700_000, y: 500_000, z: 0 },
          earthFixedVelocityMillimetresPerSecond: {
            x: -500_000,
            y: 7_400_000,
            z: 0,
          },
          epochUnixMilliseconds: 962650219734,
          telemetryDrops: 0,
          missionKey: { bootEpoch: 1, originNode: 0, sequence: 1 },
          assignedNode: null,
        },
      ],
    },
    {
      playbackMultiplier: 100,
      timeMs: 100,
      nodes: [
        {
          id: 0,
          bootEpoch: 1,
          state: "idle",
          position: { longitudeDegrees: 0, latitudeDegrees: 9 },
          orbitalRadiusMetres: 6_750_000,
          candidacyScore: 60,
          earthFixedPositionMetres: { x: 6_749_000, y: 100_000, z: 0 },
          earthFixedVelocityMillimetresPerSecond: {
            x: -100_000,
            y: 7_500_000,
            z: 0,
          },
          epochUnixMilliseconds: 962650219834,
          telemetryDrops: 0,
          missionKey: { bootEpoch: 1, originNode: 0, sequence: 1 },
          assignedNode: 1,
        },
        {
          id: 1,
          bootEpoch: 1,
          state: "active",
          position: { longitudeDegrees: 1, latitudeDegrees: -1 },
          orbitalRadiusMetres: 6_750_000,
          candidacyScore: 81,
          earthFixedPositionMetres: { x: 6_690_000, y: 600_000, z: -100_000 },
          earthFixedVelocityMillimetresPerSecond: {
            x: -600_000,
            y: 7_390_000,
            z: -100_000,
          },
          epochUnixMilliseconds: 962650219834,
          telemetryDrops: 0,
          missionKey: { bootEpoch: 1, originNode: 0, sequence: 1 },
          assignedNode: 1,
        },
      ],
    },
  ],
  events: [
    {
      type: "message-sent",
      timeMs: 0,
      nodeId: 1,
      message: {
        type: "candidacy",
        sender: 1,
        target: 0,
        missionKey: { bootEpoch: 1, originNode: 0, sequence: 1 },
        score: 81,
      },
    },
    {
      type: "message-sent",
      timeMs: 100,
      nodeId: 0,
      message: {
        type: "mission-assignment",
        sender: 0,
        target: 1,
        missionKey: { bootEpoch: 1, originNode: 0, sequence: 1 },
        score: 0,
      },
    },
  ],
});

describe("SatelliteSwarmSimulation", () => {
  beforeEach(() => {
    workerClient.run.mockReset();
    workerClient.run.mockResolvedValue(data);
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      disconnect() {}

      observe() {}
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    globeState.onFailure = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("runs the South Pole mission through the worker at the project boundary", async () => {
    render(<DeferredSatelliteSwarmSimulation />);

    enterSimulationViewport();
    expect(await screen.findByText(/trace v5 · 0 ms/)).toBeVisible();
    expect(workerClient.run).toHaveBeenCalledWith(
      { latitudeDegrees: -90, longitudeDegrees: 0 },
      { scenario: "nominal", signal: expect.any(AbortSignal) },
    );
    expect(screen.getByText(/ran as WebAssembly/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Pause replay" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "0123456789ab" })).toHaveAttribute(
      "href",
      "https://github.com/Robbie-Palmer/hq/commit/0123456789abcdef0123456789abcdef01234567",
    );
  });

  it("aborts the worker request when unmounted", async () => {
    let requestSignal: AbortSignal | undefined;
    workerClient.run.mockImplementation((_objective, options) => {
      requestSignal = options?.signal;
      return new Promise(() => undefined);
    });
    const { unmount } = render(<DeferredSatelliteSwarmSimulation />);
    enterSimulationViewport();
    await waitFor(() => expect(requestSignal?.aborted).toBe(false));

    unmount();

    expect(requestSignal?.aborted).toBe(true);
  });

  it("starts the simulation when it enters the viewport", () => {
    workerClient.run.mockImplementation(() => new Promise(() => undefined));

    render(<DeferredSatelliteSwarmSimulation />);

    expect(workerClient.run).not.toHaveBeenCalled();
    expect(screen.getByText("Waiting to load the simulation...")).toBeVisible();

    enterSimulationViewport();

    expect(workerClient.run).toHaveBeenCalledWith(
      { latitudeDegrees: -90, longitudeDegrees: 0 },
      { scenario: "nominal", signal: expect.any(AbortSignal) },
    );
    expect(
      screen.getByText("Preparing the deterministic mission replay..."),
    ).toBeVisible();
    expect(screen.queryByText("Cesium globe")).not.toBeInTheDocument();
  });

  it("starts once without IntersectionObserver under Strict Mode", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);

    render(
      <StrictMode>
        <DeferredSatelliteSwarmSimulation />
      </StrictMode>,
    );

    expect(await screen.findByText(/trace v5 · 0 ms/)).toBeVisible();
    expect(workerClient.run).toHaveBeenCalledOnce();
  });

  it("runs a caller-provided mission objective", async () => {
    const user = userEvent.setup();
    render(<DeferredSatelliteSwarmSimulation />);
    enterSimulationViewport();
    expect(await screen.findByText(/trace v5 · 0 ms/)).toBeVisible();

    const longitude = screen.getByRole("spinbutton", { name: "Longitude" });
    const latitude = screen.getByRole("spinbutton", { name: "Latitude" });
    await user.clear(longitude);
    await user.type(longitude, "14.25");
    await user.clear(latitude);
    await user.type(latitude, "-37.5");
    await user.click(screen.getByRole("button", { name: "Run mission" }));

    await waitFor(() =>
      expect(workerClient.run).toHaveBeenLastCalledWith(
        { latitudeDegrees: -37.5, longitudeDegrees: 14.25 },
        { scenario: "nominal", signal: expect.any(AbortSignal) },
      ),
    );
    expect(screen.getByRole("button", { name: "Pause replay" })).toBeEnabled();
  });

  it("runs the deterministic assignment-loss scenario", async () => {
    const user = userEvent.setup();
    render(<DeferredSatelliteSwarmSimulation />);
    enterSimulationViewport();
    expect(await screen.findByText(/trace v5 · 0 ms/)).toBeVisible();

    const scenario = screen.getByRole("combobox", {
      name: "Simulation scenario",
    });
    await user.click(scenario);
    await user.keyboard("{ArrowDown}");
    await user.click(
      screen.getByRole("option", { name: "Lose winning assignment" }),
    );
    await user.click(screen.getByRole("button", { name: "Run mission" }));

    await waitFor(() =>
      expect(workerClient.run).toHaveBeenLastCalledWith(
        { latitudeDegrees: -90, longitudeDegrees: 0 },
        {
          scenario: "lost-assignment",
          signal: expect.any(AbortSignal),
        },
      ),
    );
  });

  it("runs the deterministic safe-state completion scenario", async () => {
    const user = userEvent.setup();
    render(<DeferredSatelliteSwarmSimulation />);
    enterSimulationViewport();
    expect(await screen.findByText(/trace v5 · 0 ms/)).toBeVisible();

    const scenario = screen.getByRole("combobox", {
      name: "Simulation scenario",
    });
    await user.click(scenario);
    await user.click(
      screen.getByRole("option", { name: "Complete safe-state action" }),
    );
    await user.click(screen.getByRole("button", { name: "Run mission" }));

    await waitFor(() =>
      expect(workerClient.run).toHaveBeenLastCalledWith(
        { latitudeDegrees: -90, longitudeDegrees: 0 },
        {
          scenario: "safe-state-success",
          signal: expect.any(AbortSignal),
        },
      ),
    );
  });

  it("restarts playback when rerunning the same objective", async () => {
    const user = userEvent.setup();
    render(<DeferredSatelliteSwarmSimulation />);
    enterSimulationViewport();
    expect(await screen.findByText(/trace v5 · 0 ms/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Next frame" }));
    expect(screen.getByText(/trace v5 · 100 ms/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Run mission" }));

    expect(await screen.findByText(/trace v5 · 0 ms/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Pause replay" })).toBeEnabled();
  });

  it("keeps the latest mission running when an earlier request settles", async () => {
    const user = userEvent.setup();
    render(<DeferredSatelliteSwarmSimulation />);
    enterSimulationViewport();
    expect(await screen.findByText(/trace v5 · 0 ms/)).toBeVisible();

    let rejectEarlier: ((error: unknown) => void) | undefined;
    let resolveLatest: ((value: typeof data) => void) | undefined;
    workerClient.run
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectEarlier = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLatest = resolve;
          }),
      );

    await user.click(screen.getByRole("button", { name: "South Pole" }));
    await user.click(screen.getByRole("button", { name: "South Pole" }));
    act(() => rejectEarlier?.(new DOMException("Cancelled", "AbortError")));

    await waitFor(() =>
      expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument(),
    );

    act(() => resolveLatest?.(data));
    await waitFor(() =>
      expect(document.querySelector('[aria-busy="false"]')).toBeInTheDocument(),
    );
  });

  it("steps through the native state and event record", async () => {
    const user = userEvent.setup();
    render(<SatelliteSwarmSimulation data={data} />);

    expect(screen.getByText("South Pole mission replay")).toBeVisible();
    expect(screen.getByText(/deliberate coordinate edge case/i)).toBeVisible();
    expect(screen.getByText("Cesium globe")).toBeVisible();
    expect(
      screen.getByText(/current SGP4 orbit · selected Node 0/i),
    ).toBeVisible();
    expect(
      screen.getByText(/waiting for an accepted assignment/i),
    ).toBeVisible();
    expect(screen.getByText(/coordination in slow motion/i)).toBeVisible();
    expect(
      document.querySelector(
        'link[href="/cesium/Widgets/widgets.css"][rel="stylesheet"]',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("awaiting assignment")).toBeVisible();
    expect(screen.queryByText(/assigned mission 1/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Next frame" }));

    expect(screen.getByText("active")).toBeVisible();
    expect(
      screen.getByText(/Node 1 accepted the assignment.*orbit is unchanged/i),
    ).toBeVisible();
    expect(
      screen.getAllByText(/assigned mission 0:1:1 to node 1/i),
    ).toHaveLength(2);
    expect(screen.getByText(/trace v5 · 100 ms/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Replay mission" }),
    ).toBeEnabled();
  });

  it("formats minute- and hour-scale orbit replay timestamps", async () => {
    const user = userEvent.setup();
    const firstFrame = data.frames[0];
    const secondFrame = data.frames[1];
    if (!firstFrame || !secondFrame) {
      throw new Error("satellite replay fixture requires at least two frames");
    }
    const timedData = {
      ...data,
      frames: [
        firstFrame,
        { ...secondFrame, timeMs: 60_000 },
        { ...secondFrame, timeMs: 3_661_000 },
      ],
    };
    render(<SatelliteSwarmSimulation data={timedData} />);

    await user.click(screen.getByRole("button", { name: "Next frame" }));
    expect(screen.getByText(/trace v5 · 1m 00s · 100×/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Next frame" }));
    expect(screen.getByText(/trace v5 · 1h 01m 01s · 100×/)).toBeVisible();
  });

  it("advances and stops autoplay at the final orbit frame", () => {
    vi.useFakeTimers();
    render(<SatelliteSwarmSimulation data={data} />);

    act(() => screen.getByRole("button", { name: "Play replay" }).click());
    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.getByText(/trace v5 · 100 ms · 100×/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Replay mission" }),
    ).toBeEnabled();
    vi.useRealTimers();
  });

  it("labels a paused trace as resumable", async () => {
    const user = userEvent.setup();
    render(
      <SatelliteSwarmSimulation
        data={{ ...data, frames: [...data.frames, ...data.frames.slice(-1)] }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Next frame" }));
    expect(screen.getByRole("button", { name: "Resume replay" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Resume replay" }));
    expect(screen.getByRole("button", { name: "Pause replay" })).toBeEnabled();
  });

  it("disables autoplay when reduced motion is requested", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    });

    render(<SatelliteSwarmSimulation data={data} />);

    expect(screen.getByRole("button", { name: "Play replay" })).toBeDisabled();
    expect(screen.getByText(/autoplay is off/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Next frame" })).toBeEnabled();
  });

  it("stops playback when reduced motion becomes active", async () => {
    let reducedMotion = false;
    let changeListener: (() => void) | undefined;
    vi.spyOn(window, "matchMedia").mockReturnValue({
      get matches() {
        return reducedMotion;
      },
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn((_event, listener) => {
        changeListener = listener as () => void;
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    });
    const user = userEvent.setup();

    render(<SatelliteSwarmSimulation data={data} />);
    await user.click(screen.getByRole("button", { name: "Play replay" }));
    expect(screen.getByRole("button", { name: "Pause replay" })).toBeEnabled();

    act(() => {
      reducedMotion = true;
      changeListener?.();
    });

    expect(screen.getByRole("button", { name: "Play replay" })).toBeDisabled();
  });

  it("shows the globe startup error and offers a retry", async () => {
    const user = userEvent.setup();
    render(<SatelliteSwarmSimulation data={data} />);

    act(() => {
      globeState.onFailure?.(new Error("Both WebGL contexts failed"));
    });

    expect(screen.getByText(/Both WebGL contexts failed/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Retry globe" }));

    expect(screen.getByText("Cesium globe")).toBeVisible();
  });
});

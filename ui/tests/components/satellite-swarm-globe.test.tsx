import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SatelliteSwarmGlobe } from "@/components/projects/satellite-swarm/satellite-swarm-globe";
import { parseSatelliteSwarmSimulation } from "@/lib/api/satellite-swarm-simulation";

const runtimeMocks = vi.hoisted(() => ({
  createViewer: vi.fn(),
  load: vi.fn(),
}));

vi.mock("@/components/technology/cesium/cesium-runtime", () => ({
  loadCesiumRuntime: runtimeMocks.load,
}));

vi.mock("@/components/technology/cesium/offline-viewer", () => ({
  createOfflineCesiumViewer: runtimeMocks.createViewer,
}));

const data = parseSatelliteSwarmSimulation({
  schemaVersion: 7,
  traceVersion: 5,
  scenario: "test",
  source: "portable C++ SimulationTrace",
  sourceRevision: "0123456789abcdef0123456789abcdef01234567",
  positionModel: "scripted",
  propagationFrame: "TEME",
  renderingFrame: "test Earth-fixed frame",
  scenarioEpochUnixMilliseconds: 962650219734,
  objective: { longitudeDegrees: 4, latitudeDegrees: -90 },
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
          position: { longitudeDegrees: 2, latitudeDegrees: 0 },
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
          position: { longitudeDegrees: 1, latitudeDegrees: 9 },
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
          position: { longitudeDegrees: 3, latitudeDegrees: -1 },
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
  events: [],
});

function createHarness(supportsLabels = true) {
  const add = vi.fn();
  const destroy = vi.fn();
  const removeAll = vi.fn();
  const requestRender = vi.fn();
  const fromDegrees = vi.fn((...coordinates: number[]) => coordinates);
  const fromElements = vi.fn((...coordinates: number[]) => coordinates);
  const addSample = vi.fn();
  const setInterpolationOptions = vi.fn();
  const color = { withAlpha: vi.fn((alpha: number) => ({ alpha })) };
  const fromCssColorString = vi.fn(() => color);
  const viewer = {
    clock: { currentTime: null, multiplier: 0, shouldAnimate: false },
    destroy,
    entities: { add, removeAll },
    isDestroyed: vi.fn(() => false),
    scene: { requestRender },
  };
  const runtime = {
    Cartesian2: class {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
    },
    Cartesian3: { fromDegrees, fromElements },
    Color: {
      BLACK: "black",
      WHITE: { withAlpha: vi.fn((alpha: number) => ({ alpha })) },
      fromCssColorString,
    },
    Ellipsoid: { WGS84: { maximumRadius: 6_378_137 } },
    FeatureDetection: { supportsWebgl2: vi.fn(() => supportsLabels) },
    HeightReference: { CLAMP_TO_GROUND: "ground" },
    HorizontalOrigin: { LEFT: "left" },
    LabelStyle: { FILL_AND_OUTLINE: "fill-and-outline" },
    LinearApproximation: "linear",
    NearFarScalar: class {
      constructor(
        readonly near: number,
        readonly nearValue: number,
        readonly far: number,
        readonly farValue: number,
      ) {}
    },
    JulianDate: { fromDate: vi.fn((date: Date) => date) },
    SampledPositionProperty: class {
      addSample(...arguments_: unknown[]) {
        addSample(...arguments_);
      }
      setInterpolationOptions(...arguments_: unknown[]) {
        setInterpolationOptions(...arguments_);
      }
    },
    VerticalOrigin: { CENTER: "center" },
  };
  runtimeMocks.load.mockResolvedValue(runtime);
  runtimeMocks.createViewer.mockReturnValue(viewer);
  return {
    add,
    destroy,
    fromElements,
    fromCssColorString,
    removeAll,
    requestRender,
  };
}

describe("SatelliteSwarmGlobe", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders nodes, the selected orbit, and the mission objective", async () => {
    const harness = createHarness();
    const onFailure = vi.fn();
    const { rerender, unmount } = render(
      <SatelliteSwarmGlobe
        currentFrameIndex={0}
        data={data}
        onFailure={onFailure}
        selectedNodeId={0}
      />,
    );

    await waitFor(() => expect(harness.requestRender).toHaveBeenCalledTimes(2));
    expect(harness.add).toHaveBeenCalledTimes(4);
    expect(harness.add.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        id: "node-0",
        label: expect.objectContaining({ text: "Node 0" }),
      }),
    );
    expect(harness.add.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ polyline: expect.any(Object) }),
    );
    expect(harness.add.mock.calls[3]?.[0]).toEqual(
      expect.objectContaining({
        label: expect.objectContaining({ text: "South Pole objective" }),
        position: [4, -90],
      }),
    );

    rerender(
      <SatelliteSwarmGlobe
        currentFrameIndex={1}
        data={data}
        onFailure={onFailure}
        selectedNodeId={0}
      />,
    );

    await waitFor(() => expect(harness.requestRender).toHaveBeenCalledTimes(3));
    expect(harness.removeAll).toHaveBeenCalledOnce();
    expect(harness.fromElements).toHaveBeenCalled();
    expect(harness.add).toHaveBeenCalledTimes(4);

    rerender(
      <SatelliteSwarmGlobe
        currentFrameIndex={1}
        data={data}
        onFailure={onFailure}
        selectedNodeId={1}
      />,
    );

    await waitFor(() => expect(harness.removeAll).toHaveBeenCalledTimes(2));
    expect(harness.add).toHaveBeenCalledTimes(8);
    expect(harness.fromCssColorString).toHaveBeenCalledWith("#38bdf8");

    unmount();
    expect(harness.destroy).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("omits labels when WebGL 2 is unavailable", async () => {
    const harness = createHarness(false);
    render(
      <SatelliteSwarmGlobe
        currentFrameIndex={0}
        data={data}
        onFailure={vi.fn()}
        selectedNodeId={0}
      />,
    );

    await waitFor(() => expect(harness.requestRender).toHaveBeenCalledTimes(2));
    expect(harness.add.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ label: undefined }),
    );
  });

  it("reports runtime startup failures", async () => {
    const error = new Error("runtime unavailable");
    runtimeMocks.load.mockRejectedValue(error);
    const onFailure = vi.fn();

    render(
      <SatelliteSwarmGlobe
        currentFrameIndex={0}
        data={data}
        onFailure={onFailure}
        selectedNodeId={0}
      />,
    );

    await waitFor(() => expect(onFailure).toHaveBeenCalledWith(error));
    expect(runtimeMocks.createViewer).not.toHaveBeenCalled();
  });
});

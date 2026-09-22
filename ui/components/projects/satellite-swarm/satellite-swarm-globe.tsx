"use client";

import type { Cartesian3, Viewer } from "cesium";
import { useEffect, useRef, useState } from "react";
import {
  type CesiumRuntime,
  loadCesiumRuntime,
} from "@/components/technology/cesium/cesium-runtime";
import { createOfflineCesiumViewer } from "@/components/technology/cesium/offline-viewer";
import type {
  SatelliteSwarmEvent,
  SatelliteSwarmFrame,
  SatelliteSwarmSimulation,
} from "@/lib/api/satellite-swarm-simulation";

const STATE_COLOR_VALUES: Record<string, string> = {
  active: "#22c55e",
  "awaiting acknowledgement": "#f59e0b",
  "awaiting assignment": "#eab308",
  idle: "#94a3b8",
  leading: "#38bdf8",
  quiescent: "#a78bfa",
  "safe-disabled": "#ef4444",
};

function altitude(
  frame: SatelliteSwarmFrame,
  nodeId: number,
  earthRadiusMetres: number,
): number {
  const node = frame.nodes.find((candidate) => candidate.id === nodeId);
  return Math.max(
    100_000,
    (node?.orbitalRadiusMetres ?? 0) - earthRadiusMetres,
  );
}

function position(
  cesium: CesiumRuntime,
  frame: SatelliteSwarmFrame,
  nodeId: number,
): Cartesian3 | null {
  const node = frame.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  return cesium.Cartesian3.fromElements(
    node.earthFixedPositionMetres.x,
    node.earthFixedPositionMetres.y,
    node.earthFixedPositionMetres.z,
  );
}

function addMessageLinks(
  cesium: CesiumRuntime,
  viewer: Viewer,
  frame: SatelliteSwarmFrame,
  events: readonly SatelliteSwarmEvent[],
  earthRadiusMetres: number,
) {
  const { ArcType, Cartesian3, Color } = cesium;
  for (const event of events) {
    if (event.type !== "message-sent") continue;
    const sender = position(cesium, frame, event.nodeId);
    if (!sender) continue;
    const targets =
      event.message.target === null
        ? frame.nodes
            .filter((node) => node.id !== event.nodeId)
            .map((node) => node.id)
        : [event.message.target];

    for (const targetId of targets) {
      const target = position(cesium, frame, targetId);
      const targetNode = frame.nodes.find((node) => node.id === targetId);
      const senderNode = frame.nodes.find((node) => node.id === event.nodeId);
      if (!target || !targetNode || !senderNode) continue;
      const middle = Cartesian3.fromDegrees(
        (senderNode.position.longitudeDegrees +
          targetNode.position.longitudeDegrees) /
          2,
        (senderNode.position.latitudeDegrees +
          targetNode.position.latitudeDegrees) /
          2,
        Math.max(
          altitude(frame, event.nodeId, earthRadiusMetres),
          altitude(frame, targetId, earthRadiusMetres),
        ) + 350_000,
      );
      viewer.entities.add({
        polyline: {
          arcType: ArcType.NONE,
          material: Color.WHITE.withAlpha(0.72),
          positions: [sender, middle, target],
          width: 2,
        },
      });
    }
  }
}

function trackPositions(
  cesium: CesiumRuntime,
  data: SatelliteSwarmSimulation,
  currentFrameIndex: number,
  nodeId: number,
): Cartesian3[] {
  return data.frames.slice(0, currentFrameIndex + 1).flatMap((frame) => {
    const node = frame.nodes.find((candidate) => candidate.id === nodeId);
    return node
      ? [
          cesium.Cartesian3.fromElements(
            node.earthFixedPositionMetres.x,
            node.earthFixedPositionMetres.y,
            node.earthFixedPositionMetres.z,
          ),
        ]
      : [];
  });
}

function sampledPosition(
  cesium: CesiumRuntime,
  data: SatelliteSwarmSimulation,
  nodeId: number,
) {
  const property = new cesium.SampledPositionProperty();
  for (const frame of data.frames) {
    const node = frame.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) continue;
    property.addSample(
      cesium.JulianDate.fromDate(new Date(node.epochUnixMilliseconds)),
      cesium.Cartesian3.fromElements(
        node.earthFixedPositionMetres.x,
        node.earthFixedPositionMetres.y,
        node.earthFixedPositionMetres.z,
      ),
    );
  }
  property.setInterpolationOptions({
    interpolationAlgorithm: cesium.LinearApproximation,
    interpolationDegree: 1,
  });
  return property;
}

interface FrameRenderContext {
  cesium: CesiumRuntime;
  currentFrameIndex: number;
  data: SatelliteSwarmSimulation;
  earthRadiusMetres: number;
  selectedNodeId: number;
  supportsLabels: boolean;
  viewer: Viewer;
}

function addFrameNode(
  context: FrameRenderContext,
  node: SatelliteSwarmFrame["nodes"][number],
) {
  const {
    cesium,
    currentFrameIndex,
    data,
    selectedNodeId,
    supportsLabels,
    viewer,
  } = context;
  const {
    Cartesian2,
    Color,
    HorizontalOrigin,
    LabelStyle,
    NearFarScalar,
    VerticalOrigin,
  } = cesium;
  const nodeColor = Color.fromCssColorString(
    STATE_COLOR_VALUES[node.state] ?? "#ffffff",
  );
  const selected = node.id === selectedNodeId;
  viewer.entities.add({
    id: `node-${node.id}`,
    label: supportsLabels
      ? {
          distanceDisplayCondition: undefined,
          fillColor: Color.WHITE,
          font: selected ? "600 16px sans-serif" : "500 14px sans-serif",
          horizontalOrigin: HorizontalOrigin.LEFT,
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          pixelOffset: new Cartesian2(14, 0),
          scaleByDistance: new NearFarScalar(1_000_000, 1, 30_000_000, 0.7),
          style: LabelStyle.FILL_AND_OUTLINE,
          text: `Node ${node.id} · ${node.state}`,
          verticalOrigin: VerticalOrigin.CENTER,
        }
      : undefined,
    point: {
      color: nodeColor,
      outlineColor: selected ? Color.WHITE : Color.BLACK,
      outlineWidth: selected ? 3 : 1,
      pixelSize: selected ? 15 : 11,
    },
    position: sampledPosition(cesium, data, node.id),
  });

  const positions = trackPositions(cesium, data, currentFrameIndex, node.id);
  if (positions.length < 2) return;
  viewer.entities.add({
    polyline: {
      material: nodeColor.withAlpha(0.55),
      positions,
      width: selected ? 3 : 1.5,
    },
  });
}

function addMissionObjective(
  cesium: CesiumRuntime,
  viewer: Viewer,
  data: SatelliteSwarmSimulation,
  supportsLabels: boolean,
) {
  const { Cartesian2, Cartesian3, Color, HeightReference, LabelStyle } = cesium;
  viewer.entities.add({
    ellipse: {
      height: 0,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      material: Color.fromCssColorString("#f43f5e").withAlpha(0.32),
      outline: true,
      outlineColor: Color.fromCssColorString("#fb7185"),
      semiMajorAxis: 250_000,
      semiMinorAxis: 250_000,
    },
    label: supportsLabels
      ? {
          fillColor: Color.WHITE,
          font: "600 14px sans-serif",
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          pixelOffset: new Cartesian2(0, -22),
          style: LabelStyle.FILL_AND_OUTLINE,
          text:
            data.objective.latitudeDegrees === -90
              ? "South Pole objective"
              : "Mission objective",
        }
      : undefined,
    position: Cartesian3.fromDegrees(
      data.objective.longitudeDegrees,
      data.objective.latitudeDegrees,
    ),
  });
}

function renderFrame(
  cesium: CesiumRuntime,
  viewer: Viewer,
  {
    currentFrameIndex,
    data,
    events,
    frame,
    playing,
    selectedNodeId,
  }: {
    currentFrameIndex: number;
    data: SatelliteSwarmSimulation;
    events: readonly SatelliteSwarmEvent[];
    frame: SatelliteSwarmFrame;
    playing: boolean;
    selectedNodeId: number;
  },
) {
  const earthRadiusMetres = cesium.Ellipsoid.WGS84.maximumRadius;
  const supportsLabels = cesium.FeatureDetection.supportsWebgl2(viewer.scene);
  const context = {
    cesium,
    currentFrameIndex,
    data,
    earthRadiusMetres,
    selectedNodeId,
    supportsLabels,
    viewer,
  };

  viewer.entities.removeAll();
  const epoch = frame.nodes[0]?.epochUnixMilliseconds;
  if (epoch !== undefined) {
    viewer.clock.currentTime = cesium.JulianDate.fromDate(new Date(epoch));
    viewer.clock.multiplier = frame.playbackMultiplier;
    viewer.clock.shouldAnimate = playing;
  }
  for (const node of frame.nodes) {
    addFrameNode(context, node);
  }
  addMissionObjective(cesium, viewer, data, supportsLabels);
  addMessageLinks(cesium, viewer, frame, events, earthRadiusMetres);
  viewer.scene.requestRender();
}

export interface SatelliteSwarmGlobeProps {
  currentFrameIndex: number;
  data: SatelliteSwarmSimulation;
  events: readonly SatelliteSwarmEvent[];
  onFailure: (error: unknown) => void;
  playing?: boolean;
  selectedNodeId: number;
}

export function SatelliteSwarmGlobe({
  currentFrameIndex,
  data,
  events,
  onFailure,
  playing = false,
  selectedNodeId,
}: Readonly<SatelliteSwarmGlobeProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const cesiumRef = useRef<CesiumRuntime | null>(null);
  const [viewerReady, setViewerReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let active = true;
    let viewer: Viewer | undefined;
    loadCesiumRuntime()
      .then((cesium) => {
        if (!active) return;
        viewer = createOfflineCesiumViewer(container, cesium);
        cesiumRef.current = cesium;
        viewerRef.current = viewer;
        setViewerReady(true);
      })
      .catch((error: unknown) => {
        if (active) onFailure(error);
      });

    return () => {
      active = false;
      cesiumRef.current = null;
      viewerRef.current = null;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, [onFailure]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const cesium = cesiumRef.current;
    const frame = data.frames[currentFrameIndex];
    if (!viewerReady || !viewer || !cesium || !frame) return;
    renderFrame(cesium, viewer, {
      currentFrameIndex,
      data,
      events,
      frame,
      playing,
      selectedNodeId,
    });
  }, [currentFrameIndex, data, events, playing, selectedNodeId, viewerReady]);

  return (
    <div ref={containerRef} className="h-full w-full" aria-hidden="true" />
  );
}

"use client";

import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  describeSatelliteSwarmEvent,
  type SatelliteSwarmSimulation as SimulationData,
} from "@/lib/api/satellite-swarm-simulation";
import { LazySatelliteSwarmGlobe } from "./lazy-satellite-swarm-globe";

const SOURCE_REPOSITORY_URL = "https://github.com/Robbie-Palmer/hq/commit";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

export interface SatelliteSwarmSimulationProps {
  data: SimulationData;
  executionMode?: "recorded" | "webassembly";
  missionControls?: ReactNode;
  startPlaying?: boolean;
}

function getReplayAction(playing: boolean, frameIndex: number, stopAt: number) {
  if (playing) return { accessibleName: "Pause replay", label: "Pause" };
  if (frameIndex >= stopAt) {
    return { accessibleName: "Replay mission", label: "Replay" };
  }
  if (frameIndex > 0) {
    return { accessibleName: "Resume replay", label: "Resume" };
  }
  return { accessibleName: "Play replay", label: "Play" };
}

export function SatelliteSwarmSimulation({
  data,
  executionMode = "recorded",
  missionControls,
  startPlaying = false,
}: Readonly<SatelliteSwarmSimulationProps>) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(startPlaying);
  const [selectedNodeId, setSelectedNodeId] = useState(0);
  const [startupFailure, setStartupFailure] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const frame = data.frames[frameIndex] ?? data.frames[0];
  const visibleEvents = useMemo(
    () => data.events.filter((event) => event.timeMs <= (frame?.timeMs ?? 0)),
    [data.events, frame?.timeMs],
  );
  const currentEvents = useMemo(
    () => data.events.filter((event) => event.timeMs === (frame?.timeMs ?? 0)),
    [data.events, frame?.timeMs],
  );
  const stopAt = data.frames.length - 1;
  const isSouthPoleMission = data.objective.latitudeDegrees === -90;
  const hasLostAssignment = data.scenario === "three-node-assignment-loss";
  const replayAction = getReplayAction(playing, frameIndex, stopAt);

  useEffect(() => {
    if (reducedMotion) {
      setPlaying(false);
      return;
    }
    if (!playing) return;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => {
        if (current >= stopAt) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [playing, reducedMotion, stopAt]);

  const reportStartupFailure = useCallback((error: unknown) => {
    setStartupFailure(
      error instanceof Error && error.message
        ? error.message
        : "Cesium reported an unknown startup error",
    );
  }, []);
  if (!frame) return null;

  return (
    <Card className="not-prose my-8 gap-0 overflow-hidden p-0">
      <link rel="stylesheet" href="/cesium/Widgets/widgets.css" />
      <div className="space-y-1 border-b p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">
            {isSouthPoleMission
              ? "South Pole mission replay"
              : "Three-node mission replay"}
          </h3>
          <span className="rounded-full border bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
            trace v{data.traceVersion} · {frame.timeMs} ms
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          The portable C++ trace runner produced these states, scores, messages,
          bounded telemetry, and positions. Cesium draws the result but does not
          calculate it.
          {isSouthPoleMission &&
            " The exact pole is a deliberate coordinate edge case."}
          {hasLostAssignment &&
            " The fault schedule drops the winning assignment before node 1 receives it."}
        </p>
        {missionControls}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,1fr)]">
        <div className="min-w-0 border-b lg:border-r lg:border-b-0">
          <div className="h-[25rem] bg-zinc-950 sm:h-[32rem]">
            {startupFailure ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-sm text-zinc-300">
                <p>
                  The 3D globe could not start in this browser. The state table
                  and event log contain the same simulation record.
                </p>
                <p className="max-w-xl font-mono text-xs text-zinc-400">
                  Diagnostic: {startupFailure}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setStartupFailure(null)}
                >
                  Retry globe
                </Button>
              </div>
            ) : (
              <LazySatelliteSwarmGlobe
                currentFrameIndex={frameIndex}
                data={data}
                events={currentEvents}
                onFailure={reportStartupFailure}
                selectedNodeId={selectedNodeId}
              />
            )}
          </div>

          <div className="space-y-3 border-t bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Restart replay"
                onClick={() => {
                  setFrameIndex(0);
                  setPlaying(false);
                }}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Previous frame"
                disabled={frameIndex === 0}
                onClick={() => {
                  setPlaying(false);
                  setFrameIndex((current) => Math.max(0, current - 1));
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                aria-label={replayAction.accessibleName}
                disabled={reducedMotion}
                onClick={() => {
                  if (frameIndex >= stopAt) setFrameIndex(0);
                  setPlaying((current) => !current);
                }}
              >
                {playing ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                <span className="ml-2">{replayAction.label}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Next frame"
                disabled={frameIndex >= stopAt}
                onClick={() => {
                  setPlaying(false);
                  setFrameIndex((current) => Math.min(stopAt, current + 1));
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <label className="sr-only" htmlFor="satellite-swarm-frame">
                Replay frame
              </label>
              <input
                id="satellite-swarm-frame"
                type="range"
                min={0}
                max={stopAt}
                value={frameIndex}
                onChange={(event) => {
                  setPlaying(false);
                  setFrameIndex(Number(event.target.value));
                }}
                className="min-w-0 flex-1 accent-primary"
              />
            </div>
            {reducedMotion && (
              <p className="text-xs text-muted-foreground">
                Autoplay is off because this device requests reduced motion. Use
                the frame controls to inspect the replay.
              </p>
            )}
          </div>
        </div>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <section
            className="border-b p-4"
            aria-labelledby="swarm-state-heading"
          >
            <h4 id="swarm-state-heading" className="mb-3 text-sm font-semibold">
              Node state
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Node</th>
                    <th className="pb-2 font-medium">State</th>
                    <th className="pb-2 text-right font-medium">Score</th>
                    <th className="pb-2 text-right font-medium">Assigned</th>
                    <th className="pb-2 text-right font-medium">Drops</th>
                  </tr>
                </thead>
                <tbody>
                  {frame.nodes.map((node) => (
                    <tr key={node.id} className="border-t">
                      <td className="py-2">
                        <button
                          type="button"
                          className="font-medium underline-offset-4 hover:underline"
                          aria-pressed={node.id === selectedNodeId}
                          onClick={() => setSelectedNodeId(node.id)}
                        >
                          Node {node.id}
                        </button>
                      </td>
                      <td className="py-2 pr-2">{node.state}</td>
                      <td className="py-2 text-right tabular-nums">
                        {node.candidacyScore}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {node.assignedNode === null
                          ? "None"
                          : `Node ${node.assignedNode}`}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {node.telemetryDrops}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section
            className="min-h-0 p-4"
            aria-labelledby="swarm-events-heading"
          >
            <h4
              id="swarm-events-heading"
              className="mb-3 text-sm font-semibold"
            >
              Event log
            </h4>
            <ol
              className="max-h-[22rem] space-y-2 overflow-y-auto pr-1 text-xs lg:max-h-[25rem]"
              aria-live="polite"
            >
              {visibleEvents.map((event, index) => (
                <li
                  key={`${event.timeMs}-${event.type}-${event.nodeId}-${index}`}
                  className="grid grid-cols-[3rem_1fr] gap-2"
                >
                  <span className="font-mono text-muted-foreground tabular-nums">
                    {event.timeMs} ms
                  </span>
                  <span>{describeSatelliteSwarmEvent(event)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      <div className="border-t bg-amber-500/5 px-4 py-3 text-xs text-muted-foreground">
        {data.positionModel}. The score is the preserved historical heuristic,
        not validated astrodynamics. "Safe-disabled" is software state, not a
        physical deorbit action. Wasm source:{" "}
        <a
          className="font-mono underline underline-offset-4"
          href={`${SOURCE_REPOSITORY_URL}/${data.sourceRevision}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {data.sourceRevision.slice(0, 12)}
        </a>
        .{" "}
        {executionMode === "webassembly"
          ? "The coordination code ran as WebAssembly in a module worker."
          : "This view displays a recorded output from the native runner."}
      </div>
    </Card>
  );
}

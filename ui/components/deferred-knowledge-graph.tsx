"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import type { GraphData } from "@/lib/api/graph-data";
import { LazyKnowledgeGraph } from "./technology/lazy-knowledge-graph";

function GraphPlaceholder({ failed }: Readonly<{ failed: boolean }>) {
  return (
    <Card className="gap-0 overflow-hidden p-0" aria-live="polite">
      <div className="space-y-1 p-4 pb-3">
        <h3 className="text-lg font-semibold">Knowledge graph</h3>
        <p className="text-sm text-muted-foreground">
          Explore projects, research papers, decisions, writing, roles, and the
          technology connecting them.
        </p>
      </div>
      <div className="flex h-[22rem] items-center justify-center border-y bg-muted/10 p-6 text-center sm:h-[min(68vh,680px)] sm:min-h-[520px]">
        <p className="text-sm text-muted-foreground">
          {failed
            ? "The graph could not be loaded. Refresh the page to try again."
            : "Loading graph..."}
        </p>
      </div>
    </Card>
  );
}

export function DeferredKnowledgeGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let active = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        fetch("/knowledge-graph.json")
          .then((response) => {
            if (!response.ok) throw new Error("Knowledge graph request failed");
            return response.json() as Promise<GraphData>;
          })
          .then((graphData) => active && setData(graphData))
          .catch(() => active && setFailed(true));
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(container);

    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} aria-busy={!data && !failed}>
      {data ? (
        <LazyKnowledgeGraph data={data} />
      ) : (
        <GraphPlaceholder failed={failed} />
      )}
    </div>
  );
}

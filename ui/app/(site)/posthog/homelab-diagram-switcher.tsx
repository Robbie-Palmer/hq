"use client";

import { useId, useState } from "react";
import { Mermaid } from "@/components/mermaid";
import { cn } from "@/lib/generic/styles";
import styles from "./posthog.module.css";

interface Diagram {
  alt: string;
  chart: string;
  id: "physical" | "services";
  label: string;
  dense?: boolean;
}

interface HomelabDiagramSwitcherProps {
  detailAlt: string;
  detailChart: string;
  detailChartTitle: string;
  overviewAlt: string;
  overviewChart: string;
  overviewChartTitle: string;
}

export function HomelabDiagramSwitcher({
  detailAlt,
  detailChart,
  detailChartTitle,
  overviewAlt,
  overviewChart,
  overviewChartTitle,
}: Readonly<HomelabDiagramSwitcherProps>) {
  const [activeId, setActiveId] = useState<Diagram["id"]>("physical");
  const instanceId = useId();
  const overviewDiagram: Diagram = {
    id: "physical",
    label: overviewChartTitle,
    chart: overviewChart,
    alt: overviewAlt,
  };
  const servicesDiagram: Diagram = {
    id: "services",
    label: detailChartTitle,
    chart: detailChart,
    alt: detailAlt,
    dense: true,
  };
  const diagrams = [overviewDiagram, servicesDiagram] as const;
  return (
    <div className={styles.artefactDiagram}>
      <div
        aria-label="Home lab diagram level"
        className={styles.artefactDiagramTabs}
        role="tablist"
      >
        {diagrams.map((diagram) => (
          <button
            aria-controls={`${instanceId}-${diagram.id}-panel`}
            aria-selected={diagram.id === activeId}
            className={styles.artefactDiagramTab}
            id={`${instanceId}-${diagram.id}-tab`}
            key={diagram.id}
            onClick={() => setActiveId(diagram.id)}
            role="tab"
            type="button"
          >
            {diagram.label}
          </button>
        ))}
      </div>
      {diagrams.map((diagram) => (
        <div
          aria-labelledby={`${instanceId}-${diagram.id}-tab`}
          className={styles.artefactDiagramBlock}
          hidden={diagram.id !== activeId}
          id={`${instanceId}-${diagram.id}-panel`}
          key={diagram.id}
          role="tabpanel"
        >
          <div
            aria-label={diagram.alt}
            className={cn(
              styles.artefactDiagramViewport,
              diagram.dense && styles.artefactDiagramViewportDense,
            )}
            role="img"
          >
            <Mermaid chart={diagram.chart} className="w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

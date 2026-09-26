"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

interface MermaidProps {
  chart: string;
  className?: string;
}

function baseThemeVariables(isDark: boolean) {
  return {
    darkMode: isDark,
    background: isDark ? "#0a0a0a" : "#ffffff",
    primaryColor: isDark ? "#3b82f6" : "#dbeafe",
    primaryTextColor: isDark ? "#f9fafb" : "#1e3a5f",
    primaryBorderColor: isDark ? "#60a5fa" : "#3b82f6",
    secondaryColor: isDark ? "#4c1d95" : "#ede9fe",
    secondaryTextColor: isDark ? "#f9fafb" : "#4c1d95",
    secondaryBorderColor: isDark ? "#8b5cf6" : "#7c3aed",
    tertiaryColor: isDark ? "#065f46" : "#d1fae5",
    tertiaryTextColor: isDark ? "#f9fafb" : "#065f46",
    tertiaryBorderColor: isDark ? "#10b981" : "#059669",
  };
}

function flowThemeVariables(isDark: boolean) {
  return {
    textColor: isDark ? "#e5e7eb" : "#1f2937",
    lineColor: isDark ? "#6b7280" : "#9ca3af",
    nodeBkg: isDark ? "#1e3a5f" : "#dbeafe",
    nodeBorder: isDark ? "#60a5fa" : "#3b82f6",
    nodeTextColor: isDark ? "#f9fafb" : "#1e3a5f",
    mainBkg: isDark ? "#1f2937" : "#f9fafb",
    clusterBkg: isDark ? "#1f2937" : "#f3f4f6",
    clusterBorder: isDark ? "#374151" : "#d1d5db",
    edgeLabelBackground: isDark ? "#1f2937" : "#f9fafb",
  };
}

function sequenceThemeVariables(isDark: boolean) {
  return {
    actorBkg: isDark ? "#1e3a5f" : "#dbeafe",
    actorBorder: isDark ? "#60a5fa" : "#3b82f6",
    actorTextColor: isDark ? "#f9fafb" : "#1e3a5f",
    signalColor: isDark ? "#e5e7eb" : "#1f2937",
    signalTextColor: isDark ? "#e5e7eb" : "#1f2937",
    activationBkgColor: isDark ? "#374151" : "#e5e7eb",
    activationBorderColor: isDark ? "#6b7280" : "#9ca3af",
    labelColor: isDark ? "#e5e7eb" : "#1f2937",
    altBackground: isDark ? "#374151" : "#f3f4f6",
    fontSize: "16px",
  };
}

function initializeMermaid(
  mermaid: typeof import("mermaid").default,
  isDark: boolean,
): void {
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      ...baseThemeVariables(isDark),
      ...flowThemeVariables(isDark),
      ...sequenceThemeVariables(isDark),
    },
    flowchart: { htmlLabels: true, curve: "basis", padding: 15 },
  });
}

function activeContainer(
  isCancelled: boolean,
  container: HTMLDivElement | null,
): HTMLDivElement | null {
  return isCancelled ? null : container;
}

function showRenderError(container: HTMLDivElement, error: unknown): void {
  container.textContent = "";
  const errorElement = document.createElement("pre");
  errorElement.className = "text-red-500";
  errorElement.textContent = `Error rendering diagram: ${error}`;
  container.appendChild(errorElement);
}

function handleRenderError(
  isCancelled: boolean,
  container: HTMLDivElement | null,
  error: unknown,
): void {
  console.error("Error rendering mermaid diagram:", error);
  const active = activeContainer(isCancelled, container);
  if (active) showRenderError(active, error);
}

export function Mermaid({ chart, className = "" }: Readonly<MermaidProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    let isCancelled = false;

    const renderDiagram = async () => {
      try {
        let container = activeContainer(isCancelled, containerRef.current);
        if (!container) return;

        const { default: mermaid } = await import("mermaid");
        container = activeContainer(isCancelled, containerRef.current);
        if (!container) return;

        initializeMermaid(mermaid, resolvedTheme === "dark");

        container.innerHTML = "";

        // Generate unique ID for this diagram
        const id = `mermaid-${crypto.randomUUID()}`;
        const { svg } = await mermaid.render(id, chart);

        // Check again after async operation completes
        container = activeContainer(isCancelled, containerRef.current);
        if (!container) return;

        container.innerHTML = svg;
      } catch (error) {
        handleRenderError(isCancelled, containerRef.current, error);
      }
    };

    renderDiagram();

    return () => {
      isCancelled = true;
    };
  }, [chart, resolvedTheme, mounted]);

  // Prevent hydration mismatch by not rendering anything server-side
  if (!mounted) {
    return (
      <div
        className={`flex items-center justify-center p-8 ${className}`}
        style={{ minHeight: "200px" }}
      >
        <div className="text-muted-foreground">Loading diagram...</div>
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className={`mermaid-diagram flex items-center justify-center ${className}`}
      style={{ minHeight: "200px" }}
    />
  );
}

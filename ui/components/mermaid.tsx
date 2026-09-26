"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

interface MermaidProps {
  chart: string;
  className?: string;
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

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
    const renderDiagram = async () => {
      try {
        if (isCancelled || !containerRef.current) return;

        const { default: mermaid } = await import("mermaid");
        if (isCancelled || !containerRef.current) return;

        const isDark = resolvedTheme === "dark";
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            // Base colors
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
            // Text and lines
            textColor: isDark ? "#e5e7eb" : "#1f2937",
            lineColor: isDark ? "#6b7280" : "#9ca3af",
            // Flowchart
            nodeBkg: isDark ? "#1e3a5f" : "#dbeafe",
            nodeBorder: isDark ? "#60a5fa" : "#3b82f6",
            nodeTextColor: isDark ? "#f9fafb" : "#1e3a5f",
            mainBkg: isDark ? "#1f2937" : "#f9fafb",
            clusterBkg: isDark ? "#1f2937" : "#f3f4f6",
            clusterBorder: isDark ? "#374151" : "#d1d5db",
            edgeLabelBackground: isDark ? "#1f2937" : "#f9fafb",
            // Sequence diagram
            actorBkg: isDark ? "#1e3a5f" : "#dbeafe",
            actorBorder: isDark ? "#60a5fa" : "#3b82f6",
            actorTextColor: isDark ? "#f9fafb" : "#1e3a5f",
            signalColor: isDark ? "#e5e7eb" : "#1f2937",
            signalTextColor: isDark ? "#e5e7eb" : "#1f2937",
            activationBkgColor: isDark ? "#374151" : "#e5e7eb",
            activationBorderColor: isDark ? "#6b7280" : "#9ca3af",
            // State diagram
            labelColor: isDark ? "#e5e7eb" : "#1f2937",
            altBackground: isDark ? "#374151" : "#f3f4f6",
            // Font
            fontSize: "16px",
          },
          flowchart: {
            htmlLabels: true,
            curve: "basis",
            padding: 15,
          },
        });

        containerRef.current.innerHTML = "";

        // Generate unique ID for this diagram
        const id = `mermaid-${crypto.randomUUID()}`;
        const { svg } = await mermaid.render(id, chart);

        // Check again after async operation completes
        if (isCancelled || !containerRef.current) return;

        containerRef.current.innerHTML = svg;
      } catch (error) {
        console.error("Error rendering mermaid diagram:", error);
        if (!isCancelled && containerRef.current) {
          // Clear container safely
          containerRef.current.textContent = "";

          // Create error element with safe text content
          const errorElement = document.createElement("pre");
          errorElement.className = "text-red-500";
          errorElement.textContent = `Error rendering diagram: ${error}`;

          containerRef.current.appendChild(errorElement);
        }
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

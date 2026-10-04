import { describe, expect, it } from "vitest";
import {
  type FunctionMetrics,
  findReactComponentHotspots,
  formatHotspotReport,
  type MetricsReport,
  runAudit,
} from "@/scripts/audit-react-components";

function metrics(
  name: string,
  overrides: Partial<FunctionMetrics> = {},
): FunctionMetrics {
  return {
    component_responsibility: 1,
    line: 10,
    loc: 20,
    max_nesting: 1,
    name,
    render_complexity: 1,
    ...overrides,
  };
}

function report(functions: FunctionMetrics[]): MetricsReport {
  return { files: [{ path: "components/example.tsx", functions }] };
}

describe("React component hotspot audit", () => {
  it("filters non-components and components below every limit", () => {
    expect(
      findReactComponentHotspots(
        report([
          metrics("helper", { loc: 200 }),
          metrics("NoJsx", { component_responsibility: 0, loc: 200 }),
          metrics("SmallComponent"),
        ]),
      ),
    ).toEqual([]);
  });

  it("records every breached limit and ranks responsibility first", () => {
    const findings = findReactComponentHotspots(
      report([
        metrics("LargeRender", {
          loc: 60,
          max_nesting: 4,
          render_complexity: 10,
        }),
        metrics("Overburdened", { component_responsibility: 40 }),
      ]),
    );

    expect(findings.map((finding) => finding.name)).toEqual([
      "Overburdened",
      "LargeRender",
    ]);
    expect(findings[1]?.reasons).toEqual([
      "60 lines (limit 60)",
      "nesting 4 (limit 4)",
      "render complexity 10 (limit 10)",
    ]);
  });

  it("formats a bounded report", () => {
    const findings = findReactComponentHotspots(
      report([metrics("First", { loc: 80 }), metrics("Second", { loc: 70 })]),
    );

    expect(formatHotspotReport(findings, 1)).toEqual([
      "tsmetrics found 2 React component hotspots; showing the highest 1.",
      "components/example.tsx:10 First: 80 lines (limit 60)",
      "This report is advisory while the existing hotspot backlog is reduced; new repeated JSX is enforced separately.",
    ]);
  });

  it("writes a successful analysis report", () => {
    const lines: string[] = [];

    expect(
      runAudit(
        () => ({
          status: 0,
          stderr: "",
          stdout: JSON.stringify(report([metrics("Large", { loc: 80 })])),
        }),
        (line) => lines.push(line),
      ),
    ).toBe(0);
    expect(lines[1]).toContain("Large: 80 lines");
  });

  it("returns analyzer failures and preserves stderr", () => {
    const errors: string[] = [];

    expect(
      runAudit(
        () => ({ status: 2, stderr: "invalid config", stdout: "" }),
        () => undefined,
        (message) => errors.push(message),
      ),
    ).toBe(2);
    expect(errors).toEqual(["invalid config"]);
  });

  it("throws analyzer startup errors", () => {
    expect(() =>
      runAudit(() => ({
        error: new Error("missing binary"),
        status: null,
        stderr: "",
        stdout: "",
      })),
    ).toThrow("missing binary");
  });
});

import { describe, expect, it } from "vitest";
import {
  getProductDecision,
  getProductDecisionsForProject,
} from "@/lib/api/product-decisions";
import { productDecisionPath } from "@/lib/domain/product-decision";

const slug = "001-project-operational-evidence";
const owner = "personal-engineering-platform";

describe("project-owned product decisions", () => {
  it("resolves the owner separately from affected projects", () => {
    const decision = getProductDecision(`${owner}:${slug}`);
    expect(decision?.projectTitle).toBe("Personal Engineering Platform");
    expect(decision?.backlinks.projects.map((project) => project.slug)).toEqual(
      [owner, "personal-knowledge-graph"],
    );
    expect(
      getProductDecisionsForProject(owner).map((record) => record.slug),
    ).toContain(slug);
    expect(getProductDecisionsForProject("personal-knowledge-graph")).toEqual(
      [],
    );
  });

  it("rejects unqualified and wrong-owner references", () => {
    expect(getProductDecision(slug)).toBeNull();
    expect(getProductDecision(`personal-knowledge-graph:${slug}`)).toBeNull();
    expect(getProductDecisionsForProject("missing-project")).toEqual([]);
  });

  it("builds canonical project paths and rejects unsafe references", () => {
    expect(productDecisionPath(`${owner}:${slug}`)).toBe(
      `/projects/${owner}/pdrs/${slug}`,
    );
    expect(() => productDecisionPath(`../private:${slug}`)).toThrow();
    expect(() => productDecisionPath(slug)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import type { DomainRepository } from "@/lib/domain";
import {
  getAllProductDecisions,
  getProductDecision,
  getProductDecisionBacklinks,
} from "@/lib/domain/product-decision";
import { buildContentGraph, createEmptyRelationData } from "@/lib/repository";

function makeRepository(): DomainRepository {
  const firstDecision = {
    slug: "001-first-decision",
    title: "PDR 001: First decision",
  };
  const secondDecision = {
    slug: "002-second-decision",
    title: "PDR 002: Second decision",
  };
  const project = { slug: "project-one", title: "Project One" };
  const idea = { slug: "clear-policy", title: "Clear policy" };
  const informedByADR = {
    adrRef: "project-one:001-context",
    slug: "001-context",
    title: "ADR 001: Context",
  };
  const implementingADR = {
    adrRef: "project-one:002-implementation",
    slug: "002-implementation",
    title: "ADR 002: Implementation",
  };
  const blog = { slug: "policy-explained", title: "Policy explained" };
  const relations = createEmptyRelationData();
  relations.productDecisionAffectedProjects.set(secondDecision.slug, [
    project.slug,
    "missing-project",
  ]);
  relations.productDecisionIdeas.set(secondDecision.slug, [
    idea.slug,
    "missing-idea",
  ]);
  relations.productDecisionInformedByADRs.set(secondDecision.slug, [
    informedByADR.adrRef,
    "project-one:missing",
  ]);
  relations.adrImplementsProductDecisions.set(implementingADR.adrRef, [
    secondDecision.slug,
  ]);
  relations.adrImplementsProductDecisions.set("project-one:missing", [
    secondDecision.slug,
  ]);
  relations.blogProductDecisions.set(blog.slug, [secondDecision.slug]);
  relations.blogProductDecisions.set("missing-blog", [secondDecision.slug]);
  relations.productDecisionEvidence.set(secondDecision.slug, [
    { title: "Research report", url: "https://example.com/report" },
  ]);
  const graph = buildContentGraph({
    technologySlugs: [],
    projectSlugs: [project.slug],
    ideaSlugs: [idea.slug],
    relations,
  });

  return {
    productDecisions: new Map([
      [firstDecision.slug, firstDecision],
      [secondDecision.slug, secondDecision],
    ]),
    projects: new Map([[project.slug, project]]),
    ideas: new Map([[idea.slug, idea]]),
    adrs: new Map([
      [informedByADR.adrRef, informedByADR],
      [implementingADR.adrRef, implementingADR],
    ]),
    blogs: new Map([[blog.slug, blog]]),
    graph,
  } as unknown as DomainRepository;
}

describe("product decision queries", () => {
  it("sorts decisions newest first and gets one decision", () => {
    const repository = makeRepository();
    expect(getAllProductDecisions(repository).map(({ slug }) => slug)).toEqual([
      "002-second-decision",
      "001-first-decision",
    ]);
    expect(getProductDecision(repository, "002-second-decision")?.title).toBe(
      "PDR 002: Second decision",
    );
    expect(getProductDecision(repository, "999-missing")).toBeNull();
  });

  it("resolves backlinks and drops missing entities", () => {
    const backlinks = getProductDecisionBacklinks(
      makeRepository(),
      "002-second-decision",
    );
    expect(backlinks.projects.map(({ slug }) => slug)).toEqual(["project-one"]);
    expect(backlinks.ideas.map(({ slug }) => slug)).toEqual(["clear-policy"]);
    expect(backlinks.informedByADRs.map(({ adrRef }) => adrRef)).toEqual([
      "project-one:001-context",
    ]);
    expect(backlinks.implementingADRs.map(({ adrRef }) => adrRef)).toEqual([
      "project-one:002-implementation",
    ]);
    expect(backlinks.blogs.map(({ slug }) => slug)).toEqual([
      "policy-explained",
    ]);
    expect(backlinks.evidence).toEqual([
      { title: "Research report", url: "https://example.com/report" },
    ]);
  });

  it("returns empty backlinks for an unknown decision", () => {
    expect(
      getProductDecisionBacklinks(makeRepository(), "999-missing"),
    ).toEqual({
      projects: [],
      ideas: [],
      informedByADRs: [],
      implementingADRs: [],
      blogs: [],
      evidence: [],
    });
  });
});

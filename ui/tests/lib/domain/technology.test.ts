import { describe, expect, it } from "vitest";
import { loadDomainRepository } from "@/lib/domain";
import { getRelatedContentForTechnology } from "@/lib/domain/technology";

describe("technology related content", () => {
  it("links Score to its governing architecture decision", () => {
    const related = getRelatedContentForTechnology(
      loadDomainRepository(),
      "score",
    );

    expect(related.adrs).toContainEqual({
      projectSlug: "personal-engineering-platform",
      slug: "043-portable-workload-contract",
      title: "ADR 043: Portable workload intent with target-specific packaging",
      status: "Accepted",
    });
    expect(related.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "personal-engineering-platform" }),
      ]),
    );
  });

  it.each(["cooklang", "cooklang-rs"])(
    "links %s to the Cooklang adoption decision",
    (slug) => {
      const related = getRelatedContentForTechnology(
        loadDomainRepository(),
        slug,
      );

      expect(related.adrs).toContainEqual({
        projectSlug: "recipe-site",
        slug: "001-cooklang",
        title: "ADR 001: Cooklang",
        status: "Accepted",
      });
    },
  );
});

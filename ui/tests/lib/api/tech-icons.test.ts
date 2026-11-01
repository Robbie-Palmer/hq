import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getTechIconKey, TechIcon } from "@/lib/api/tech-icons";

describe("technology icons", () => {
  it("resolves the reveal.js logo from Simple Icons", () => {
    expect(getTechIconKey("reveal.js")).toBe("simple:revealdotjs");
  });

  it("resolves the K3s logo from Simple Icons", () => {
    expect(getTechIconKey("K3s")).toBe("simple:k3s");
  });

  it.each([
    ["Kafka", "apachekafka", "simple:apachekafka"],
    ["Quix Streams", "quixstreams", "custom:quixstreams"],
    ["Strimzi", "strimzi", "custom:strimzi"],
    ["dbt", "dbt", "custom:dbt"],
    ["Filen", undefined, "custom:filen"],
    ["Proton Pass", undefined, "custom:protonpass"],
    ["Proton Mail", undefined, "custom:protonmail"],
  ])("resolves the %s logo", (name, iconSlug, expected) => {
    expect(getTechIconKey(name, iconSlug)).toBe(expected);
  });

  it("preserves the full-color t3-code logo", () => {
    expect(getTechIconKey("t3-code")).toBe("custom:t3code");

    const markup = renderToStaticMarkup(TechIcon({ name: "t3-code" }));

    expect(markup).not.toContain("brightness-0");
    expect(markup).not.toContain("dark:invert");
  });

  it("keeps monochrome filters on other custom icons", () => {
    const markup = renderToStaticMarkup(TechIcon({ name: "Codex" }));

    expect(markup).toContain("brightness-0");
    expect(markup).toContain("dark:invert");
  });

  it.each(["Proton Pass", "Proton Mail"])(
    "preserves the full-color %s logo",
    (name) => {
      const markup = renderToStaticMarkup(TechIcon({ name }));

      expect(markup).not.toContain("brightness-0");
      expect(markup).not.toContain("dark:invert");
    },
  );
});
